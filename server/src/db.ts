// PostgreSQL connection and schema migrations.
//
// Columns are snake_case in the database and camelCase in JS (postgres.camel transform).

import postgres from "postgres";
import { DATABASE_URL } from "./config.ts";

export const sql = postgres(DATABASE_URL, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  // Close idle connections: each one is a Postgres process holding several MB.
  idle_timeout: 60,
  onnotice: () => {},
  transform: postgres.camel,
});

export type Sql = typeof sql;

const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE users (
    id text PRIMARY KEY,
    name text NOT NULL DEFAULT '',
    email text UNIQUE,
    oidc_sub text UNIQUE,
    -- Viewers look, admins also manage computers and users.
    role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'admin')),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz
  );

  CREATE TABLE sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method text NOT NULL,
    user_agent text NOT NULL DEFAULT '',
    ip text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE oidc_states (
    state text PRIMARY KEY,
    verifier text NOT NULL,
    nonce text NOT NULL,
    expires_at timestamptz NOT NULL
  );

  -- A computer the devices are connected to, running the agent (agent/ in this repository).
  CREATE TABLE hosts (
    id text PRIMARY KEY,
    name text NOT NULL,
    platform text NOT NULL DEFAULT '',
    agent_version text NOT NULL DEFAULT '',
    poll_interval integer NOT NULL DEFAULT 30,
    polled_at timestamptz,
    last_seen_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  -- API keys. Only the SHA-256 is stored; the key itself is shown once, when it's created.
  --  user:  a person's key, for the desktop app and scripts (acts as that person).
  --  agent: a computer's key, for its agent to report its devices (nothing else).
  CREATE TABLE api_keys (
    id text PRIMARY KEY,
    key_hash text NOT NULL UNIQUE,
    kind text NOT NULL CHECK (kind IN ('user', 'agent')),
    name text NOT NULL DEFAULT '',
    user_id text REFERENCES users(id) ON DELETE CASCADE,
    host_id text REFERENCES hosts(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    CHECK ((kind = 'user') = (user_id IS NOT NULL) AND (kind = 'agent') = (host_id IS NOT NULL))
  );
  CREATE INDEX api_keys_user ON api_keys(user_id);
  CREATE INDEX api_keys_host ON api_keys(host_id);

  -- Every device an agent has seen. A device that moves between computers (Bluetooth
  -- headphones) keeps its id: host_id is the computer it was last connected to.
  CREATE TABLE devices (
    id text PRIMARY KEY,
    host_id text REFERENCES hosts(id) ON DELETE SET NULL,
    vendor text NOT NULL,
    key text NOT NULL,
    kind text NOT NULL,
    model text NOT NULL,
    name text NOT NULL,
    address text NOT NULL DEFAULT '',
    connected boolean NOT NULL DEFAULT false,
    battery_percent smallint,
    battery_state text,
    battery_charging boolean,
    battery_millivolts integer,
    battery_updated_at timestamptz,
    last_seen_at timestamptz,
    error text,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX devices_host ON devices(host_id);

  -- Battery history as runs: consecutive polls that returned the same level and charging state
  -- (the agent's model, see agent/src/api/services/history.py).
  CREATE TABLE battery_runs (
    device_id text NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    started_at timestamptz NOT NULL,
    ended_at timestamptz NOT NULL,
    percent smallint NOT NULL CHECK (percent BETWEEN 0 AND 100),
    state text NOT NULL,
    millivolts integer,
    host_id text REFERENCES hosts(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, started_at)
  );
  CREATE INDEX battery_runs_device ON battery_runs(device_id, ended_at);
  CREATE INDEX battery_runs_updated ON battery_runs(updated_at, device_id, started_at);


  CREATE TABLE kv (key text PRIMARY KEY, value jsonb NOT NULL);
  `,
];

export async function migrate() {
  await sql.begin(async (tx) => {
    // Several containers starting at once: only one migrates.
    await tx`SELECT pg_advisory_xact_lock(4242030)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const [{ v }] = await tx<{ v: number }[]>`SELECT coalesce(max(version), 0)::int AS v FROM schema_migrations`;
    for (let i = v; i < MIGRATIONS.length; i++) {
      await tx.unsafe(MIGRATIONS[i]);
      await tx`INSERT INTO schema_migrations (version) VALUES (${i + 1})`;
      console.log(`Database migrated to version ${i + 1}`);
    }
  });
}

export async function getKv<T>(key: string): Promise<T | null> {
  const [row] = await sql<{ value: T }[]>`SELECT value FROM kv WHERE key = ${key}`;
  return row?.value ?? null;
}

export async function setKv(key: string, value: unknown) {
  await sql`INSERT INTO kv (key, value) VALUES (${key}, ${sql.json(value as never)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}
