import type { TranslationLanguage } from './languages';
import { pairFiles } from './models';
import { loadModelFile } from './modelStore';

/**
 * Main-thread client for the Bergamot WASM engine running in a classic Web Worker. Talks the
 * stock translator-worker.js RPC protocol ({id, name, args} → {id, result | error}). Message
 * text only ever travels between this thread and the worker; nothing leaves the device.
 * Models are read from installed language packs (see packStore); every pack pairs with
 * English, so e.g. Russian → Spanish runs as ru→en→en→es in one worker call.
 */

type WorkerReply = { id: number; result?: unknown; error?: { name?: string; message?: string } };
type Direction = `${TranslationLanguage}-${TranslationLanguage}`;

let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
let serial = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const loadedPairs = new Map<Direction, Promise<void>>();

function call<T>(name: string, ...args: unknown[]): Promise<T> {
  if (!worker) return Promise.reject(new Error('Translation worker not started'));
  const id = ++serial;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ id, name, args });
  });
}

function startWorker(): Promise<void> {
  if (workerReady) return workerReady;
  const url = new URL('bergamot/bootstrap.js', document.baseURI);
  worker = new Worker(url);
  worker.addEventListener('message', ({ data }: MessageEvent<WorkerReply>) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(data.error.message ?? 'Translation worker error'));
    else entry.resolve(data.result);
  });
  worker.addEventListener('error', (event) => {
    failAll(new Error(event.message || 'Translation worker crashed'));
  });
  workerReady = call<void>('initialize', { cacheSize: 0, useNativeIntGemm: false });
  workerReady.catch((error: unknown) => failAll(error instanceof Error ? error : new Error(String(error))));
  return workerReady;
}

function failAll(error: Error) {
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
  worker?.terminate();
  worker = null;
  workerReady = null;
  loadedPairs.clear();
}

/** Direct model hops for a translation: one hop when English is involved, else via English. */
function route(from: TranslationLanguage, to: TranslationLanguage): [TranslationLanguage, TranslationLanguage][] {
  return from === 'en' || to === 'en' ? [[from, to]] : [[from, 'en'], ['en', to]];
}

function ensurePair(from: TranslationLanguage, to: TranslationLanguage): Promise<void> {
  const key: Direction = `${from}-${to}`;
  let loading = loadedPairs.get(key);
  if (loading) return loading;
  loading = (async () => {
    const files = pairFiles(from, to);
    if (!files) throw new Error(`No on-device model for ${from}→${to}`);
    await startWorker();
    const [model, shortlist, ...vocabs] = await Promise.all([
      loadModelFile(files.model),
      loadModelFile(files.lex),
      ...files.vocabs.map((file) => loadModelFile(file)),
    ]);
    await call<void>('loadTranslationModel', { from, to }, { model, shortlist, vocabs, qualityModel: null, config: {} });
  })();
  loadedPairs.set(key, loading);
  loading.catch(() => loadedPairs.delete(key));
  return loading;
}

// ── Batching ─────────────────────────────────────────────────────────────────
// Rows that scroll into view together are translated in one worker call per direction.

type Job = { lines: string[]; resolve: (text: string) => void; reject: (e: Error) => void };
const queues = new Map<Direction, Job[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushDirection(direction: Direction, jobs: Job[]) {
  try {
    const [from, to] = direction.split('-') as [TranslationLanguage, TranslationLanguage];
    const hops = route(from, to);
    await Promise.all(hops.map(([hopFrom, hopTo]) => ensurePair(hopFrom, hopTo)));
    // Bergamot drops line breaks, so each non-empty line is its own input.
    const inputs = jobs.flatMap((job) => job.lines.filter((line) => line.trim()));
    const responses = await call<{ target: { text: string } }[]>('translate', {
      models: hops.map(([hopFrom, hopTo]) => ({ from: hopFrom, to: hopTo })),
      texts: inputs.map((text) => ({ text, html: false, qualityScores: false })),
    });
    let cursor = 0;
    for (const job of jobs) {
      job.resolve(job.lines.map((line) => (line.trim() ? responses[cursor++].target.text : line)).join('\n'));
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    for (const job of jobs) job.reject(err);
  }
}

function flush() {
  flushTimer = null;
  const batches = [...queues.entries()];
  queues.clear();
  // The worker is single-threaded; run directions one after another.
  void batches.reduce<Promise<void>>((chain, [direction, jobs]) => chain.then(() => flushDirection(direction, jobs)), Promise.resolve());
}

export function translateWithBergamot(text: string, from: TranslationLanguage, to: TranslationLanguage): Promise<string> {
  const direction: Direction = `${from}-${to}`;
  return new Promise<string>((resolve, reject) => {
    const queue = queues.get(direction) ?? [];
    queue.push({ lines: text.split('\n'), resolve, reject });
    queues.set(direction, queue);
    flushTimer ??= setTimeout(flush, 30);
  });
}

/** Stops the worker and frees the models (experiment turned off, or a pack changed). */
export function shutdownEngine(): void {
  if (worker) failAll(new Error('Translation stopped'));
}
