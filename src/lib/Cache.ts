interface CacheRecord<V = any> {
  exp: number;
  value: V;
}

/** A simple memory cache implementation. */
export default class Cache<V = any> {
  readonly ttl: number;
  private data: Map<string, CacheRecord<V>> = new Map();

  constructor(defaultTTL: number) {
    this.ttl = defaultTTL;
    const timer = setInterval(() => this.cleanup(), 10000) as unknown as {
      unref?: () => void;
    };
    // Node timers have unref() so a module-level Cache doesn't keep one-shot
    // scripts alive. Browser timers return numbers and don't expose unref.
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  write(key: string, value: V, ttl?: number) {
    this.data.set(key, {
      exp: Date.now() + (ttl || this.ttl),
      value
    });
  }

  read(key: string): V | undefined {
    const record = this.data.get(key);
    return record && record.exp > Date.now() ? record.value : undefined;
  }

  private cleanup() {
    const now = Date.now();
    this.data.forEach((record, key) => {
      if (record.exp < now) {
        this.data.delete(key);
      }
    });
  }
}
