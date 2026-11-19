// Outstanding flags a student got, per project: /v2/users/:login/scale_teams/as_corrected (every
// evaluation of them) counted by project, with project ids turned into slugs from their
// projects_users. Kept in Postgres like evaluator stats and refreshed in the background when stale.
import type { FtApi } from './ft-api.ts';
import type { Db } from './db.ts';

const PER_PAGE = 100;
const MAX_PAGES = 30;
export const OUTSTANDING_STALE_MS = 6 * 3_600_000;

export interface Outstanding {
  login: string;
  projects: Record<string, number>; // project slug → outstanding flags (only projects with one)
  refreshedAt: Date;
}

interface CorrectedTeam {
  filled_at: string | null;
  flag: { name: string } | null;
  team: { project_id: number } | null;
}
interface ProjectUser {
  project: { id: number; slug: string };
}

async function all<T>(api: FtApi, path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await api.get<T[]>(`${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}`);
    out.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return out;
}

export async function countOutstanding(api: FtApi, login: string): Promise<Record<string, number>> {
  const user = encodeURIComponent(login);
  const [teams, projects] = await Promise.all([
    all<CorrectedTeam>(api, `/v2/users/${user}/scale_teams/as_corrected`),
    all<ProjectUser>(api, `/v2/users/${user}/projects_users`),
  ]);
  const slug = new Map(projects.map((p) => [p.project.id, p.project.slug]));
  const counts: Record<string, number> = {};
  for (const t of teams) {
    if (!t.filled_at || !/outstanding/i.test(t.flag?.name ?? '') || !t.team) continue;
    const s = slug.get(t.team.project_id);
    if (s) counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}

export class OutstandingService {
  #inflight = new Map<string, Promise<Outstanding>>();
  #memory = new Map<string, Outstanding>(); // used when there's no database
  readonly #api: FtApi;
  readonly #db: Db | undefined;

  constructor(api: FtApi, db: Db | undefined) {
    this.#api = api;
    this.#db = db;
  }

  #refresh(login: string) {
    let p = this.#inflight.get(login);
    if (!p) {
      p = countOutstanding(this.#api, login)
        .then(async (projects) => {
          const row = { login, projects, refreshedAt: new Date() };
          await this.#db?.saveOutstanding(login, projects);
          this.#memory.set(login, row);
          return row;
        })
        .finally(() => this.#inflight.delete(login));
      this.#inflight.set(login, p);
    }
    return p;
  }

  /** Stored counts right away (refreshed in the background when stale); fetched on first ask. */
  async get(login: string): Promise<Outstanding> {
    const stored = (await this.#db?.getOutstanding(login)) ?? this.#memory.get(login);
    if (!stored) return this.#refresh(login);
    if (Date.now() - stored.refreshedAt.getTime() > OUTSTANDING_STALE_MS) {
      this.#refresh(login).catch((e) => console.error('outstanding refresh failed', login, e));
    }
    return stored;
  }
}
