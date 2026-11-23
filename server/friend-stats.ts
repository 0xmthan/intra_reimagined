// Stats for the friends panel (src/friends.ts), for a whole list at once: name, photo, seat, wallet
// and eval points from 42's API in one batched call (/v2/users, up to 100 students), plus their
// levels from /v2/cursus_users on a slower clock (levels move slowly). Not one profile page per
// friend. Each student is cached and shared by everyone who follows them, so 42 is asked about a
// student at most once per FRESH_MS however many people follow them.
// Refreshes draw from a Budget (rate-limit.ts) so friends never take more than their share of the
// app's 42 quota: when it's empty, the cached stats are served and the refresh waits for a later
// request. Someone never seen before is fetched regardless (once).
import type { FtApi } from './ft-api.ts';
import type { Budget } from './rate-limit.ts';

const FRESH_MS = 30_000; // seats change often; wallet and eval points ride along
const LEVEL_FRESH_MS = 5 * 60_000;
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
  levelAt?: number; // when `level` was last fetched
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
  readonly #budget: Budget;

  constructor(api: FtApi, budget: Budget) {
    this.#api = api;
    this.#budget = budget;
  }

  /**
   * Stats for these logins. Stale ones are refreshed; the answer waits up to `waitMs` for students
   * with nothing cached yet, and up to `staleWaitMs` for the rest, so it usually carries the fresh
   * values (else the cached ones, and the fresh ones next time).
   */
  async get(logins: string[], waitMs = 8000, staleWaitMs = 1500): Promise<Record<string, FriendStat>> {
    const now = Date.now();
    const stale = logins.filter((l) => !this.#inflight.has(l) && now - (this.#cache.get(l)?.at ?? 0) > FRESH_MS);
    for (let i = 0; i < stale.length; i += BATCH) this.#refresh(stale.slice(i, i + BATCH));
    const missing = logins.filter((l) => !this.#cache.has(l));
    const pending = (ls: string[]) => [...new Set(ls.map((l) => this.#inflight.get(l)).filter(Boolean))];
    const wait = (ps: unknown[], ms: number) => ps.length && Promise.race([Promise.allSettled(ps), new Promise((r) => setTimeout(r, ms))]);
    await wait(pending(missing), waitMs);
    await wait(pending(logins), staleWaitMs);
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
    const first = logins.some((l) => !this.#cache.has(l));
    if (!first && !this.#budget.take()) return; // over budget: keep serving the cache
    const users = await this.#api.get<ApiUser[]>(`/v2/users?filter[login]=${logins.map(encodeURIComponent).join(',')}&per_page=${BATCH}`);
    if (!users.length) return;
    const now = Date.now();
    // Levels only for those whose level is old (or unknown), every cursus each is in, page by page.
    const levels = new Map<string, { main?: number; max?: number }>();
    const due = users.filter((u) => now - (this.#cache.get(u.login)?.levelAt ?? 0) > LEVEL_FRESH_MS);
    const fetchLevels = due.length > 0 && (due.some((u) => !this.#cache.has(u.login)) || this.#budget.take());
    let complete = false; // every page read (an over-budget stop leaves the rest as they were)
    if (fetchLevels) {
      const ids = due.map((u) => u.id).join(',');
      for (let page = 1; page <= 10; page++) {
        if (page > 1 && !this.#budget.take()) break;
        const batch = await this.#api.get<ApiCursusUser[]>(`/v2/cursus_users?filter[user_id]=${ids}&per_page=${BATCH}&page=${page}`);
        for (const cu of batch) {
          const login = cu.user?.login;
          if (!login || typeof cu.level !== 'number') continue;
          const l = levels.get(login) ?? {};
          if (cu.cursus?.slug === CURSUS_42) l.main = cu.level;
          l.max = Math.max(l.max ?? 0, cu.level);
          levels.set(login, l);
        }
        if (batch.length < BATCH) {
          complete = true;
          break;
        }
      }
    }
    const at = Date.now();
    for (const u of users) {
      const v = u.image?.versions;
      const prev = this.#cache.get(u.login);
      const lv = levels.get(u.login);
      const fresh = levels.has(u.login) || (complete && due.includes(u));
      this.#set(u.login, {
        name: u.usual_full_name || u.displayname || u.login,
        image: v?.small ?? v?.medium ?? u.image?.link ?? undefined,
        photo: v?.large ?? v?.medium ?? u.image?.link ?? undefined,
        seat: u.location || undefined,
        level: fresh ? (lv?.main ?? lv?.max) : prev?.level,
        wallet: u.wallet,
        evalPoints: u.correction_point,
        at,
        levelAt: fresh ? at : prev?.levelAt,
      });
    }
  }

  #set(login: string, s: FriendStat) {
    this.#cache.delete(login); // re-insert so it counts as newest
    this.#cache.set(login, s);
    while (this.#cache.size > MAX_ENTRIES) this.#cache.delete(this.#cache.keys().next().value!);
  }
}
