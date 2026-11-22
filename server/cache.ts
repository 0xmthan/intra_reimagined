/** In-memory cache with per-entry expiry and a size cap (oldest entries go first). */
export class TtlCache<V> {
  #map = new Map<string, { value: V; expiresAt: number }>();

  readonly #max: number;

  constructor(maxEntries: number) {
    this.#max = maxEntries;
  }

  get(key: string): V | undefined {
    const hit = this.#map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.#map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  delete(key: string) {
    this.#map.delete(key);
  }

  set(key: string, value: V, ttlMs: number) {
    this.#map.delete(key); // re-insert so it counts as newest
    this.#map.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.#map.size > this.#max) this.#map.delete(this.#map.keys().next().value!);
  }
}
