// Database access. One small interface over two engines:
//  - DATABASE_URL set  → real Postgres (Supabase) through the `postgres` package
//  - not set           → PGlite, Postgres compiled to WebAssembly, running inside this
//                        process. Data is kept in ./.data/pg (or in memory for tests).
// Both run the same SQL, so what works locally works on Supabase.
//
//   db.query(sql, params)  → array of rows
//   db.one(sql, params)    → first row or null
//   db.tx(async (t) => …)  → runs in a transaction; t has query/one
//
// JSON columns: pass JSON.stringify(value) and cast with $n::jsonb.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, "..", "sql");

function wrap(queryFn, execFn) {
  return {
    query: queryFn,
    one: async (text, params) => (await queryFn(text, params))[0] || null,
    exec: execFn, // several statements, no parameters
  };
}

export async function openDb({ url, dir } = {}) {
  let db;
  if (url) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, {
      max: Number(process.env.DB_POOL || 5),
      prepare: false, // works with Supabase's transaction pooler too
      idle_timeout: 30,
      connect_timeout: 15,
      onnotice: () => {},
    });
    const q = (s) => async (text, params = []) => [...(await s.unsafe(text, params))];
    const x = (s) => (text) => s.unsafe(text).simple();
    db = {
      kind: "postgres",
      ...wrap(q(sql), x(sql)),
      tx: (fn) => sql.begin((t) => fn(wrap(q(t), x(t)))),
      close: () => sql.end({ timeout: 5 }),
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    if (dir) await fs.mkdir(dir, { recursive: true });
    const pg = new PGlite(dir || undefined);
    // PGlite runs one statement at a time; queue so concurrent requests don't interleave
    // inside someone else's transaction.
    let chain = Promise.resolve();
    const serial = (fn) => {
      const run = chain.then(fn, fn);
      chain = run.catch(() => {});
      return run;
    };
    const q = (c) => async (text, params = []) => (await c.query(text, params)).rows;
    db = {
      kind: "pglite",
      query: (text, params) => serial(() => q(pg)(text, params)),
      one: async (text, params) => (await serial(() => q(pg)(text, params)))[0] || null,
      tx: (fn) => serial(() => pg.transaction((t) => fn(wrap(q(t), (text) => t.exec(text))))),
      exec: (text) => serial(() => pg.exec(text)),
      close: () => pg.close(),
    };
  }
  await migrate(db);
  return db;
}

// Applies sql/NNN_name.sql files that haven't run yet, in order.
async function migrate(db) {
  await db.exec(`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now());
alter table schema_migrations enable row level security;`);
  const done = new Set((await db.query("select version from schema_migrations")).map((r) => r.version));
  const files = (await fs.readdir(MIGRATIONS)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const text = await fs.readFile(path.join(MIGRATIONS, f), "utf8");
    await db.tx(async (t) => {
      await t.exec(text);
      await t.query("insert into schema_migrations (version) values ($1)", [f]);
    });
    console.log(`Database: applied ${f}`);
  }
}
