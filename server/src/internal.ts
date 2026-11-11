// Copying the data to internal.bayfield.dev, the private API my projects share (and load into the
// warehouse from). Every INTERNAL_SYNC_MINUTES:
//
//   PUT  /v1/devices/inventory   every computer and device, as they are now
//   POST /v1/devices/readings    the battery runs that changed since the last sync, in batches
//
// Both are idempotent on the other side (upserts), so a sync that fails half-way is simply
// done again. The key needs the devices:write scope there.

import { sql, getKv, setKv } from "./db.ts";
import { internal } from "./config.ts";

const BATCH = 1000;
/**
 * Runs changed in the last seconds may still be in a transaction that hasn't committed. Kept well
 * under the poll interval: the open run is updated at every poll and must still get sent.
 */
const SETTLE_MS = 5_000;
/** Longest wait internal.bayfield.dev may ask for (429 Retry-After) before the sync gives up until next time. */
const MAX_RETRY_S = 90;
const CURSOR = "internal_runs_cursor";
const STATUS = "internal_status";

/** Where the last sync stopped, as Postgres timestamps in text (microseconds kept). */
interface Cursor {
  updatedAt: string;
  deviceId: string;
  startedAt: string;
}

export interface InternalStatus {
  configured: boolean;
  url: string | null;
  minutes: number | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
  /** Runs sent by the last successful sync. */
  runsSent: number;
  /** Runs changed since then, waiting for the next one. */
  pending: number;
}

async function send(method: "PUT" | "POST", path: string, payload: unknown): Promise<void> {
  const res = await fetch(`${internal!.url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${internal!.key}`, "Content-Type": "application/json", "User-Agent": "devices.bayfield.dev" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  // Rate limited (a long backlog, the first time): wait as asked, then carry on.
  const retry = Number(res.headers.get("Retry-After"));
  if (res.status === 429 && retry > 0 && retry <= MAX_RETRY_S) {
    await new Promise((resolve) => setTimeout(resolve, retry * 1000 + 250));
    return send(method, path, payload);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`${method} ${path}: ${res.status}${data?.message ? ` ${data.message}` : ""}`);
  }
}

let running: Promise<InternalStatus> | null = null;

/** Sends what changed; one sync at a time. */
export function syncInternal(): Promise<InternalStatus> {
  running ??= (async () => {
    const previous = (await getKv<Partial<InternalStatus>>(STATUS)) ?? {};
    const startedAt = new Date().toISOString();
    let runsSent = 0;
    try {
      const hosts = await sql`
        SELECT id, name, platform, agent_version, poll_interval, polled_at, last_seen_at, created_at FROM hosts`;
      // The Bluetooth address stays here: the warehouse has no use for it.
      const devices = await sql`
        SELECT id, host_id, vendor, key, kind, model, name, connected, battery_percent, battery_state, battery_charging,
               battery_millivolts, battery_updated_at, last_seen_at, first_seen_at
        FROM devices WHERE vendor <> ''`;
      await send("PUT", "/v1/devices/inventory", { source: "devices.bayfield.dev", hosts: snake(hosts), devices: snake(devices) });

      let cursor = await getKv<Cursor>(CURSOR);
      const settled = new Date(Date.now() - SETTLE_MS);
      for (;;) {
        // Keyset pagination on (updated_at, device_id, started_at): no run is skipped or sent forever.
        // The cursor keeps Postgres' microseconds (as text): a JS Date would cut them, and a whole batch
        // shares one updated_at, so it would come back again and again. Sent as text: postgres.js would turn
        // a parameter typed timestamptz into a Date, cutting them again.
        const rows = await sql<{ deviceId: string; hostId: string | null; startedAt: Date; endedAt: Date; percent: number; state: string; millivolts: number | null; cursorUpdated: string; cursorStarted: string }[]>`
          SELECT device_id, host_id, started_at, ended_at, percent, state, millivolts,
                 updated_at::text AS cursor_updated, started_at::text AS cursor_started
          FROM battery_runs
          WHERE updated_at < ${settled}
            ${cursor ? sql`AND (updated_at, device_id, started_at) > (${cursor.updatedAt}::text::timestamptz, ${cursor.deviceId}, ${cursor.startedAt}::text::timestamptz)` : sql``}
          ORDER BY updated_at, device_id, started_at
          LIMIT ${BATCH}`;
        if (!rows.length) break;
        await send("POST", "/v1/devices/readings", {
          runs: rows.map((r) => ({
            device_id: r.deviceId,
            host_id: r.hostId,
            started_at: r.startedAt.toISOString(),
            ended_at: r.endedAt.toISOString(),
            percent: r.percent,
            state: r.state,
            millivolts: r.millivolts,
          })),
        });
        const last = rows[rows.length - 1];
        cursor = { updatedAt: last.cursorUpdated, deviceId: last.deviceId, startedAt: last.cursorStarted };
        await setKv(CURSOR, cursor);
        runsSent += rows.length;
        if (rows.length < BATCH) break;
      }
      const status = { lastSyncAt: startedAt, lastSuccessAt: startedAt, error: null, runsSent };
      await setKv(STATUS, status);
    } catch (e) {
      const error = (e as Error).message;
      console.warn("internal.bayfield.dev sync failed:", error);
      await setKv(STATUS, { ...previous, lastSyncAt: startedAt, error, runsSent });
    } finally {
      running = null;
    }
    return internalStatus();
  })();
  return running;
}

export async function internalStatus(): Promise<InternalStatus> {
  const s = (await getKv<Partial<InternalStatus>>(STATUS)) ?? {};
  const cursor = await getKv<Cursor>(CURSOR);
  const [{ pending }] = await sql<{ pending: number }[]>`
    SELECT count(*)::int AS pending FROM battery_runs
    ${cursor ? sql`WHERE (updated_at, device_id, started_at) > (${cursor.updatedAt}::text::timestamptz, ${cursor.deviceId}, ${cursor.startedAt}::text::timestamptz)` : sql``}`;
  return {
    configured: !!internal,
    url: internal?.url ?? null,
    minutes: internal?.minutes ?? null,
    lastSyncAt: s.lastSyncAt ?? null,
    lastSuccessAt: s.lastSuccessAt ?? null,
    error: s.error ?? null,
    runsSent: s.runsSent ?? 0,
    pending,
  };
}

/** Rows come back camelCased; internal.bayfield.dev speaks snake_case. */
function snake(rows: readonly object[]) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`), v])));
}

/** Starts the periodic sync, when configured. */
export function startInternalSync() {
  if (!internal) return;
  const tick = () => void syncInternal();
  setTimeout(tick, 15_000);
  setInterval(tick, internal.minutes * 60_000);
}
