// All-time logtime from 42's API: /v2/users/:login/locations, every session at a campus computer.
// Intra's own locations_stats only covers the last ~4 months. A student's whole history is fetched
// once, the first time anyone asks for it, and kept in Postgres; after that a refresh only asks for
// sessions that started since the newest one we have (usually one request), when the stored copy is
// older than LOGTIME_STALE_MS. Old sessions never change, so they're never fetched again.
import type { FtApi } from './ft-api.ts';
import type { Db, Session } from './db.ts';

const PER_PAGE = 100;
const MAX_PAGES = 100; // 10,000 sessions: years of daily logins
export const LOGTIME_STALE_MS = 10 * 60_000;
/** A session still open after this long was never closed by 42: don't re-check from it forever. */
const OPEN_WINDOW_MS = 2 * 86_400_000;

interface ApiLocation {
  id: number;
  begin_at: string;
  end_at: string | null;
}

export interface Logtime {
  login: string;
  /** [start, end] in ms since epoch, oldest first; end null = still logged in. */
  sessions: [number, number | null][];
  syncedAt: Date;
}

async function fetchSince(api: FtApi, login: string, since?: Date): Promise<Session[]> {
  const range = since ? `&range[begin_at]=${since.toISOString()},${new Date(Date.now() + 86_400_000).toISOString()}` : '';
  const all: Session[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await api.get<ApiLocation[]>(
      `/v2/users/${encodeURIComponent(login)}/locations?per_page=${PER_PAGE}&page=${page}${range}`,
    );
    for (const l of batch) all.push({ id: l.id, beginAt: new Date(l.begin_at), endAt: l.end_at ? new Date(l.end_at) : null });
    if (batch.length < PER_PAGE) break;
  }
  return all;
}

/** Where an update starts: the oldest recent session that's still open, else the newest one. */
function resumeFrom(sessions: Session[]): Date | undefined {
  const recent = Date.now() - OPEN_WINDOW_MS;
  const open = sessions.filter((s) => !s.endAt && s.beginAt.getTime() > recent);
  if (open.length) return open[0].beginAt;
  return sessions.at(-1)?.beginAt;
}

const byStart = (a: Session, b: Session) => a.beginAt.getTime() - b.beginAt.getTime();

export class LogtimeService {
  #inflight = new Map<string, Promise<Logtime>>();
  #memory = new Map<string, { sessions: Session[]; syncedAt: Date }>(); // used when there's no database
  readonly #api: FtApi;
  readonly #db: Db | undefined;

  constructor(api: FtApi, db: Db | undefined) {
    this.#api = api;
    this.#db = db;
  }

  async #load(login: string): Promise<{ sessions: Session[]; syncedAt: Date } | undefined> {
    if (!this.#db) return this.#memory.get(login);
    const syncedAt = await this.#db.getLogtimeSync(login);
    return syncedAt ? { sessions: await this.#db.getLocations(login), syncedAt } : undefined;
  }

  /** One sync per login at a time, however many requests ask for it. */
  #sync(login: string, stored?: Session[]): Promise<Logtime> {
    let p = this.#inflight.get(login);
    if (!p) {
      p = (async () => {
        const fresh = await fetchSince(this.#api, login, stored && resumeFrom(stored));
        const merged = new Map((stored ?? []).map((s) => [s.id, s]));
        for (const s of fresh) merged.set(s.id, s);
        const sessions = [...merged.values()].sort(byStart);
        if (this.#db) await this.#db.saveLocations(login, fresh);
        else this.#memory.set(login, { sessions, syncedAt: new Date() });
        return pack(login, sessions, new Date());
      })().finally(() => this.#inflight.delete(login));
      this.#inflight.set(login, p);
    }
    return p;
  }

  /**
   * The stored history, refreshed in the background when older than `staleMs` and `allow()` agrees
   * (the friends panel asks more often, within its budget). The first time waits for the whole history.
   */
  async get(login: string, staleMs = LOGTIME_STALE_MS, allow: () => boolean = () => true): Promise<Logtime> {
    const stored = await this.#load(login);
    if (!stored) return this.#sync(login); // first time: the whole history
    if (Date.now() - stored.syncedAt.getTime() > staleMs && !this.#inflight.has(login) && allow()) {
      this.#sync(login, stored.sessions).catch((e) => console.error('logtime refresh failed', login, e));
    }
    return pack(login, stored.sessions, stored.syncedAt);
  }
}

function pack(login: string, sessions: Session[], syncedAt: Date): Logtime {
  return { login, sessions: sessions.map((s) => [s.beginAt.getTime(), s.endAt ? s.endAt.getTime() : null]), syncedAt };
}
