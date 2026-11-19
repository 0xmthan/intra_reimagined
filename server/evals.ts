// Evaluator stats from 42's API: /v2/users/:login/scale_teams/as_corrector, all pages.
// Unlike a piscine these change, so they're kept in Postgres and refreshed when stale
// (callers get the stored numbers right away while a refresh runs in the background).
import type { FtApi } from './ft-api.ts';
import type { Db, EvalStats } from './db.ts';

const PER_PAGE = 100;
const MAX_PAGES = 30; // 3000 evaluations: more than anyone has
export const EVALS_STALE_MS = 6 * 3_600_000;

interface ScaleTeam {
  filled_at: string | null;
  final_mark: number | null;
  flag: { name: string; positive: boolean } | null;
}

/** Done = filled in; failed = negative flag or a mark under 50; outstanding = "Outstanding project". */
export function summarize(login: string, teams: ScaleTeam[]): Omit<EvalStats, 'refreshedAt'> {
  const done = teams.filter((t) => t.filled_at);
  return {
    login,
    total: done.length,
    failed: done.filter((t) => t.flag?.positive === false || (t.final_mark !== null && t.final_mark < 50)).length,
    outstanding: done.filter((t) => /outstanding/i.test(t.flag?.name ?? '')).length,
  };
}

async function fetchAll(api: FtApi, login: string): Promise<ScaleTeam[]> {
  const all: ScaleTeam[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await api.get<ScaleTeam[]>(
      `/v2/users/${encodeURIComponent(login)}/scale_teams/as_corrector?per_page=${PER_PAGE}&page=${page}`,
    );
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return all;
}

export class EvalService {
  #inflight = new Map<string, Promise<Omit<EvalStats, 'refreshedAt'>>>();
  #memory = new Map<string, EvalStats>(); // used when there's no database
  readonly #api: FtApi;
  readonly #db: Db | undefined;

  constructor(api: FtApi, db: Db | undefined) {
    this.#api = api;
    this.#db = db;
  }

  /** One refresh per login at a time, however many requests ask for it. */
  #refresh(login: string) {
    let p = this.#inflight.get(login);
    if (!p) {
      p = fetchAll(this.#api, login)
        .then(async (teams) => {
          const stats = summarize(login, teams);
          await this.#db?.saveEvalStats(stats);
          this.#memory.set(login, { ...stats, refreshedAt: new Date() });
          return stats;
        })
        .finally(() => this.#inflight.delete(login));
      this.#inflight.set(login, p);
    }
    return p;
  }

  async get(login: string): Promise<EvalStats> {
    const stored = (await this.#db?.getEvalStats(login)) ?? this.#memory.get(login);
    if (!stored) return { ...(await this.#refresh(login)), refreshedAt: new Date() };
    if (Date.now() - stored.refreshedAt.getTime() > EVALS_STALE_MS) {
      this.#refresh(login).catch((e) => console.error('eval refresh failed', login, e));
    }
    return stored;
  }
}
