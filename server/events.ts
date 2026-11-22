// Every event of a campus (/v2/campus/:id/events, all pages), for the Logtime calendar's dots.
// Kept in memory: the first load fetches the whole history; after that, every REFRESH_MS, only the
// recent window (a month back, a year ahead) is fetched again and replaces what was there, so new,
// changed and deleted events show up without refetching years of old ones.
// Who's subscribed to one event (/v2/events/:id/users) and their feedback (/v2/events/:id/feedbacks)
// are fetched on demand and cached briefly.
import type { FtApi } from './ft-api.ts';
import { TtlCache } from './cache.ts';

const PER_PAGE = 100;
const MAX_PAGES = 60; // 6000 events
const REFRESH_MS = 20 * 60_000;
const DAY = 86_400_000;
const USERS_TTL_MS = 10 * 60_000;
const MAX_USER_PAGES = 10; // 1000 subscribers

export interface CampusEvent {
  id: number;
  name: string;
  kind: string;
  location: string;
  begin: number; // ms
  end: number | null;
  subscribers: number;
  max: number | null;
}

export interface EventUser {
  login: string;
  name: string;
  image: string | null;
}

export interface EventFeedback {
  login: string;
  rating: number; // 0–5, overall
  comment: string;
  at: number; // ms
  details: Record<string, number>; // criterion (interesting, pertinent, quality, accuracy) → 0–4
}

interface ApiEvent {
  id: number;
  name: string;
  kind: string | null;
  location: string | null;
  begin_at: string;
  end_at: string | null;
  nbr_subscribers?: number | null;
  max_people?: number | null;
}

const toEvent = (e: ApiEvent): CampusEvent => ({
  id: e.id,
  name: e.name,
  kind: e.kind ?? '',
  location: e.location ?? '',
  begin: Date.parse(e.begin_at),
  end: e.end_at ? Date.parse(e.end_at) : null,
  subscribers: e.nbr_subscribers ?? 0,
  max: e.max_people || null,
});

export class CampusEvents {
  readonly #api: FtApi;
  #memory = new Map<number, { events: Map<number, CampusEvent>; refreshedAt: number }>();
  #inflight = new Map<number, Promise<CampusEvent[]>>();
  #users = new TtlCache<Promise<EventUser[]>>(500);
  #feedbacks = new TtlCache<Promise<EventFeedback[]>>(500);

  constructor(api: FtApi) {
    this.#api = api;
  }

  async #pages(path: string): Promise<CampusEvent[]> {
    const out: CampusEvent[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const batch = await this.#api.get<ApiEvent[]>(`${path}${sep}per_page=${PER_PAGE}&page=${page}&sort=-begin_at`);
      out.push(...batch.map(toEvent).filter((e) => Number.isFinite(e.begin)));
      if (batch.length < PER_PAGE) break;
    }
    return out;
  }

  #load(campusId: number): Promise<CampusEvent[]> {
    let p = this.#inflight.get(campusId);
    if (!p) {
      p = (async () => {
        const hit = this.#memory.get(campusId);
        const now = Date.now();
        if (!hit) {
          const events = new Map((await this.#pages(`/v2/campus/${campusId}/events`)).map((e) => [e.id, e]));
          this.#memory.set(campusId, { events, refreshedAt: now });
          return [...events.values()];
        }
        const from = now - 30 * DAY;
        const to = now + 365 * DAY;
        const recent = await this.#pages(
          `/v2/campus/${campusId}/events?range[begin_at]=${new Date(from).toISOString()},${new Date(to).toISOString()}`,
        );
        for (const [id, e] of hit.events) if (e.begin >= from && e.begin <= to) hit.events.delete(id);
        for (const e of recent) hit.events.set(e.id, e);
        hit.refreshedAt = now;
        return [...hit.events.values()];
      })().finally(() => this.#inflight.delete(campusId));
      this.#inflight.set(campusId, p);
    }
    return p;
  }

  /** Everyone subscribed to an event, in subscription order. Throws FtApiError (404: no such event). */
  users(eventId: number): Promise<EventUser[]> {
    let p = this.#users.get(String(eventId));
    if (!p) {
      p = (async () => {
        const out: EventUser[] = [];
        for (let page = 1; page <= MAX_USER_PAGES; page++) {
          const batch = await this.#api.get<{ login: string; displayname?: string; usual_full_name?: string; image?: { versions?: { small?: string | null } } | null }[]>(
            `/v2/events/${eventId}/users?per_page=${PER_PAGE}&page=${page}`,
          );
          out.push(...batch.map((u) => ({ login: u.login, name: u.usual_full_name || u.displayname || u.login, image: u.image?.versions?.small ?? null })));
          if (batch.length < PER_PAGE) break;
        }
        return out;
      })();
      p.catch(() => this.#users.delete(String(eventId))); // failures aren't cached
      this.#users.set(String(eventId), p, USERS_TTL_MS);
    }
    return p;
  }

  /** Everyone's feedback on an event, oldest first. Throws FtApiError (404: no such event). */
  feedbacks(eventId: number): Promise<EventFeedback[]> {
    const key = String(eventId);
    let p = this.#feedbacks.get(key);
    if (!p) {
      p = (async () => {
        const out: EventFeedback[] = [];
        for (let page = 1; page <= MAX_USER_PAGES; page++) {
          const batch = await this.#api.get<
            { user?: { login?: string } | null; rating?: number | null; comment?: string | null; created_at: string; feedback_details?: { kind: string; rate: number }[] }[]
          >(`/v2/events/${eventId}/feedbacks?per_page=${PER_PAGE}&page=${page}`);
          for (const f of batch) {
            if (!f.user?.login) continue;
            out.push({
              login: f.user.login,
              rating: f.rating ?? 0,
              comment: f.comment?.trim() ?? '',
              at: Date.parse(f.created_at),
              details: Object.fromEntries((f.feedback_details ?? []).map((d) => [d.kind, d.rate])),
            });
          }
          if (batch.length < PER_PAGE) break;
        }
        return out.sort((a, b) => a.at - b.at);
      })();
      p.catch(() => this.#feedbacks.delete(key));
      this.#feedbacks.set(key, p, USERS_TTL_MS);
    }
    return p;
  }

  /** The campus's events, oldest first. Stale lists are returned right away and refreshed behind. */
  async get(campusId: number): Promise<CampusEvent[]> {
    const hit = this.#memory.get(campusId);
    let events: CampusEvent[];
    if (!hit) events = await this.#load(campusId);
    else {
      if (Date.now() - hit.refreshedAt > REFRESH_MS) this.#load(campusId).catch((e) => console.error('events refresh failed', campusId, e));
      events = [...hit.events.values()];
    }
    return events.sort((a, b) => a.begin - b.begin);
  }
}
