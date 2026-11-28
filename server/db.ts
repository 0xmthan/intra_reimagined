// Postgres store for data that never changes (a student's piscine), so each login hits the
// 42 API once, ever, even across restarts.
import postgres from 'postgres';

export interface Piscine {
  login: string;
  month: string | null;
  year: string | null;
  /** Primary campus, needed to list the rest of the piscine (null on rows saved before it existed). */
  campusId: number | null;
}

export interface PiscineStudent {
  login: string;
  name: string;
  image: string | null;
  active: boolean;
  /** C Piscine level, e.g. 8.07 (null if they have no C Piscine cursus). */
  piscineLevel: number | null;
  /** 42cursus level; null = didn't get into the common core. */
  cursusLevel: number | null;
  /** 42cursus blackhole date (ISO); in the past = blackholed. */
  blackholedAt: string | null;
  /** When 42 ended their 42cursus (ISO); in the past = blackholed, even when blackholedAt was never updated. */
  cursusEndAt: string | null;
}

export interface PiscineList {
  campusId: number;
  year: string;
  month: string;
  students: PiscineStudent[];
  refreshedAt: Date;
}

/** One evaluation: [project id (0 = unknown), filled in at (ms), team id, scale team id]; rows saved earlier lack the ids. */
export type PartnerEval = [project: number, at: number, team?: number, scaleTeam?: number];

/** A 42 project's name and slug (projects.intra.42.fr/<slug>/<login> is a student's page for it). */
export interface ProjectName {
  name: string;
  slug: string;
}

/** Where a campus's active students are on the Common Core (milestones.ts). */
export interface MilestoneStudent {
  login: string;
  image: string | null;
  /** 0–6: how many Common Core ranks in a row they validated, from rank 00. */
  milestone: number;
  /** Done with the Common Core (rank 06 or the Common Core quest validated, or graded Transcender). */
  transcended: boolean;
  level: number;
}

/** What a student did as an evaluator (counts over their filled-in evaluations). */
export interface EvalStats {
  login: string;
  total: number;
  failed: number;
  outstanding: number;
  /** login → how many (filled-in) evaluations this student did of them. */
  partners: Record<string, number>;
  /** login → those evaluations (see PartnerEval). Absent on rows saved before it was kept. */
  partnerEvals?: Record<string, PartnerEval[]> | null;
  /** The newest filled-in evaluation counted (ms): hourly refreshes only ask 42 for later ones. */
  lastFilledAt?: number | null;
  /** When the whole history was last read from 42 (daily, to catch anything changed after the fact). */
  fullAt?: Date | null;
  refreshedAt: Date;
}

/** One logtime session at a campus computer (logtime.ts); endAt null = still logged in. */
export interface Session {
  id: number;
  beginAt: Date;
  endAt: Date | null;
}

/** One patronage (family.ts): `patron` patrons `child`. */
export interface Patronage {
  id: number;
  child: string;
  patron: string;
  childImage: string | null;
  patronImage: string | null;
  ongoing: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IrUser {
  hidden: boolean;
  mode: string | null;
  accent: string | null;
  shareTheme: boolean;
}

export class Db {
  readonly #sql: postgres.Sql;

  constructor(url: string) {
    this.#sql = postgres(url, { max: 5, onnotice: () => {} });
  }

  async init() {
    await this.#sql`
      create table if not exists piscines (
        login      text primary key,
        month      text,
        year       text,
        fetched_at timestamptz not null default now()
      )`;
    await this.#sql`alter table piscines add column if not exists campus_id integer`;
    await this.#sql`
      create table if not exists piscine_students (
        campus_id    integer not null,
        year         text not null,
        month        text not null,
        students     jsonb not null,
        refreshed_at timestamptz not null default now(),
        primary key (campus_id, year, month)
      )`;
    await this.#sql`
      create table if not exists eval_stats (
        login        text primary key,
        total        integer not null,
        failed       integer not null,
        outstanding  integer not null,
        refreshed_at timestamptz not null default now()
      )`;
    await this.#sql`alter table eval_stats add column if not exists partners jsonb`;
    await this.#sql`alter table eval_stats add column if not exists partner_evals jsonb`;
    await this.#sql`alter table eval_stats add column if not exists last_filled_at timestamptz`;
    await this.#sql`alter table eval_stats add column if not exists full_at timestamptz`;
    // 42 project names by id (evals.ts): they never change, so each is asked of 42 once.
    await this.#sql`create table if not exists project_names (id integer primary key, name text not null)`;
    await this.#sql`alter table project_names add column if not exists slug text`;
    // Each campus's active students and their milestone (milestones.ts), refreshed every few hours.
    await this.#sql`
      create table if not exists campus_milestones (
        campus_id    integer primary key,
        students     jsonb not null,
        refreshed_at timestamptz not null default now()
      )`;
    // One custom banner per student (banners.ts); served publicly by its content hash.
    await this.#sql`
      create table if not exists banners (
        login      text primary key,
        hash       text not null,
        type       text not null,
        data       bytea not null,
        updated_at timestamptz not null default now()
      )`;
    await this.#sql`create index if not exists banners_hash on banners (hash)`;
    // Outstanding flags each student got, per project slug (outstanding.ts).
    await this.#sql`
      create table if not exists outstanding (
        login        text primary key,
        projects     jsonb not null,
        refreshed_at timestamptz not null default now()
      )`;
    // Up to two achievements each student pins on their Achievements card (by name).
    await this.#sql`
      create table if not exists achievement_pins (
        login      text primary key,
        names      jsonb not null,
        updated_at timestamptz not null default now()
      )`;
    // Students who signed in to the extension (for the "Intra Reimagined" badge); hidden = opted out.
    await this.#sql`
      create table if not exists ir_users (
        login      text primary key,
        hidden     boolean not null default false,
        first_seen timestamptz not null default now(),
        last_seen  timestamptz not null default now()
      )`;
    // Their theme (settings.ts), and whether visitors of their profile see it too.
    await this.#sql`alter table ir_users add column if not exists mode text`;
    await this.#sql`alter table ir_users add column if not exists accent text`;
    await this.#sql`alter table ir_users add column if not exists share_theme boolean not null default true`;
    // Every patronage on 42 (family.ts keeps it in sync and in memory).
    await this.#sql`
      create table if not exists patronages (
        id           integer primary key,
        child        text not null,
        patron       text not null,
        child_image  text,
        patron_image text,
        ongoing      boolean not null,
        created_at   timestamptz not null,
        updated_at   timestamptz not null
      )`;
    // Every logtime session (logtime.ts): fetched once per student, then only new ones are added.
    await this.#sql`
      create table if not exists locations (
        id       bigint primary key,
        login    text not null,
        begin_at timestamptz not null,
        end_at   timestamptz
      )`;
    await this.#sql`create index if not exists locations_login on locations (login, begin_at)`;
    await this.#sql`
      create table if not exists logtime_sync (
        login     text primary key,
        synced_at timestamptz not null default now()
      )`;
    // Friends lists: `owner` follows `friend`. One-way and private: nothing tells the friend.
    await this.#sql`
      create table if not exists friends (
        owner    text not null,
        friend   text not null,
        added_at timestamptz not null default now(),
        primary key (owner, friend)
      )`;
    // Logins per primary campus (campus.ts), for a campus's patronage families.
    await this.#sql`
      create table if not exists campus_members (
        campus_id    integer primary key,
        logins       jsonb not null,
        refreshed_at timestamptz not null default now()
      )`;
  }

  /** When `login`'s full history was last synced; undefined = never fetched. */
  async getLogtimeSync(login: string): Promise<Date | undefined> {
    const [row] = await this.#sql<{ syncedAt: Date }[]>`select synced_at as "syncedAt" from logtime_sync where login = ${login}`;
    return row?.syncedAt;
  }

  async getLocations(login: string): Promise<Session[]> {
    return this.#sql<Session[]>`
      select id::float8 as id, begin_at as "beginAt", end_at as "endAt" from locations where login = ${login} order by begin_at`;
  }

  /** Adds new sessions and updates ones that closed since, then marks `login` synced. */
  async saveLocations(login: string, rows: Session[]) {
    await this.#sql.begin(async (tx) => {
      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000).map((r) => ({ id: r.id, login, begin_at: r.beginAt, end_at: r.endAt }));
        await tx`
          insert into locations ${tx(chunk)}
          on conflict (id) do update set begin_at = excluded.begin_at, end_at = excluded.end_at`;
      }
      await tx`
        insert into logtime_sync (login) values (${login})
        on conflict (login) do update set synced_at = now()`;
    });
  }

  /** `owner`'s friends, oldest first. */
  async getFriends(owner: string): Promise<{ login: string; addedAt: Date }[]> {
    return this.#sql<{ login: string; addedAt: Date }[]>`
      select friend as login, added_at as "addedAt" from friends where owner = ${owner} order by added_at, friend`;
  }

  /** Adds `friend` unless `owner` already has `max` friends; false = the list is full. */
  async addFriend(owner: string, friend: string, max: number): Promise<boolean> {
    const rows = await this.#sql`
      insert into friends (owner, friend)
      select ${owner}::text, ${friend}::text where (select count(*) from friends where owner = ${owner}) < ${max}::int
      on conflict (owner, friend) do nothing
      returning 1`;
    if (rows.length) return true;
    const [had] = await this.#sql`select 1 from friends where owner = ${owner} and friend = ${friend}`;
    return !!had; // already on the list counts as added
  }

  async removeFriend(owner: string, friend: string) {
    await this.#sql`delete from friends where owner = ${owner} and friend = ${friend}`;
  }

  async getCampusMembers(campusId: number): Promise<{ logins: string[]; refreshedAt: Date } | undefined> {
    const [row] = await this.#sql<{ logins: string[]; refreshedAt: Date }[]>`
      select logins, refreshed_at as "refreshedAt" from campus_members where campus_id = ${campusId}`;
    return row;
  }

  async saveCampusMembers(campusId: number, logins: string[]) {
    await this.#sql`
      insert into campus_members (campus_id, logins) values (${campusId}, ${this.#sql.json(logins)})
      on conflict (campus_id) do update set logins = excluded.logins, refreshed_at = now()`;
  }

  async getPatronages(): Promise<Patronage[]> {
    return this.#sql<Patronage[]>`
      select id, child, patron, child_image as "childImage", patron_image as "patronImage", ongoing,
        created_at as "createdAt", updated_at as "updatedAt" from patronages`;
  }

  async upsertPatronages(rows: Patronage[], sql: postgres.Sql | postgres.TransactionSql = this.#sql) {
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000).map((r) => ({
        id: r.id,
        child: r.child,
        patron: r.patron,
        child_image: r.childImage,
        patron_image: r.patronImage,
        ongoing: r.ongoing,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      }));
      await sql`
        insert into patronages ${sql(chunk)}
        on conflict (id) do update set child = excluded.child, patron = excluded.patron,
          child_image = excluded.child_image, patron_image = excluded.patron_image, ongoing = excluded.ongoing,
          created_at = excluded.created_at, updated_at = excluded.updated_at`;
    }
  }

  /** Swaps in a complete list (rows gone from 42 go here too), in one transaction. */
  async replacePatronages(rows: Patronage[]) {
    await this.#sql.begin(async (tx) => {
      await tx`delete from patronages`;
      await this.upsertPatronages(rows, tx);
    });
  }

  async getBannerOf(login: string): Promise<{ hash: string; type: string } | undefined> {
    const [row] = await this.#sql<{ hash: string; type: string }[]>`select hash, type from banners where login = ${login}`;
    return row;
  }

  async getBannerData(hash: string): Promise<{ type: string; data: Buffer } | undefined> {
    const [row] = await this.#sql<{ type: string; data: Buffer }[]>`select type, data from banners where hash = ${hash} limit 1`;
    return row;
  }

  async saveBanner(login: string, hash: string, type: string, data: Buffer) {
    await this.#sql`
      insert into banners (login, hash, type, data) values (${login}, ${hash}, ${type}, ${data})
      on conflict (login) do update set hash = excluded.hash, type = excluded.type, data = excluded.data, updated_at = now()`;
  }

  async deleteBanner(login: string) {
    await this.#sql`delete from banners where login = ${login}`;
  }

  async getOutstanding(login: string): Promise<{ login: string; projects: Record<string, number>; refreshedAt: Date } | undefined> {
    const [row] = await this.#sql<{ login: string; projects: Record<string, number>; refreshedAt: Date }[]>`
      select login, projects, refreshed_at as "refreshedAt" from outstanding where login = ${login}`;
    return row;
  }

  async saveOutstanding(login: string, projects: Record<string, number>) {
    await this.#sql`
      insert into outstanding (login, projects) values (${login}, ${this.#sql.json(projects)})
      on conflict (login) do update set projects = excluded.projects, refreshed_at = now()`;
  }

  async getPins(login: string): Promise<string[]> {
    const [row] = await this.#sql<{ names: string[] }[]>`select names from achievement_pins where login = ${login}`;
    return row?.names ?? [];
  }

  async savePins(login: string, names: string[]) {
    if (!names.length) {
      await this.#sql`delete from achievement_pins where login = ${login}`;
      return;
    }
    await this.#sql`
      insert into achievement_pins (login, names) values (${login}, ${this.#sql.json(names)})
      on conflict (login) do update set names = excluded.names, updated_at = now()`;
  }

  /** Records that `login` used the extension just now. */
  async touchIrUser(login: string) {
    await this.#sql`
      insert into ir_users (login) values (${login})
      on conflict (login) do update set last_seen = now()`;
  }

  /** undefined if they never signed in to the extension. */
  async getIrUser(login: string): Promise<IrUser | undefined> {
    const [row] = await this.#sql<IrUser[]>`
      select hidden, mode, accent, share_theme as "shareTheme" from ir_users where login = ${login}`;
    return row;
  }

  /** Saves the given theme fields (null = back to the default), leaving the others as they are. */
  async setIrTheme(login: string, t: { mode?: string | null; accent?: string | null; shareTheme?: boolean }) {
    const cur = await this.getIrUser(login);
    const mode = t.mode !== undefined ? t.mode : (cur?.mode ?? null);
    const accent = t.accent !== undefined ? t.accent : (cur?.accent ?? null);
    const share = t.shareTheme ?? cur?.shareTheme ?? true;
    await this.#sql`
      insert into ir_users (login, mode, accent, share_theme) values (${login}, ${mode}, ${accent}, ${share})
      on conflict (login) do update set mode = excluded.mode, accent = excluded.accent,
        share_theme = excluded.share_theme, last_seen = now()`;
  }

  async setIrHidden(login: string, hidden: boolean) {
    await this.#sql`
      insert into ir_users (login, hidden) values (${login}, ${hidden})
      on conflict (login) do update set hidden = excluded.hidden, last_seen = now()`;
  }

  async getEvalStats(login: string): Promise<EvalStats | undefined> {
    const [row] = await this.#sql<(Omit<EvalStats, 'lastFilledAt'> & { lastFilledAt: Date | null })[]>`
      select login, total, failed, outstanding, partners, partner_evals as "partnerEvals",
        last_filled_at as "lastFilledAt", full_at as "fullAt", refreshed_at as "refreshedAt"
      from eval_stats where login = ${login}`;
    return row && { ...row, lastFilledAt: row.lastFilledAt ? row.lastFilledAt.getTime() : null };
  }

  async saveEvalStats(s: Omit<EvalStats, 'refreshedAt'>) {
    const last = s.lastFilledAt ? new Date(s.lastFilledAt) : null;
    const full = s.fullAt ?? null;
    await this.#sql`
      insert into eval_stats (login, total, failed, outstanding, partners, partner_evals, last_filled_at, full_at)
      values (${s.login}, ${s.total}, ${s.failed}, ${s.outstanding}, ${this.#sql.json(s.partners)}, ${this.#sql.json(s.partnerEvals ?? {})}, ${last}, ${full})
      on conflict (login) do update set total = excluded.total, failed = excluded.failed,
        outstanding = excluded.outstanding, partners = excluded.partners, partner_evals = excluded.partner_evals,
        last_filled_at = excluded.last_filled_at, full_at = excluded.full_at, refreshed_at = now()`;
  }

  /** Rows saved before slugs were kept are left out, so they're asked of 42 again. */
  async getProjectNames(ids: number[]): Promise<Map<number, ProjectName>> {
    if (!ids.length) return new Map();
    const rows = await this.#sql<{ id: number; name: string; slug: string }[]>`
      select id, name, slug from project_names where id = any(${ids}) and slug is not null`;
    return new Map(rows.map((r) => [r.id, { name: r.name, slug: r.slug }]));
  }

  async saveProjectNames(names: Map<number, ProjectName>) {
    if (!names.size) return;
    const rows = [...names].map(([id, p]) => ({ id, name: p.name, slug: p.slug }));
    await this.#sql`
      insert into project_names ${this.#sql(rows, 'id', 'name', 'slug')}
      on conflict (id) do update set name = excluded.name, slug = excluded.slug`;
  }

  async getCampusMilestones(campusId: number): Promise<{ students: MilestoneStudent[]; refreshedAt: Date } | undefined> {
    const [row] = await this.#sql<{ students: MilestoneStudent[]; refreshedAt: Date }[]>`
      select students, refreshed_at as "refreshedAt" from campus_milestones where campus_id = ${campusId}`;
    return row;
  }

  async saveCampusMilestones(campusId: number, students: MilestoneStudent[]) {
    await this.#sql`
      insert into campus_milestones (campus_id, students) values (${campusId}, ${this.#sql.json(students)})
      on conflict (campus_id) do update set students = excluded.students, refreshed_at = now()`;
  }

  async getPiscine(login: string): Promise<Piscine | undefined> {
    const [row] = await this.#sql<Piscine[]>`
      select login, month, year, campus_id as "campusId" from piscines where login = ${login}`;
    return row;
  }

  async savePiscine(p: Piscine) {
    await this.#sql`
      insert into piscines (login, month, year, campus_id) values (${p.login}, ${p.month}, ${p.year}, ${p.campusId})
      on conflict (login) do update set month = excluded.month, year = excluded.year,
        campus_id = excluded.campus_id, fetched_at = now()`;
  }

  async getPiscineList(campusId: number, year: string, month: string): Promise<PiscineList | undefined> {
    const [row] = await this.#sql<PiscineList[]>`
      select campus_id as "campusId", year, month, students, refreshed_at as "refreshedAt"
      from piscine_students where campus_id = ${campusId} and year = ${year} and month = ${month}`;
    return row;
  }

  async savePiscineList(l: Omit<PiscineList, 'refreshedAt'>) {
    await this.#sql`
      insert into piscine_students (campus_id, year, month, students)
      values (${l.campusId}, ${l.year}, ${l.month}, ${this.#sql.json(l.students as unknown as postgres.JSONValue)})
      on conflict (campus_id, year, month) do update set students = excluded.students, refreshed_at = now()`;
  }

  async ping() {
    await this.#sql`select 1`;
  }

  close() {
    return this.#sql.end({ timeout: 5 });
  }
}
