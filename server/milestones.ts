// Where each active student at a campus is on the Common Core, for the milestone rings. 42 has no
// milestone field, but each milestone ends with a Common Core rank quest (rank 00 closes milestone 0,
// rank 01 milestone 1, …), so a student's milestone is one past the highest rank they validated.
// Rank 06 or the "common-core" quest validated (or the Transcender grade) means transcended.
// Blackholed students are left out. A few pages of cursus_users plus a few per rank quest: kept in
// Postgres and refreshed every 6 hours in the background. The first load takes a minute or two, so
// nobody waits on it: get() starts it and says it's pending (the route answers 202). A refresh that
// fails isn't tried again for RETRY_MS: a stale list is served meanwhile, and with none at all get()
// says it failed (the route answers 502) instead of pending forever.
import type { FtApi } from './ft-api.ts';
import type { Db, MilestoneStudent } from './db.ts';

const PER_PAGE = 100;
const MAX_PAGES = 50;
const STALE_MS = 6 * 3_600_000;
export const MILESTONES_RETRY_MS = 5 * 60_000; // after a failed refresh, before the next try
const CURSUS = 21; // 42cursus
/** Quest ids of Common Core ranks 00–05 (cursus 21). */
const RANKS = [44, 45, 46, 47, 48, 49];
/** Rank 06 (the optional and the main quest) and the "common-core" quest: done with the Common Core. */
const DONE = [106, 141, 37];

interface CursusUser {
  grade: string | null;
  level: number;
  blackholed_at: string | null;
  user: {
    login: string;
    kind?: string;
    'active?'?: boolean;
    image?: { link?: string | null; versions?: { small?: string | null } | null } | null;
  };
}

type Hit = { students: MilestoneStudent[]; refreshedAt: number };

/** What get() has for a campus: the list, the first load still running, or it failed (until `retryAt`, ms). */
export type MilestonesResult = ({ status: 'ready' } & Hit) | { status: 'pending' } | { status: 'failed'; retryAt: number };

interface QuestUser {
  validated_at: string | null;
  user: { login: string };
}

export class CampusMilestones {
  readonly #api: FtApi;
  readonly #db: Db | undefined;
  #memory = new Map<number, Hit>();
  #inflight = new Map<number, Promise<Hit>>();
  #failedAt = new Map<number, number>(); // campus → when its last refresh failed (ms)

  constructor(api: FtApi, db: Db | undefined) {
    this.#api = api;
    this.#db = db;
  }

  async #all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await this.#api.get<T[]>(`${path}&per_page=${PER_PAGE}&page=${page}`);
      out.push(...batch);
      if (batch.length < PER_PAGE) break;
    }
    return out;
  }

  /** Logins at the campus who validated quest `id`. */
  async #validated(campusId: number, id: number): Promise<Set<string>> {
    const rows = await this.#all<QuestUser>(`/v2/quests/${id}/quests_users?filter[campus_id]=${campusId}&sort=id`);
    return new Set(rows.filter((r) => r.validated_at).map((r) => r.user.login));
  }

  #refresh(campusId: number) {
    let p = this.#inflight.get(campusId);
    if (!p) {
      p = (async () => {
        const now = Date.now();
        const cursusUsers = await this.#all<CursusUser>(
          `/v2/cursus/${CURSUS}/cursus_users?filter[campus_id]=${campusId}&filter[active]=true&sort=id`,
        );
        const ranks: Set<string>[] = [];
        for (const id of RANKS) ranks.push(await this.#validated(campusId, id));
        const done = new Set<string>();
        for (const id of DONE) for (const l of await this.#validated(campusId, id)) done.add(l);

        const students: MilestoneStudent[] = [];
        for (const c of cursusUsers) {
          const u = c.user;
          if (u.kind !== 'student' || u['active?'] === false) continue;
          if (c.blackholed_at && Date.parse(c.blackholed_at) <= now) continue;
          let milestone = 0;
          ranks.forEach((set, i) => {
            if (set.has(u.login)) milestone = i + 1;
          });
          const transcended = done.has(u.login) || /transcend/i.test(c.grade ?? '');
          students.push({
            login: u.login,
            image: u.image?.versions?.small ?? u.image?.link ?? null,
            milestone: transcended ? RANKS.length : milestone,
            transcended,
            level: Math.round(c.level * 100) / 100,
          });
        }
        students.sort((a, b) => a.milestone - b.milestone || b.level - a.level || a.login.localeCompare(b.login));
        await this.#db?.saveCampusMilestones(campusId, students);
        const hit = { students, refreshedAt: Date.now() };
        this.#memory.set(campusId, hit);
        this.#failedAt.delete(campusId);
        return hit;
      })()
        .catch((e) => {
          this.#failedAt.set(campusId, Date.now());
          throw e;
        })
        .finally(() => this.#inflight.delete(campusId));
      this.#inflight.set(campusId, p);
    }
    return p;
  }

  /** The stored list (refreshed behind when stale), or that the first load is running or failed. */
  async get(campusId: number): Promise<MilestonesResult> {
    let hit = this.#memory.get(campusId);
    if (!hit) {
      const stored = await this.#db?.getCampusMilestones(campusId);
      if (stored) {
        hit = { students: stored.students, refreshedAt: stored.refreshedAt.getTime() };
        this.#memory.set(campusId, hit);
      }
    }
    const failedAt = this.#failedAt.get(campusId);
    const retryAt = failedAt === undefined ? 0 : failedAt + MILESTONES_RETRY_MS;
    const due = !hit || Date.now() - hit.refreshedAt > STALE_MS;
    if (due && !this.#inflight.has(campusId) && Date.now() >= retryAt) {
      this.#refresh(campusId).catch((e) => console.error('milestones refresh failed', campusId, e));
    }
    if (hit) return { status: 'ready', ...hit };
    // Still within the wait after a failure, and nothing new running: say so rather than "pending".
    if (Date.now() < retryAt && !this.#inflight.has(campusId)) return { status: 'failed', retryAt };
    return { status: 'pending' };
  }
}
