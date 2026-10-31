/**
 * Page loaded into the hidden translation WebView (see TranslationEngineHost).
 *
 * React Native has no Web Workers or WebAssembly, so the Bergamot engine runs in a WebView
 * whose base URL is the hosted web app. That makes it same-origin with the engine files the
 * web build already serves (/app/bergamot/), and the language packs come from
 * catrealm.app/lang/ (CORS-enabled). This mirrors the desktop client's bergamotEngine.ts and
 * modelStore.ts: model files are downloaded once, SHA-256 verified, kept in this origin's
 * IndexedDB, and message text only travels between the app and this page.
 *
 * Protocol — app → page: window.__catrealmTranslate({ id, type, ...args });
 * page → app: { type: 'ready' } | { type: 'progress', lang, bytes } | { id, ok, result | error }.
 */
export const ENGINE_BASE_URL = 'https://catrealm.app/app/';

const ENGINE_SCRIPT = String.raw`
(function () {
  'use strict';
  function post(message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }

  // ── Model store (IndexedDB, same layout as the desktop client) ─────────────
  var dbPromise = null;
  function getDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var request = indexedDB.open('catrealm-translation-models', 2);
      request.onupgradeneeded = function (event) {
        var db = request.result;
        if (event.oldVersion < 1) db.createObjectStore('files');
        if (event.oldVersion < 2) db.createObjectStore('packs');
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { dbPromise = null; reject(request.error); };
    });
    return dbPromise;
  }

  function withStore(name, mode, run) {
    return getDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(name, mode);
        var request = run(transaction.objectStore(name));
        transaction.oncomplete = function () { resolve(request ? request.result : undefined); };
        transaction.onerror = function () { reject(transaction.error); };
        transaction.onabort = function () { reject(transaction.error); };
      });
    });
  }

  function sha256Hex(buffer) {
    return crypto.subtle.digest('SHA-256', buffer).then(function (digest) {
      return Array.prototype.map.call(new Uint8Array(digest), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  function download(file, onBytes) {
    return fetch(file.url, { credentials: 'omit' }).then(function (response) {
      if (!response.ok || !response.body) throw new Error('Model download failed (' + response.status + '): ' + file.url);
      var out = new Uint8Array(file.size);
      var offset = 0;
      var reader = response.body.getReader();
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return;
          if (offset + chunk.value.byteLength > out.byteLength) throw new Error('Model file larger than expected: ' + file.url);
          out.set(chunk.value, offset);
          offset += chunk.value.byteLength;
          onBytes(chunk.value.byteLength);
          return pump();
        });
      }
      return pump().then(function () {
        if (offset !== file.size) throw new Error('Model file truncated: ' + file.url);
        return sha256Hex(out.buffer).then(function (hash) {
          if (hash !== file.sha256) throw new Error('Model checksum mismatch: ' + file.url);
          return out.buffer;
        });
      });
    });
  }

  function loadModelFile(file, onBytes) {
    onBytes = onBytes || function () {};
    return withStore('files', 'readonly', function (store) { return store.get(file.sha256); }).then(function (cached) {
      if (cached) {
        onBytes(file.size);
        return cached;
      }
      return download(file, onBytes).then(function (buffer) {
        return withStore('files', 'readwrite', function (store) { return store.put(buffer, file.sha256); })
          .then(function () { return buffer; });
      });
    });
  }

  function hasFile(hash) {
    return withStore('files', 'readonly', function (store) { return store.getKey(hash); })
      .then(function (key) { return key !== undefined; });
  }

  // ── Bergamot worker (stock translator-worker.js RPC: {id, name, args}) ─────
  var worker = null;
  var workerReady = null;
  var serial = 0;
  var pending = {};
  var loadedPairs = {};

  function call(name, args) {
    if (!worker) return Promise.reject(new Error('Translation worker not started'));
    var id = ++serial;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      worker.postMessage({ id: id, name: name, args: args });
    });
  }

  function failAll(error) {
    Object.keys(pending).forEach(function (id) { pending[id].reject(error); });
    pending = {};
    if (worker) worker.terminate();
    worker = null;
    workerReady = null;
    loadedPairs = {};
  }

  function startWorker() {
    if (workerReady) return workerReady;
    worker = new Worker(new URL('bergamot/bootstrap.js', document.baseURI));
    worker.addEventListener('message', function (event) {
      var data = event.data || {};
      var entry = pending[data.id];
      if (!entry) return;
      delete pending[data.id];
      if (data.error) entry.reject(new Error(data.error.message || 'Translation worker error'));
      else entry.resolve(data.result);
    });
    worker.addEventListener('error', function (event) {
      failAll(new Error(event.message || 'Translation worker crashed'));
    });
    workerReady = call('initialize', [{ cacheSize: 0, useNativeIntGemm: false }]);
    workerReady.catch(function (error) { failAll(error instanceof Error ? error : new Error(String(error))); });
    return workerReady;
  }

  function ensurePair(hop) {
    var key = hop.from + '-' + hop.to;
    if (loadedPairs[key]) return loadedPairs[key];
    var files = hop.files;
    var loading = startWorker().then(function () {
      return Promise.all([loadModelFile(files.model), loadModelFile(files.lex)].concat(files.vocabs.map(function (file) {
        return loadModelFile(file);
      })));
    }).then(function (buffers) {
      return call('loadTranslationModel', [
        { from: hop.from, to: hop.to },
        { model: buffers[0], shortlist: buffers[1], vocabs: buffers.slice(2), qualityModel: null, config: {} },
      ]);
    });
    loadedPairs[key] = loading;
    loading.catch(function () { delete loadedPairs[key]; });
    return loading;
  }

  // ── Operations the app can request ─────────────────────────────────────────
  var ops = {
    packState: function (args) {
      return Promise.all(args.files.map(function (file) { return hasFile(file.sha256); })).then(function (present) {
        if (present.length && present.every(Boolean)) return 'installed';
        return withStore('packs', 'readonly', function (store) { return store.getKey(args.lang); }).then(function (record) {
          return present.some(Boolean) || record !== undefined ? 'outdated' : 'missing';
        });
      });
    },
    install: function (args) {
      return withStore('packs', 'readonly', function (store) { return store.get(args.lang); }).then(function (previous) {
        var chain = Promise.resolve();
        args.files.forEach(function (file) {
          chain = chain.then(function () {
            return loadModelFile(file, function (bytes) { post({ type: 'progress', lang: args.lang, bytes: bytes }); });
          });
        });
        return chain.then(function () {
          var hashes = args.files.map(function (file) { return file.sha256; });
          var stale = ((previous && previous.hashes) || []).filter(function (hash) { return hashes.indexOf(hash) === -1; });
          return withStore('packs', 'readwrite', function (store) { return store.put({ hashes: hashes }, args.lang); })
            .then(function () {
              return Promise.all(stale.map(function (hash) {
                return withStore('files', 'readwrite', function (store) { return store.delete(hash); });
              }));
            });
        });
      }).then(function () { failAll(new Error('Translation pack changed')); });
    },
    remove: function (args) {
      return withStore('packs', 'readonly', function (store) { return store.get(args.lang); }).then(function (record) {
        var hashes = args.files.map(function (file) { return file.sha256; }).concat((record && record.hashes) || []);
        return Promise.all(hashes.map(function (hash) {
          return withStore('files', 'readwrite', function (store) { return store.delete(hash); });
        })).then(function () {
          return withStore('packs', 'readwrite', function (store) { return store.delete(args.lang); });
        });
      }).then(function () { failAll(new Error('Translation pack changed')); });
    },
    translate: function (args) {
      return Promise.all(args.hops.map(ensurePair)).then(function () {
        return call('translate', [{
          models: args.hops.map(function (hop) { return { from: hop.from, to: hop.to }; }),
          texts: args.texts.map(function (text) { return { text: text, html: false, qualityScores: false }; }),
        }]);
      }).then(function (responses) {
        return responses.map(function (response) { return response.target.text; });
      });
    },
    shutdown: function () {
      failAll(new Error('Translation stopped'));
    },
  };

  window.__catrealmTranslate = function (message) {
    var op = ops[message.type];
    Promise.resolve().then(function () {
      if (!op) throw new Error('Unknown translation request: ' + message.type);
      return op(message);
    }).then(function (result) {
      post({ id: message.id, ok: true, result: result === undefined ? null : result });
    }, function (error) {
      post({ id: message.id, ok: false, error: String((error && error.message) || error) });
    });
  };

  post({ type: 'ready' });
})();
`;

export const ENGINE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${ENGINE_SCRIPT}</script></body></html>`;
