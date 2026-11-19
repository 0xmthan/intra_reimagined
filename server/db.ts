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
}

export interface PiscineList {
  campusId: number;
  year: string;
  month: string;
  students: PiscineStudent[];
  refreshedAt: Date;
}

/** What a student did as an evaluator (counts over their filled-in evaluations). */
export interface EvalStats {
  login: string;
  total: number;
  failed: number;
  outstanding: number;
  /** login → how many (filled-in) evaluations this student did of them. */
  partners: Record<string, number>;
  refreshedAt: Date;
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
    // Logins per primary campus (campus.ts), for a campus's patronage families.
    await this.#sql`
      create table if not exists campus_members (
        campus_id    integer primary key,
        logins       jsonb not null,
        refreshed_at timestamptz not null default now()
      )`;
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

  async getEvalStats(login: string): Promise<EvalStats | undefined> {
    const [row] = await this.#sql<EvalStats[]>`
      select login, total, failed, outstanding, partners, refreshed_at as "refreshedAt" from eval_stats where login = ${login}`;
    return row;
  }

  async saveEvalStats(s: Omit<EvalStats, 'refreshedAt'>) {
    await this.#sql`
      insert into eval_stats (login, total, failed, outstanding, partners)
      values (${s.login}, ${s.total}, ${s.failed}, ${s.outstanding}, ${this.#sql.json(s.partners)})
      on conflict (login) do update set total = excluded.total, failed = excluded.failed,
        outstanding = excluded.outstanding, partners = excluded.partners, refreshed_at = now()`;
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
