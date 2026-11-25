// Evaluator stats from 42's API: /v2/users/:login/scale_teams/as_corrector.
// Unlike a piscine these change, so they're kept in Postgres and refreshed when stale (callers get
// the stored numbers right away while a refresh runs in the background). Hourly, only the
// evaluations filled in since the newest one counted are asked for (usually one request) and added
// on; once a day the whole history is read again, to catch anything 42 changed after the fact.
import type { FtApi } from './ft-api.ts';
import type { Db, EvalStats } from './db.ts';

const PER_PAGE = 100;
const MAX_PAGES = 30; // 3000 evaluations: more than anyone has
export const EVALS_STALE_MS = 3_600_000; // new evaluations: hourly
const EVALS_FULL_MS = 24 * 3_600_000; // the whole history again: daily

interface ScaleTeam {
  filled_at: string | null;
  correcteds: { login: string }[] | string;
  final_mark: number | null;
  flag: { name: string; positive: boolean } | null;
  team?: { project_id?: number | null } | null;
}

/** Done = filled in; failed = negative flag or a mark under 50; outstanding = "Outstanding project". */
export function summarize(login: string, teams: ScaleTeam[]): Omit<EvalStats, 'refreshedAt'> {
  const done = teams.filter((t) => t.filled_at);
  return {
    login,
    total: done.length,
    failed: done.filter((t) => t.flag?.positive === false || (t.final_mark !== null && t.final_mark < 50)).length,
    outstanding: done.filter((t) => /outstanding/i.test(t.flag?.name ?? '')).length,
    partners: countPartners(done),
    partnerEvals: listPartnerEvals(done),
    lastFilledAt: done.reduce((m, t) => Math.max(m, Date.parse(t.filled_at!)), 0) || null,
  };
}

/** `older` plus the evaluations in `newer` (filled in after `older` was counted). */
function merge(older: EvalStats, newer: Omit<EvalStats, 'refreshedAt'>): Omit<EvalStats, 'refreshedAt'> {
  const partners = { ...older.partners };
  for (const [l, n] of Object.entries(newer.partners)) partners[l] = (partners[l] ?? 0) + n;
  const partnerEvals = { ...older.partnerEvals };
  for (const [l, list] of Object.entries(newer.partnerEvals ?? {})) partnerEvals[l] = [...(partnerEvals[l] ?? []), ...list];
  return {
    login: older.login,
    total: older.total + newer.total,
    failed: older.failed + newer.failed,
    outstanding: older.outstanding + newer.outstanding,
    partners,
    partnerEvals,
    lastFilledAt: Math.max(older.lastFilledAt ?? 0, newer.lastFilledAt ?? 0) || null,
    fullAt: older.fullAt,
  };
}

/** login → each evaluation of them: [project id (0 = unknown), filled in at]. */
function listPartnerEvals(done: ScaleTeam[]): Record<string, [number, number][]> {
  const out: Record<string, [number, number][]> = {};
  for (const t of done) {
    if (!Array.isArray(t.correcteds)) continue;
    const at = Date.parse(t.filled_at!);
    for (const c of t.correcteds) (out[c.login] ??= []).push([t.team?.project_id ?? 0, at]);
  }
  return out;
}

/** login → number of evaluations of them ("correcteds" is a string when 42 hides it). */
function countPartners(done: ScaleTeam[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of done) {
    if (!Array.isArray(t.correcteds)) continue;
    for (const c of t.correcteds) out[c.login] = (out[c.login] ?? 0) + 1;
  }
  return out;
}

/** Evaluations between two students, in each direction. */
export interface Together {
  with: string;
  youEvaluatedThem: number;
  theyEvaluatedYou: number;
  /** Each one, newest first: the project's name, when, and who evaluated (`you`: the viewer did). */
  evals: { project: string; at: number; you: boolean }[];
}

/** All their evaluations as corrector, or (with `since`, ms) only those filled in at or after it. */
async function fetchAll(api: FtApi, login: string, since?: number): Promise<ScaleTeam[]> {
  const all: ScaleTeam[] = [];
  const range = since ? `&range[filled_at]=${encodeURIComponent(new Date(since).toISOString())},2999-12-31T00:00:00Z` : '';
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await api.get<ScaleTeam[]>(
      `/v2/users/${encodeURIComponent(login)}/scale_teams/as_corrector?per_page=${PER_PAGE}&page=${page}${range}`,
    );
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return all;
}

export class EvalService {
  #inflight = new Map<string, Promise<Omit<EvalStats, 'refreshedAt'>>>();
  #memory = new Map<string, EvalStats>(); // used when there's no database
  #names = new Map<number, string>(); // project names, in front of the database's
  readonly #api: FtApi;
  readonly #db: Db | undefined;

  constructor(api: FtApi, db: Db | undefined) {
    this.#api = api;
    this.#db = db;
  }

  /**
   * One refresh per login at a time, however many requests ask for it. With `stored` (complete and
   * read in full within the day): only what was filled in since, added on. Otherwise everything.
   */
  #refresh(login: string, stored?: EvalStats) {
    let p = this.#inflight.get(login);
    if (!p) {
      const since = stored?.lastFilledAt;
      const recent = stored?.partnerEvals && since && stored.fullAt && Date.now() - stored.fullAt.getTime() < EVALS_FULL_MS;
      p = (recent
        ? fetchAll(this.#api, login, since).then((teams) =>
            // The range includes `since` itself, which is already counted.
            merge(stored, summarize(login, teams.filter((t) => t.filled_at && Date.parse(t.filled_at) > since))),
          )
        : fetchAll(this.#api, login).then((teams) => ({ ...summarize(login, teams), fullAt: new Date() }))
      )
        .then(async (stats) => {
          await this.#db?.saveEvalStats(stats);
          this.#memory.set(login, { ...stats, refreshedAt: new Date() });
          return stats;
        })
        .finally(() => this.#inflight.delete(login));
      this.#inflight.set(login, p);
    }
    return p;
  }

  /** `viewer` and `login`: how often each evaluated the other. */
  async together(login: string, viewer: string): Promise<Together> {
    const [them, you] = await Promise.all([this.get(login), this.get(viewer)]);
    const list = [
      ...(you.partnerEvals?.[login] ?? []).map(([id, at]) => ({ id, at, you: true })),
      ...(them.partnerEvals?.[viewer] ?? []).map(([id, at]) => ({ id, at, you: false })),
    ].sort((a, b) => b.at - a.at);
    // Lines only when every project has its name; any problem and the tooltip keeps just the counts.
    const names = await this.#projectNames(list.map((e) => e.id)).catch((e) => {
      console.error('project names failed', e);
      return undefined;
    });
    const named = names && list.every((e) => names.has(e.id));
    return {
      with: login,
      youEvaluatedThem: you.partners[login] ?? 0,
      theyEvaluatedYou: them.partners[viewer] ?? 0,
      evals: named ? list.map(({ id, at, you }) => ({ project: names.get(id)!, at, you })) : [],
    };
  }

  /** Project names by id: memory, then the database, then 42 (batched) for the rest. */
  async #projectNames(ids: number[]): Promise<Map<number, string>> {
    let missing = [...new Set(ids)].filter((id) => id > 0 && !this.#names.has(id));
    if (missing.length && this.#db) {
      for (const [id, name] of await this.#db.getProjectNames(missing)) this.#names.set(id, name);
      missing = missing.filter((id) => !this.#names.has(id));
    }
    for (let i = 0; i < missing.length; i += PER_PAGE) {
      const batch = missing.slice(i, i + PER_PAGE);
      const projects = await this.#api.get<{ id: number; name?: string }[]>(`/v2/projects?filter[id]=${batch.join(',')}&per_page=${PER_PAGE}`);
      const found = new Map<number, string>();
      for (const p of projects) if (p.name) found.set(p.id, p.name);
      for (const [id, name] of found) this.#names.set(id, name);
      await this.#db?.saveProjectNames(found);
    }
    return this.#names;
  }

  async get(login: string): Promise<EvalStats> {
    const stored = (await this.#db?.getEvalStats(login)) ?? this.#memory.get(login);
    // Rows saved before partners were tracked are rebuilt instead of served.
    if (!stored || !stored.partners) return { ...(await this.#refresh(login)), refreshedAt: new Date() };
    // Rows from before the evaluations themselves were kept: served as they are, refreshed behind.
    if (!stored.partnerEvals || Date.now() - stored.refreshedAt.getTime() > EVALS_STALE_MS) {
      this.#refresh(login, stored).catch((e) => console.error('eval refresh failed', login, e));
    }
    return stored;
  }
}
