import type { TranslationLanguage } from './languages';
import { pairFiles, type ModelFile, type PairFiles } from './models';

/**
 * App-side client for the translation WebView (TranslationEngineHost + engineHtml). Requests
 * queue until the page reports ready; replies resolve them by id. Message text only travels
 * between the app and that on-device page. Like the desktop bergamotEngine.ts, every pack
 * pairs with English, so e.g. Russian → Spanish runs as ru→en→en→es in one engine call, and
 * rows that render together are translated in one call per direction.
 */

type Reply = { id?: number; ok?: boolean; result?: unknown; error?: string; type?: string; lang?: string; bytes?: number };
type Direction = `${TranslationLanguage}-${TranslationLanguage}`;
type Inject = (script: string) => void;

let inject: Inject | null = null;
let ready = false;
let serial = 0;
const queued: string[] = [];
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const progressListeners = new Set<(lang: string, bytes: number) => void>();

/** Called by TranslationEngineHost when its WebView mounts. */
export function attachEngine(run: Inject): void {
  inject = run;
  ready = false;
}

/** Called when the WebView unmounts (experiment off) or reloads; outstanding work fails. */
export function detachEngine(reason = 'Translation engine stopped'): void {
  inject = null;
  ready = false;
  queued.length = 0;
  const error = new Error(reason);
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

export function isEngineAttached(): boolean {
  return inject !== null;
}

/** Routes a WebView message (TranslationEngineHost onMessage). */
export function handleEngineMessage(raw: string): void {
  let message: Reply;
  try {
    message = JSON.parse(raw) as Reply;
  } catch {
    return;
  }
  if (message.type === 'ready') {
    ready = true;
    const scripts = queued.splice(0);
    for (const script of scripts) inject?.(script);
    return;
  }
  if (message.type === 'progress') {
    for (const listener of progressListeners) listener(message.lang ?? '', message.bytes ?? 0);
    return;
  }
  if (typeof message.id !== 'number') return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.ok) entry.resolve(message.result);
  else entry.reject(new Error(message.error ?? 'Translation engine error'));
}

export function onEngineProgress(listener: (lang: string, bytes: number) => void): () => void {
  progressListeners.add(listener);
  return () => { progressListeners.delete(listener); };
}

export function engineRequest<T>(type: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!inject) return Promise.reject(new Error('Translation engine not running'));
  const id = ++serial;
  const script = `window.__catrealmTranslate(${JSON.stringify({ ...args, id, type })}); true;`;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    if (ready) inject?.(script);
    else queued.push(script);
  });
}

/** Direct model hops for a translation: one hop when English is involved, else via English. */
function route(from: TranslationLanguage, to: TranslationLanguage): [TranslationLanguage, TranslationLanguage][] {
  return from === 'en' || to === 'en' ? [[from, to]] : [[from, 'en'], ['en', to]];
}

// ── Batching ─────────────────────────────────────────────────────────────────

type Job = { lines: string[]; resolve: (text: string) => void; reject: (error: Error) => void };
const queues = new Map<Direction, Job[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushDirection(direction: Direction, jobs: Job[]) {
  try {
    const [from, to] = direction.split('-') as [TranslationLanguage, TranslationLanguage];
    const hops = route(from, to).map(([hopFrom, hopTo]) => {
      const files: PairFiles | null = pairFiles(hopFrom, hopTo);
      if (!files) throw new Error(`No on-device model for ${hopFrom}→${hopTo}`);
      return { from: hopFrom, to: hopTo, files };
    });
    // Bergamot drops line breaks, so each non-empty line is its own input.
    const texts = jobs.flatMap((job) => job.lines.filter((line) => line.trim()));
    const results = await engineRequest<string[]>('translate', { hops, texts });
    let cursor = 0;
    for (const job of jobs) {
      job.resolve(job.lines.map((line) => (line.trim() ? results[cursor++] : line)).join('\n'));
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
  // The engine is single-threaded; run directions one after another.
  void batches.reduce<Promise<void>>((chain, [direction, jobs]) => chain.then(() => flushDirection(direction, jobs)), Promise.resolve());
}

export function translateOnDevice(text: string, from: TranslationLanguage, to: TranslationLanguage): Promise<string> {
  const direction: Direction = `${from}-${to}`;
  return new Promise<string>((resolve, reject) => {
    const queue = queues.get(direction) ?? [];
    queue.push({ lines: text.split('\n'), resolve, reject });
    queues.set(direction, queue);
    flushTimer ??= setTimeout(flush, 30);
  });
}

export function packStateOnDevice(lang: string, files: ModelFile[]) {
  return engineRequest<'installed' | 'outdated' | 'missing'>('packState', { lang, files });
}

export function installPackOnDevice(lang: string, files: ModelFile[]) {
  return engineRequest<null>('install', { lang, files });
}

export function removePackOnDevice(lang: string, files: ModelFile[]) {
  return engineRequest<null>('remove', { lang, files });
}
