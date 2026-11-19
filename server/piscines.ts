// Everyone from one piscine: /v2/users filtered by primary campus + pool year/month, all pages.
// The list barely changes once a piscine is over, so it's kept in Postgres and refreshed weekly
// in the background (callers get the stored list right away).
import type { FtApi } from './ft-api.ts';
import type { Db, PiscineList, PiscineStudent } from './db.ts';

const PER_PAGE = 100;
const MAX_PAGES = 10;
const STALE_MS = 7 * 86_400_000;

export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

interface ApiUser {
  login: string;
  displayname: string;
  usual_full_name?: string | null;
  image?: { versions?: { small?: string | null } } | null;
  'active?': boolean;
  'staff?': boolean;
  kind: string;
}

async function fetchList(api: FtApi, campusId: number, year: string, month: string): Promise<PiscineStudent[]> {
  const out: PiscineStudent[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await api.get<ApiUser[]>(
      `/v2/users?filter[primary_campus_id]=${campusId}&filter[pool_year]=${year}&filter[pool_month]=${month}` +
        `&per_page=${PER_PAGE}&page=${page}&sort=login`,
    );
    for (const u of batch) {
      if (u['staff?'] || u.kind !== 'student') continue;
      out.push({ login: u.login, name: u.usual_full_name || u.displayname, image: u.image?.versions?.small ?? null, active: !!u['active?'] });
    }
    if (batch.length < PER_PAGE) break;
  }
  return out;
}

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
    if (!stored) return this.#refresh(campusId, year, month);
    this.#memory.set(key, stored);
    if (Date.now() - new Date(stored.refreshedAt).getTime() > STALE_MS) {
      this.#refresh(campusId, year, month).catch((e) => console.error('piscine refresh failed', key, e));
    }
    return stored;
  }
}
