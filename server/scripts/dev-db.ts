// Local PostgreSQL for development without Docker (embedded-postgres: real Postgres binaries from npm).
//   npm run db:dev    then DATABASE_URL=postgres://postgres:devices@127.0.0.1:5438/devices
// Data lives in server/data/postgres. Not for production.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

const port = Number(process.env.DEV_DB_PORT ?? 5438);
const databaseDir = fileURLToPath(new URL("../data/postgres", import.meta.url));

const pg = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "devices",
  port,
  persistent: true,
  onLog: (m) => process.env.DEV_DB_VERBOSE && console.log(m),
});

if (!existsSync(databaseDir)) await pg.initialise();
await pg.start();

// On Windows the cluster's default encoding is the ANSI code page (WIN1252), which can't store emoji
// or non-Latin names, and initdb hangs when asked for UTF-8. So the app gets its own UTF-8 database.
const admin = postgres(`postgres://postgres:devices@127.0.0.1:${port}/postgres`, { onnotice: () => {} });
const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = 'devices'`;
if (!exists) await admin.unsafe(`CREATE DATABASE devices ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
await admin.end();
console.log(`Dev Postgres on postgres://postgres:devices@127.0.0.1:${port}/devices`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
