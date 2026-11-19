// Postgres store for data that never changes (a student's piscine), so each login hits the
// 42 API once, ever, even across restarts.
import postgres from 'postgres';

export interface Piscine {
  login: string;
  month: string | null;
  year: string | null;
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
  }

  async getPiscine(login: string): Promise<Piscine | undefined> {
    const [row] = await this.#sql<Piscine[]>`select login, month, year from piscines where login = ${login}`;
    return row;
  }

  async savePiscine(p: Piscine) {
    await this.#sql`
      insert into piscines (login, month, year) values (${p.login}, ${p.month}, ${p.year})
      on conflict (login) do update set month = excluded.month, year = excluded.year, fetched_at = now()`;
  }

  async ping() {
    await this.#sql`select 1`;
  }

  close() {
    return this.#sql.end({ timeout: 5 });
  }
}
