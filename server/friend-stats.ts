// Stats for the friends panel (src/friends.ts), for a whole list at once: name, photo, seat, level,
// wallet and eval points from 42's API in two batched calls (users, then their cursus levels), not
// one profile page per friend. Each student is cached for FRESH_MS and shared by everyone who
// follows them. A stale entry is still served while it refreshes, so the panel never waits on 42
// for someone it has seen before.
import type { FtApi } from './ft-api.ts';

const FRESH_MS = 3 * 60_000; // seats change often; the rest rides along
const MAX_ENTRIES = 5000;
const BATCH = 100; // 42's largest page
const CURSUS_42 = '42cursus';

export interface FriendStat {
  name: string;
  image?: string; // small, for the row
  photo?: string; // large, for the hover card
  seat?: string;
  level?: number;
  wallet?: number;
  evalPoints?: number;
  at: number;
}

interface ApiUser {
  id: number;
  login: string;
  usual_full_name?: string | null;
  displayname?: string | null;
  location?: string | null;
  wallet?: number;
  correction_point?: number;
  image?: { link?: string | null; versions?: { small?: string | null; medium?: string | null; large?: string | null } };
}

interface ApiCursusUser {
  level?: number;
  user?: { login?: string };
  cursus?: { slug?: string };
}

export class FriendStatsService {
  #cache = new Map<string, FriendStat>();
  #inflight = new Map<string, Promise<void>>();
  readonly #api: FtApi;

  constructor(api: FtApi) {
    this.#api = api;
  }

  /**
   * Stats for these logins. Fresh ones come from the cache; stale ones are refreshed, but only
   * waited for (up to `waitMs`) when there's nothing cached for them yet.
   */
  async get(logins: string[], waitMs = 8000): Promise<Record<string, FriendStat>> {
    const now = Date.now();
    const stale = logins.filter((l) => !this.#inflight.has(l) && now - (this.#cache.get(l)?.at ?? 0) > FRESH_MS);
    for (let i = 0; i < stale.length; i += BATCH) this.#refresh(stale.slice(i, i + BATCH));
    const missing = logins.filter((l) => !this.#cache.has(l)).map((l) => this.#inflight.get(l)).filter(Boolean);
    if (missing.length) {
      await Promise.race([Promise.allSettled(missing), new Promise((r) => setTimeout(r, waitMs))]);
    }
    const out: Record<string, FriendStat> = {};
    for (const l of logins) {
      const s = this.#cache.get(l);
      if (s) out[l] = s;
    }
    return out;
  }

  #refresh(logins: string[]) {
    const p = this.#fetch(logins)
      .catch((e) => console.error('friend stats refresh failed', e))
      .finally(() => logins.forEach((l) => this.#inflight.delete(l)));
    for (const l of logins) this.#inflight.set(l, p);
  }

  async #fetch(logins: string[]) {
    const users = await this.#api.get<ApiUser[]>(`/v2/users?filter[login]=${logins.map(encodeURIComponent).join(',')}&per_page=${BATCH}`);
    if (!users.length) return;
    // Every cursus each of them is in (a few per student), page by page.
    const levels = new Map<string, { main?: number; max?: number }>();
    const ids = users.map((u) => u.id).join(',');
    for (let page = 1; page <= 10; page++) {
      const batch = await this.#api.get<ApiCursusUser[]>(`/v2/cursus_users?filter[user_id]=${ids}&per_page=${BATCH}&page=${page}`);
      for (const cu of batch) {
        const login = cu.user?.login;
        if (!login || typeof cu.level !== 'number') continue;
        const l = levels.get(login) ?? {};
        if (cu.cursus?.slug === CURSUS_42) l.main = cu.level;
        l.max = Math.max(l.max ?? 0, cu.level);
        levels.set(login, l);
      }
      if (batch.length < BATCH) break;
    }
    const at = Date.now();
    for (const u of users) {
      const v = u.image?.versions;
      const lv = levels.get(u.login);
      this.#set(u.login, {
        name: u.usual_full_name || u.displayname || u.login,
        image: v?.small ?? v?.medium ?? u.image?.link ?? undefined,
        photo: v?.large ?? v?.medium ?? u.image?.link ?? undefined,
        seat: u.location || undefined,
        level: lv?.main ?? lv?.max,
        wallet: u.wallet,
        evalPoints: u.correction_point,
        at,
      });
    }
  }

  #set(login: string, s: FriendStat) {
    this.#cache.delete(login); // re-insert so it counts as newest
    this.#cache.set(login, s);
    while (this.#cache.size > MAX_ENTRIES) this.#cache.delete(this.#cache.keys().next().value!);
  }
}
