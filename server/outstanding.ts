// Outstanding flags a student got, per project: /v2/users/:login/scale_teams/as_corrected (every
// evaluation of them) counted by project, with project ids turned into slugs from their
// projects_users, with who gave each one. Kept in Postgres like evaluator stats and refreshed in
// the background when stale.
import type { FtApi } from './ft-api.ts';
import type { Db } from './db.ts';

const PER_PAGE = 100;
const MAX_PAGES = 30;
export const OUTSTANDING_STALE_MS = 6 * 3_600_000;

export interface Outstanding {
  login: string;
  projects: Record<string, number>; // project slug → outstanding flags (only projects with one)
  givers?: Record<string, string[]>; // project slug → who flagged it, newest first (missing on old rows)
  refreshedAt: Date;
}

interface CorrectedTeam {
  filled_at: string | null;
  flag: { name: string } | null;
  team: { project_id: number } | null;
  corrector: { login?: string } | string | null; // a string ("invisible") while hidden
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

export async function countOutstanding(
  api: FtApi,
  login: string,
): Promise<{ projects: Record<string, number>; givers: Record<string, string[]> }> {
  const user = encodeURIComponent(login);
  const [teams, projects] = await Promise.all([
    all<CorrectedTeam>(api, `/v2/users/${user}/scale_teams/as_corrected`),
    all<ProjectUser>(api, `/v2/users/${user}/projects_users`),
  ]);
  const slug = new Map(projects.map((p) => [p.project.id, p.project.slug]));
  const counts: Record<string, number> = {};
  const givers: Record<string, string[]> = {};
  const flagged = teams
    .filter((t) => t.filled_at && /outstanding/i.test(t.flag?.name ?? '') && t.team)
    .sort((a, b) => Date.parse(b.filled_at!) - Date.parse(a.filled_at!));
  for (const t of flagged) {
    const s = slug.get(t.team!.project_id);
    if (!s) continue;
    counts[s] = (counts[s] ?? 0) + 1;
    const by = typeof t.corrector === 'object' ? t.corrector?.login : undefined;
    if (by) (givers[s] ??= []).push(by);
  }
  return { projects: counts, givers };
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
        .then(async ({ projects, givers }) => {
          const row = { login, projects, givers, refreshedAt: new Date() };
          await this.#db?.saveOutstanding(login, projects, givers);
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
    // Rows saved before givers were kept: read again now, so the stars can say who gave them.
    if (!stored?.givers) return this.#refresh(login).catch((e) => (stored ? stored : Promise.reject(e)));
    if (Date.now() - stored.refreshedAt.getTime() > OUTSTANDING_STALE_MS) {
      this.#refresh(login).catch((e) => console.error('outstanding refresh failed', login, e));
    }
    return stored;
  }
}
