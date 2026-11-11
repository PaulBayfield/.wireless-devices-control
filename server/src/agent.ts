// The route the agents call after every poll, with their computer's key (see agent/src/api/services/central.py).
// Agents only send data here: devices are controlled through each computer's own agent API.

import { Hono } from "hono";
import { sql } from "./db.ts";
import { requireAgent, type AgentEnv } from "./auth.ts";
import { bad, body, int, str } from "./http.ts";

export const agent = new Hono<AgentEnv>();
agent.use("*", requireAgent);

const STATES = new Set(["discharging", "charging", "full", "not charging", "error", "unknown"]);
const MAX_DEVICES = 200;
const MAX_RUNS = 1000;

const date = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** One device as the agent's DeviceState.to_dict() describes it. */
function parseDevice(raw: unknown, hostId: string) {
  const d = record(raw);
  const id = str(d.id, 120);
  if (!id) throw bad("A device has no id");
  const battery = d.battery ? record(d.battery) : null;
  const state = str(battery?.state, 20);
  return {
    id,
    hostId,
    vendor: str(d.vendor, 40),
    key: str(d.key, 40),
    kind: str(d.kind, 40),
    model: str(d.model, 120),
    name: str(d.name, 120) || id,
    address: str(d.address, 120),
    connected: d.connected === true,
    batteryPercent: int(battery?.percent, 0, 100),
    batteryState: battery ? (STATES.has(state) ? state : "unknown") : null,
    batteryCharging: typeof battery?.charging === "boolean" ? battery.charging : null,
    batteryMillivolts: int(battery?.millivolts, 0, 100_000),
    batteryUpdatedAt: date(d.battery_updated_at),
    lastSeenAt: date(d.last_seen_at),
    error: str(d.error, 500) || null,
  };
}

/** One battery run from the agent's history (times in Unix seconds). */
function parseRun(raw: unknown, hostId: string) {
  const r = record(raw);
  const deviceId = str(r.device_id, 120);
  const started = int(r.started_at, 0, 4_102_444_800);
  const ended = int(r.ended_at, 0, 4_102_444_800);
  const percent = int(r.percent, 0, 100);
  if (!deviceId || started === null || ended === null || ended < started || percent === null) throw bad("A battery run is malformed");
  const state = str(r.state, 20);
  return {
    deviceId,
    startedAt: new Date(started * 1000),
    endedAt: new Date(ended * 1000),
    percent,
    state: STATES.has(state) ? state : "unknown",
    millivolts: int(r.millivolts, 0, 100_000),
    hostId,
  };
}

// After every poll: the computer, its devices, and the battery runs not acknowledged yet.
agent.post("/report", async (c) => {
  const hostId = c.get("hostId");
  const b = await body(c);
  const host = record(b.host);
  const devices = Array.isArray(b.devices) ? b.devices : [];
  const runs = Array.isArray(b.runs) ? b.runs : [];
  if (devices.length > MAX_DEVICES || runs.length > MAX_RUNS) throw bad(`At most ${MAX_DEVICES} devices and ${MAX_RUNS} runs per report`);

  const deviceRows = devices.map((d) => parseDevice(d, hostId));
  const runRows = runs.map((r) => parseRun(r, hostId));

  await sql.begin(async (tx) => {
    await tx`
      UPDATE hosts SET
        platform = ${str(host.platform, 120)},
        agent_version = ${str(host.agent_version, 40)},
        poll_interval = ${int(host.poll_interval, 1, 86_400) ?? 30},
        polled_at = coalesce(${date(b.polled_at)}, polled_at),
        last_seen_at = now(),
        updated_at = now()
      WHERE id = ${hostId}`;

    if (deviceRows.length) {
      // A device moves between computers (headphones): the one it is connected to wins, and a
      // computer that merely remembers it doesn't overwrite what the other one reads.
      await tx`
        INSERT INTO devices ${tx(deviceRows)}
        ON CONFLICT (id) DO UPDATE SET
          host_id = EXCLUDED.host_id,
          vendor = EXCLUDED.vendor,
          key = EXCLUDED.key,
          kind = EXCLUDED.kind,
          model = EXCLUDED.model,
          name = EXCLUDED.name,
          address = EXCLUDED.address,
          connected = EXCLUDED.connected,
          battery_percent = coalesce(EXCLUDED.battery_percent, devices.battery_percent),
          battery_state = coalesce(EXCLUDED.battery_state, devices.battery_state),
          battery_charging = coalesce(EXCLUDED.battery_charging, devices.battery_charging),
          battery_millivolts = coalesce(EXCLUDED.battery_millivolts, devices.battery_millivolts),
          battery_updated_at = greatest(EXCLUDED.battery_updated_at, devices.battery_updated_at),
          last_seen_at = greatest(EXCLUDED.last_seen_at, devices.last_seen_at),
          error = EXCLUDED.error,
          updated_at = now()
        WHERE EXCLUDED.connected OR devices.host_id IS NULL OR devices.host_id = EXCLUDED.host_id OR NOT devices.connected`;
    }

    if (runRows.length) {
      // The agent only keeps devices in memory, so an old run may be for a device not seen since
      // it restarted: give it a placeholder that the next sighting fills in.
      const known = new Set(deviceRows.map((d) => d.id));
      const missing = [...new Set(runRows.map((r) => r.deviceId))].filter((id) => !known.has(id));
      if (missing.length) {
        await tx`
          INSERT INTO devices ${tx(missing.map((id) => ({ id, hostId, vendor: "", key: id.split("-")[0], kind: "", model: "", name: id })))}
          ON CONFLICT (id) DO NOTHING`;
      }
      // Runs are keyed by device and start: the open one comes back at every report with a later end.
      await tx`
        INSERT INTO battery_runs ${tx(runRows)}
        ON CONFLICT (device_id, started_at) DO UPDATE SET
          ended_at = greatest(battery_runs.ended_at, EXCLUDED.ended_at),
          millivolts = EXCLUDED.millivolts,
          host_id = EXCLUDED.host_id,
          updated_at = now()
        WHERE battery_runs.ended_at < EXCLUDED.ended_at OR battery_runs.millivolts IS NOT excluded.millivolts`;
    }
  });

  return c.json({ ok: true, devices: deviceRows.length, runs: runRows.length });
});
