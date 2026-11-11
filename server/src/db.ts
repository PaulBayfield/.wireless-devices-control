// The database: one SQLite file, through Node's built-in node:sqlite (no server to run).
//
// Queries are written as tagged templates, sql`SELECT … WHERE id = ${id}`, which bind every value
// as a parameter. Columns are snake_case in the database and camelCase in JS. Times are stored as
// Unix milliseconds and come back as Dates for every column ending in _at. A single process owns
// the file (WAL mode), which is all this server needs.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { DATABASE_PATH } from "./config.ts";

mkdirSync(dirname(DATABASE_PATH), { recursive: true });
export const db = new DatabaseSync(DATABASE_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");

// What the queries use from Postgres: now() in milliseconds, and greatest()/least() that skip NULLs.
db.function("now", { deterministic: false }, () => Date.now());
const pick = (better: (a: number, b: number) => boolean) => (...values: unknown[]) =>
  values.reduce<number | null>((best, v) => (typeof v !== "number" ? best : best === null || better(v, best) ? v : best), null);
db.function("greatest", { varargs: true, deterministic: true }, pick((a, b) => a > b));
db.function("least", { varargs: true, deterministic: true }, pick((a, b) => a < b));

/** Columns stored as 0/1 that the app reads as booleans. */
const BOOLEAN_COLUMNS = new Set(["connected", "batteryCharging"]);

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

class Json {
  readonly value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }
}

function bindValue(v: unknown): SQLInputValue {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Json) return JSON.stringify(v.value);
  if (typeof v === "object") return JSON.stringify(v);
  return v as SQLInputValue;
}

function readRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    const key = toCamel(column);
    out[key] =
      column.endsWith("_at") && typeof value === "number" ? new Date(value) : BOOLEAN_COLUMNS.has(key) && typeof value === "number" ? value === 1 : value;
  }
  return out;
}

/** A piece of SQL with its parameters, to nest in another query. */
class Fragment {
  readonly text: string;
  readonly params: SQLInputValue[];
  constructor(text: string, params: SQLInputValue[]) {
    this.text = text;
    this.params = params;
  }
}

/** Rows to insert: sql`INSERT INTO t ${sql(rows)}` expands to (columns) VALUES (…), (…). */
class Rows {
  readonly rows: Record<string, unknown>[];
  constructor(rows: Record<string, unknown>[]) {
    this.rows = rows;
  }
  toFragment(): Fragment {
    const columns = Object.keys(this.rows[0] ?? {});
    const params: SQLInputValue[] = [];
    const tuples = this.rows.map((row) => {
      for (const c of columns) params.push(bindValue(row[c]));
      return `(${columns.map(() => "?").join(", ")})`;
    });
    return new Fragment(`(${columns.map(toSnake).join(", ")}) VALUES ${tuples.join(", ")}`, params);
  }
}

/** A query: runs when awaited, or nests in another query as a fragment. */
class Query<T> implements PromiseLike<T> {
  readonly fragment: Fragment;
  constructor(fragment: Fragment) {
    this.fragment = fragment;
  }
  run(): T {
    const statement = db.prepare(this.fragment.text);
    if (!statement.columns().length) {
      statement.run(...this.fragment.params);
      return [] as T;
    }
    return (statement.all(...this.fragment.params) as Record<string, unknown>[]).map(readRow) as T;
  }
  then<A = T, B = never>(onFulfilled?: ((value: T) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    let result: Promise<T>;
    try {
      result = Promise.resolve(this.run());
    } catch (e) {
      result = Promise.reject(e);
    }
    return result.then(onFulfilled, onRejected);
  }
  catch<B = never>(onRejected: (reason: unknown) => B | PromiseLike<B>) {
    return this.then(undefined, onRejected);
  }
}

function compile(strings: TemplateStringsArray, values: unknown[]): Fragment {
  let text = strings[0];
  const params: SQLInputValue[] = [];
  values.forEach((v, i) => {
    const inner = v instanceof Query ? v.fragment : v instanceof Rows ? v.toFragment() : v instanceof Fragment ? v : null;
    if (inner) {
      text += inner.text;
      params.push(...inner.params);
    } else {
      text += "?";
      params.push(bindValue(v));
    }
    text += strings[i + 1];
  });
  return new Fragment(text, params);
}

type Rowset = Record<string, unknown>[];

export interface Sql {
  <T = Rowset>(strings: TemplateStringsArray, ...values: unknown[]): Query<T>;
  (rows: Record<string, unknown>[]): Rows;
  /** A JSON value for a TEXT column. */
  json(value: unknown): Json;
  /**
   * Runs `fn` in a transaction. node:sqlite is synchronous and the callbacks only await queries,
   * which resolve at once, so no other request runs in between.
   */
  begin<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}

export const sql = ((first: TemplateStringsArray | Record<string, unknown>[], ...values: unknown[]) =>
  "raw" in first ? new Query(compile(first, values)) : new Rows(first)) as Sql;

sql.json = (value) => new Json(value);
sql.begin = async (fn) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = await fn(sql);
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
};

/** Now, in the database's unit (Unix milliseconds), for DEFAULT clauses. */
const NOW = "(CAST(unixepoch('subsec') * 1000 AS INTEGER))";

const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    email TEXT UNIQUE,
    oidc_sub TEXT UNIQUE,
    -- Viewers look, admins also manage computers and users.
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'admin')),
    created_at INTEGER NOT NULL DEFAULT ${NOW},
    last_seen_at INTEGER
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT ${NOW},
    last_seen_at INTEGER NOT NULL DEFAULT ${NOW},
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE oidc_states (
    state TEXT PRIMARY KEY,
    verifier TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- A computer the devices are connected to, running the agent (agent/ in this repository).
  CREATE TABLE hosts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT '',
    agent_version TEXT NOT NULL DEFAULT '',
    poll_interval INTEGER NOT NULL DEFAULT 30,
    polled_at INTEGER,
    last_seen_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT ${NOW},
    updated_at INTEGER NOT NULL DEFAULT ${NOW}
  );

  -- API keys. Only the SHA-256 is stored; the key itself is shown once, when it's created.
  --  user:  a person's key, for the desktop app and scripts (read-only).
  --  agent: a computer's key, for its agent to report its devices (nothing else).
  CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('user', 'agent')),
    name TEXT NOT NULL DEFAULT '',
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    host_id TEXT REFERENCES hosts(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT ${NOW},
    last_used_at INTEGER,
    CHECK ((kind = 'user') = (user_id IS NOT NULL) AND (kind = 'agent') = (host_id IS NOT NULL))
  );
  CREATE INDEX api_keys_user ON api_keys(user_id);
  CREATE INDEX api_keys_host ON api_keys(host_id);

  -- Every device an agent has seen. A device that moves between computers (Bluetooth
  -- headphones) keeps its id: host_id is the computer it was last connected to.
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL,
    vendor TEXT NOT NULL,
    key TEXT NOT NULL,
    kind TEXT NOT NULL,
    model TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    connected INTEGER NOT NULL DEFAULT 0,
    battery_percent INTEGER,
    battery_state TEXT,
    battery_charging INTEGER,
    battery_millivolts INTEGER,
    battery_updated_at INTEGER,
    last_seen_at INTEGER,
    error TEXT,
    first_seen_at INTEGER NOT NULL DEFAULT ${NOW},
    updated_at INTEGER NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX devices_host ON devices(host_id);

  -- Battery history as runs: consecutive polls that returned the same level and charging state
  -- (the agent's model, see agent/src/api/services/history.py).
  CREATE TABLE battery_runs (
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    percent INTEGER NOT NULL CHECK (percent BETWEEN 0 AND 100),
    state TEXT NOT NULL,
    millivolts INTEGER,
    host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (device_id, started_at)
  ) WITHOUT ROWID;
  CREATE INDEX battery_runs_device ON battery_runs(device_id, ended_at);
  CREATE INDEX battery_runs_updated ON battery_runs(updated_at, device_id, started_at);

  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

/** Applies the migrations the file doesn't have yet (PRAGMA user_version). Never edit an applied one: append. */
export async function migrate() {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    console.log(`Database migrated to version ${i + 1}`);
  }
}

export async function getKv<T>(key: string): Promise<T | null> {
  const [row] = await sql<{ value: string }[]>`SELECT value FROM kv WHERE key = ${key}`;
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function setKv(key: string, value: unknown) {
  await sql`INSERT INTO kv (key, value) VALUES (${key}, ${sql.json(value)}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
}
