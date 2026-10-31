/**
 * LRU cache of translations keyed by message id. An entry only counts as a hit while the
 * message text is unchanged, so edited messages are re-translated. `null` results ("not
 * translated") are cached too so we don't re-run detection on every scroll.
 */
export class TranslationCache<T> {
  private entries = new Map<string, { source: string; value: T | null }>();
  private inFlight = new Map<string, { source: string; promise: Promise<T | null> }>();
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Returns `undefined` on a miss, `null` for a cached "no translation". */
  get(messageId: string, source: string): T | null | undefined {
    const entry = this.entries.get(messageId);
    if (!entry || entry.source !== source) return undefined;
    // Refresh recency.
    this.entries.delete(messageId);
    this.entries.set(messageId, entry);
    return entry.value;
  }

  set(messageId: string, source: string, value: T | null): void {
    this.entries.delete(messageId);
    this.entries.set(messageId, { source, value });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Cached value, a shared in-flight promise, or a fresh `load()` whose result is cached. */
  resolve(messageId: string, source: string, load: () => Promise<T | null>): Promise<T | null> {
    const cached = this.get(messageId, source);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = this.inFlight.get(messageId);
    if (pending && pending.source === source) return pending.promise;

    const promise = load().then(
      (value) => {
        if (this.inFlight.get(messageId)?.promise === promise) this.inFlight.delete(messageId);
        this.set(messageId, source, value);
        return value;
      },
      (error: unknown) => {
        // Failures are not cached so a later view can retry.
        if (this.inFlight.get(messageId)?.promise === promise) this.inFlight.delete(messageId);
        throw error;
      },
    );
    this.inFlight.set(messageId, { source, promise });
    return promise;
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }
}
