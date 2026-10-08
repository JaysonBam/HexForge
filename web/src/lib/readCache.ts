export class ReadCache<T> {
  private entries = new Map<string, { promise: Promise<T>; expiresAt: number }>();
  private ttlMs: number;
  private maxEntries: number;
  private now: () => number;
  constructor(ttlMs = 60_000, maxEntries = 50, now = () => Date.now()) {
    this.ttlMs = ttlMs; this.maxEntries = maxEntries; this.now = now;
  }

  read(key: string, load: () => Promise<T>, force = false): Promise<T> {
    const existing = this.entries.get(key);
    if (!force && existing && existing.expiresAt > this.now()) return existing.promise;
    const entry = { promise: Promise.resolve().then(load), expiresAt: Infinity };
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    entry.promise = entry.promise.then(value => {
      entry.expiresAt = this.now() + this.ttlMs;
      return value;
    }, error => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    return entry.promise;
  }

  clear() { this.entries.clear(); }
}
