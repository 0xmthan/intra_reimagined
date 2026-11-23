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

/**
 * A token bucket for the app's own background calls to 42 (not per client): refills at `perSecond`
 * up to `burst`. Callers that find it empty skip the refresh and serve what they have.
 */
export class Budget {
  #tokens: number;
  #at = Date.now();
  readonly #perSecond: number;
  readonly #burst: number;

  constructor(perSecond: number, burst: number) {
    this.#perSecond = perSecond;
    this.#burst = burst;
    this.#tokens = burst;
  }

  /** Takes `n` tokens if that still leaves `reserve` in the bucket. */
  take(n = 1, reserve = 0): boolean {
    const now = Date.now();
    this.#tokens = Math.min(this.#burst, this.#tokens + ((now - this.#at) / 1000) * this.#perSecond);
    this.#at = now;
    if (this.#tokens - n < reserve) return false;
    this.#tokens -= n;
    return true;
  }
}
