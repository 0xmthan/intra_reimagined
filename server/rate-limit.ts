/** Fixed-window limiter per key (login or client IP), so one client can't burn the app's 42 API quota. */
export class RateLimiter {
  #windows = new Map<string, { count: number; resetAt: number }>();

  readonly #limit: number;
  readonly #windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  take(key: string): boolean {
    const now = Date.now();
    let w = this.#windows.get(key);
    if (!w || w.resetAt <= now) {
      if (this.#windows.size > 10_000) this.#sweep(now);
      w = { count: 0, resetAt: now + this.#windowMs };
      this.#windows.set(key, w);
    }
    return ++w.count <= this.#limit;
  }

  #sweep(now: number) {
    for (const [k, w] of this.#windows) if (w.resetAt <= now) this.#windows.delete(k);
  }
}
