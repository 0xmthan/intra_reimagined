// Patronage "family trees": who patrons whom, across every campus, from 42's /v2/patronages.
// The whole list is small (a few thousand rows), so it's synced into Postgres and kept in memory:
// a full pull at start and once a day (that's also how ended or deleted ones are picked up), and
// every hour just the rows changed since the last pull.
//
//   GET /v1/patronages           →  { campusId, people, links }: every patronage touching the
//                                     viewer's campus (both sides' people included)
//   GET /v1/users/:login/family  →  { login, people: { [login]: { image } },
//                                     links: [{ patron, child, ongoing, since }], truncated }
//
// `links` holds the person's ancestors (their patron, that patron's patron, ...), descendants
// (who they patron, who those patron, ...) and siblings (the others their patrons patron) with
// everyone under them, capped so one request can't return a whole campus.
import type { FtApi } from './ft-api.ts';
import type { Db, Patronage } from './db.ts';

const PER_PAGE = 100;
const MAX_PAGES = 400; // 40k patronages: far more than exist
const FULL_EVERY = 24 * 3_600_000;
const CHANGES_EVERY = 3_600_000;
const MAX_UP = 12; // generations above
const MAX_DOWN = 8; // generations below
const MAX_PEOPLE = 400;

interface ApiUser {
  login: string;
  image?: { link?: string | null; versions?: { small?: string | null } } | null;
}
interface ApiPatronage {
  id: number;
  ongoing: boolean;
  created_at: string;
  updated_at: string;
  user: ApiUser | null;
  godfather: ApiUser | null;
}

export interface FamilyLink {
  patron: string;
  child: string;
  ongoing: boolean;
  since: string; // ISO date
}
export interface Family {
  login: string;
  people: Record<string, { image: string | null }>;
  links: FamilyLink[];
  truncated: boolean;
}

const image = (u: ApiUser) => u.image?.versions?.small || u.image?.link || null;

function toRow(p: ApiPatronage): Patronage | undefined {
  if (!p.user?.login || !p.godfather?.login) return undefined;
  return {
    id: p.id,
    child: p.user.login,
    patron: p.godfather.login,
    childImage: image(p.user),
    patronImage: image(p.godfather),
    ongoing: !!p.ongoing,
    createdAt: new Date(p.created_at),
    updatedAt: new Date(p.updated_at),
  };
}

export class FamilyService {
  readonly #api: FtApi;
  readonly #db: Db | undefined;
  #byId = new Map<number, Patronage>();
  #patronsOf = new Map<string, Patronage[]>();
  #childrenOf = new Map<string, Patronage[]>();
  #images = new Map<string, string | null>();
  #syncing?: Promise<void>;
  #ready: Promise<void>;

  constructor(api: FtApi, db: Db | undefined) {
    this.#api = api;
    this.#db = db;
    this.#ready = this.#start();
  }

  async #start() {
    const stored = (await this.#db?.getPatronages().catch((e) => (console.error('patronages load failed', e), []))) ?? [];
    this.#replace(stored);
    // Serve what's stored right away; a full pull runs in the background (awaited only if empty).
    const full = this.#sync(true);
    if (!stored.length) await full.catch((e) => console.error('patronages sync failed', e));
    else full.catch((e) => console.error('patronages sync failed', e));
    setInterval(() => this.#sync(false).catch((e) => console.error('patronages sync failed', e)), CHANGES_EVERY).unref();
    setInterval(() => this.#sync(true).catch((e) => console.error('patronages sync failed', e)), FULL_EVERY).unref();
  }

  #index() {
    this.#patronsOf.clear();
    this.#childrenOf.clear();
    this.#images.clear();
    const push = (m: Map<string, Patronage[]>, k: string, p: Patronage) => (m.get(k) ?? m.set(k, []).get(k)!).push(p);
    const rows = [...this.#byId.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const p of rows) {
      push(this.#patronsOf, p.child, p);
      push(this.#childrenOf, p.patron, p);
      if (p.childImage || !this.#images.has(p.child)) this.#images.set(p.child, p.childImage);
      if (p.patronImage || !this.#images.has(p.patron)) this.#images.set(p.patron, p.patronImage);
    }
  }

  #replace(rows: Patronage[]) {
    this.#byId = new Map(rows.map((r) => [r.id, r]));
    this.#index();
  }

  /** full: every row (replaces what's stored); otherwise only rows updated since the newest we have. */
  #sync(full: boolean): Promise<void> {
    this.#syncing ??= (async () => {
      const latest = Math.max(0, ...[...this.#byId.values()].map((p) => p.updatedAt.getTime()));
      const range = !full && latest ? `&range[updated_at]=${new Date(latest - 60_000).toISOString()},2100-01-01T00:00:00Z` : '';
      const rows: Patronage[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const batch = await this.#api.get<ApiPatronage[]>(`/v2/patronages?page[size]=${PER_PAGE}&page[number]=${page}&sort=id${range}`);
        for (const p of batch) {
          const row = toRow(p);
          if (row) rows.push(row);
        }
        if (batch.length < PER_PAGE) break;
      }
      if (full) {
        await this.#db?.replacePatronages(rows);
        this.#replace(rows);
      } else if (rows.length) {
        await this.#db?.upsertPatronages(rows);
        for (const r of rows) this.#byId.set(r.id, r);
        this.#index();
      }
      console.log(`patronages: ${full ? 'full sync' : 'changes'} ${rows.length} rows, ${this.#byId.size} total`);
    })().finally(() => (this.#syncing = undefined));
    return this.#syncing;
  }

  /** Every patronage where the patron or the child is one of `logins` (a campus). */
  async among(logins: Set<string>): Promise<Pick<Family, 'people' | 'links'>> {
    await this.#ready;
    const people: Family['people'] = {};
    const links: FamilyLink[] = [];
    for (const p of this.#byId.values()) {
      if (!logins.has(p.child) && !logins.has(p.patron)) continue;
      links.push({ patron: p.patron, child: p.child, ongoing: p.ongoing, since: p.createdAt.toISOString().slice(0, 10) });
      people[p.child] ??= { image: this.#images.get(p.child) ?? null };
      people[p.patron] ??= { image: this.#images.get(p.patron) ?? null };
    }
    links.sort((a, b) => a.since.localeCompare(b.since));
    return { people, links };
  }

  async get(login: string): Promise<Family> {
    await this.#ready;
    const people = new Set<string>([login]);
    const links: FamilyLink[] = [];
    const seen = new Set<number>();
    let truncated = false;
    const add = (p: Patronage) => {
      if (seen.has(p.id)) return;
      seen.add(p.id);
      links.push({ patron: p.patron, child: p.child, ongoing: p.ongoing, since: p.createdAt.toISOString().slice(0, 10) });
    };

    // Up: patrons, their patrons, ... (cycles are cut by `people`).
    let level = [login];
    for (let d = 0; d < MAX_UP && level.length; d++) {
      const next: string[] = [];
      for (const l of level)
        for (const p of this.#patronsOf.get(l) ?? []) {
          add(p);
          if (!people.has(p.patron)) people.add(p.patron), next.push(p.patron);
        }
      level = next;
    }
    if (level.length) truncated = true;

    // Down: who they patron, and so on, breadth first so a cap cuts the deepest generations.
    // Then the same from their siblings (the others their direct patrons patron).
    const down = (from: string[]) => {
      level = from;
      for (let d = 0; d < MAX_DOWN && level.length; d++) {
        const next: string[] = [];
        for (const l of level)
          for (const p of this.#childrenOf.get(l) ?? []) {
            if (people.has(p.child)) {
              add(p);
              continue;
            }
            if (people.size >= MAX_PEOPLE) {
              truncated = true;
              continue;
            }
            add(p);
            people.add(p.child);
            next.push(p.child);
          }
        level = next;
      }
      if (level.some((l) => this.#childrenOf.has(l))) truncated = true;
    };
    down([login]);
    const siblings: string[] = [];
    for (const p of this.#patronsOf.get(login) ?? [])
      for (const c of this.#childrenOf.get(p.patron) ?? []) {
        if (people.has(c.child)) {
          add(c);
          continue;
        }
        if (people.size >= MAX_PEOPLE) {
          truncated = true;
          continue;
        }
        add(c);
        people.add(c.child);
        siblings.push(c.child);
      }
    down(siblings);

    return {
      login,
      people: Object.fromEntries([...people].map((l) => [l, { image: this.#images.get(l) ?? null }])),
      links,
      truncated,
    };
  }
}
