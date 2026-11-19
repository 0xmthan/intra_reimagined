// Everyone from one piscine: /v2/users filtered by primary campus + pool year/month, all pages.
// The list barely changes once a piscine is over, so it's kept in Postgres and refreshed weekly
// in the background (callers get the stored list right away).
import type { FtApi } from './ft-api.ts';
import type { Db, PiscineList, PiscineStudent } from './db.ts';

const PER_PAGE = 100;
const MAX_PAGES = 10;
const STALE_MS = 7 * 86_400_000;
const C_PISCINE = 9;
const CURSUS_42 = 21;

export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

interface ApiUser {
  id: number;
  login: string;
  displayname: string;
  usual_full_name?: string | null;
  image?: { versions?: { small?: string | null } } | null;
  'active?': boolean;
  'staff?': boolean;
  kind: string;
}

/** user id → level in one cursus, asked 100 users at a time. */
async function fetchLevels(api: FtApi, cursusId: number, ids: number[]): Promise<Map<number, number>> {
  const levels = new Map<number, number>();
  for (let i = 0; i < ids.length; i += PER_PAGE) {
    const chunk = ids.slice(i, i + PER_PAGE);
    const rows = await api.get<{ level: number; user: { id: number } }[]>(
      `/v2/cursus_users?filter[cursus_id]=${cursusId}&filter[user_id]=${chunk.join(',')}&per_page=${PER_PAGE}`,
    );
    for (const r of rows) levels.set(r.user.id, Math.max(levels.get(r.user.id) ?? 0, r.level));
  }
  return levels;
}

async function fetchList(api: FtApi, campusId: number, year: string, month: string): Promise<PiscineStudent[]> {
  const users: ApiUser[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await api.get<ApiUser[]>(
      `/v2/users?filter[primary_campus_id]=${campusId}&filter[pool_year]=${year}&filter[pool_month]=${month}` +
        `&per_page=${PER_PAGE}&page=${page}&sort=login`,
    );
    users.push(...batch.filter((u) => !u['staff?'] && u.kind === 'student'));
    if (batch.length < PER_PAGE) break;
  }
  const ids = users.map((u) => u.id);
  const piscine = await fetchLevels(api, C_PISCINE, ids);
  const cursus = await fetchLevels(api, CURSUS_42, ids);
  return users.map((u) => ({
    login: u.login,
    name: u.usual_full_name || u.displayname,
    image: u.image?.versions?.small ?? null,
    active: !!u['active?'],
    piscineLevel: piscine.get(u.id) ?? null,
    cursusLevel: cursus.get(u.id) ?? null,
  }));
}

/** Lists saved before levels existed get rebuilt instead of served. */
const isCurrent = (l: PiscineList) => !l.students.length || 'piscineLevel' in l.students[0];

export class PiscineService {
  #inflight = new Map<string, Promise<PiscineList>>();
  #memory = new Map<string, PiscineList>();
  readonly #api: FtApi;
  readonly #db: Db | undefined;

  constructor(api: FtApi, db: Db | undefined) {
    this.#api = api;
    this.#db = db;
  }

  #refresh(campusId: number, year: string, month: string): Promise<PiscineList> {
    const key = `${campusId}/${year}/${month}`;
    let p = this.#inflight.get(key);
    if (!p) {
      p = fetchList(this.#api, campusId, year, month)
        .then(async (students) => {
          const list = { campusId, year, month, students, refreshedAt: new Date() };
          await this.#db?.savePiscineList(list);
          this.#memory.set(key, list);
          return list;
        })
        .finally(() => this.#inflight.delete(key));
      this.#inflight.set(key, p);
    }
    return p;
  }

  async get(campusId: number, year: string, month: string): Promise<PiscineList> {
    const key = `${campusId}/${year}/${month}`;
    const stored = this.#memory.get(key) ?? (await this.#db?.getPiscineList(campusId, year, month));
    if (!stored || !isCurrent(stored)) return this.#refresh(campusId, year, month);
    this.#memory.set(key, stored);
    if (Date.now() - new Date(stored.refreshedAt).getTime() > STALE_MS) {
      this.#refresh(campusId, year, month).catch((e) => console.error('piscine refresh failed', key, e));
    }
    return stored;
  }
}
