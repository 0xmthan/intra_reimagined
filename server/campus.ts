// Who belongs to a campus (by primary campus): /v2/users?filter[primary_campus_id]=..., all pages,
// logins only. Used to show one campus's patronage families. Kept in Postgres, refreshed daily in
// the background (callers get the stored list right away; only the very first load waits).
import type { FtApi } from './ft-api.ts';
import type { Db } from './db.ts';

const PER_PAGE = 100;
const MAX_PAGES = 200; // 20k users
const STALE_MS = 86_400_000;

export class CampusMembers {
  readonly #api: FtApi;
  readonly #db: Db | undefined;
  #memory = new Map<number, { logins: Set<string>; refreshedAt: number }>();
  #inflight = new Map<number, Promise<Set<string>>>();

  constructor(api: FtApi, db: Db | undefined) {
    this.#api = api;
    this.#db = db;
  }

  #refresh(campusId: number): Promise<Set<string>> {
    let p = this.#inflight.get(campusId);
    if (!p) {
      p = (async () => {
        const logins: string[] = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
          const batch = await this.#api.get<{ login: string }[]>(
            `/v2/users?filter[primary_campus_id]=${campusId}&per_page=${PER_PAGE}&page=${page}&sort=id`,
          );
          logins.push(...batch.map((u) => u.login));
          if (batch.length < PER_PAGE) break;
        }
        await this.#db?.saveCampusMembers(campusId, logins);
        const set = new Set(logins);
        this.#memory.set(campusId, { logins: set, refreshedAt: Date.now() });
        return set;
      })().finally(() => this.#inflight.delete(campusId));
      this.#inflight.set(campusId, p);
    }
    return p;
  }

  async get(campusId: number): Promise<Set<string>> {
    let hit = this.#memory.get(campusId);
    if (!hit) {
      const stored = await this.#db?.getCampusMembers(campusId);
      if (stored) {
        hit = { logins: new Set(stored.logins), refreshedAt: stored.refreshedAt.getTime() };
        this.#memory.set(campusId, hit);
      }
    }
    if (!hit) return this.#refresh(campusId);
    if (Date.now() - hit.refreshedAt > STALE_MS) this.#refresh(campusId).catch((e) => console.error('campus refresh failed', campusId, e));
    return hit.logins;
  }
}
