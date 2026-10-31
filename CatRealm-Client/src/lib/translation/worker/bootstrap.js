/* global self, importScripts, Response */
// Classic-worker entry for the Bergamot engine. Served next to the files from
// @browsermt/bergamot-translator/worker/ (see bergamotWorkerAssets in vite.config.ts).
//
// Electron's file:// and Tauri's custom protocol can serve the .wasm without an
// application/wasm MIME type, which makes WebAssembly.instantiateStreaming reject.
// Re-wrap the engine binary with the right header before the stock worker loads it.
const nativeFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const response = await nativeFetch(input, init);
  if (!String(input).endsWith('.wasm')) return response;
  if (!response.ok) throw new Error(`Failed to load translation engine (${response.status})`);
  return new Response(await response.arrayBuffer(), {
    status: 200,
    headers: { 'Content-Type': 'application/wasm' },
  });
};

importScripts('translator-worker.js');
