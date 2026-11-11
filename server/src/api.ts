// The app's routes: the devices of every computer, their history, and the account. Settings are
// read and changed through each computer's own agent, not here.
//
// Every route needs a session or an API key (requireUser). API keys are read-only, and keys,
// sessions, users and the internal sync need a session even to be read (requireSession).
// Every route needs a session or an API key (requireUser). Device shapes stay those of the
// agent's own API (snake_case), so a script can talk to either.

import { Hono } from "hono";
import { sql } from "./db.ts";
import { createKey, requireAdmin, requireSession, requireUser, type AppEnv } from "./auth.ts";
import { hostOnline } from "./hosts.ts";
import { maxGap, readHistory } from "./history.ts";
import { HttpError, bad, body, rateLimit, str } from "./http.ts";
import { sha256 } from "./crypto.ts";
import { internalStatus, syncInternal } from "./internal.ts";
import { APP_VERSION, UPDATE_CHECK, internal, oidc } from "./config.ts";
import { updateStatus } from "./updates.ts";
import { isRole, meView, type User } from "./users.ts";

export const api = new Hono<AppEnv>();
api.use("*", requireUser);

// --- Shapes ---

interface HostRow {
  id: string;
  name: string;
  platform: string;
  agentVersion: string;
  pollInterval: number;
  polledAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
}

interface DeviceRow {
  id: string;
  hostId: string | null;
  vendor: string;
  key: string;
  kind: string;
  model: string;
  name: string;
  address: string;
  connected: boolean;
  batteryPercent: number | null;
  batteryState: string | null;
  batteryCharging: boolean | null;
  batteryMillivolts: number | null;
  batteryUpdatedAt: Date | null;
  lastSeenAt: Date | null;
  error: string | null;
  firstSeenAt: Date;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function hostView(h: HostRow) {
  return {
    id: h.id,
    name: h.name,
    platform: h.platform,
    agent_version: h.agentVersion,
    poll_interval: h.pollInterval,
    polled_at: iso(h.polledAt),
    last_seen_at: iso(h.lastSeenAt),
    online: hostOnline(h),
    created_at: iso(h.createdAt),
  };
}

function deviceView(d: DeviceRow, hosts: Map<string, HostRow>) {
  const host = d.hostId ? hosts.get(d.hostId) : undefined;
  const online = !!host && hostOnline(host);
  return {
    id: d.id,
    vendor: d.vendor,
    key: d.key,
    kind: d.kind,
    model: d.model,
    name: d.name,
    address: d.address,
    // Connected to a computer whose agent is still reporting.
    connected: d.connected && online,
    battery:
      d.batteryPercent === null && d.batteryState === null
        ? null
        : { percent: d.batteryPercent, state: d.batteryState ?? "unknown", charging: d.batteryCharging, millivolts: d.batteryMillivolts },
    battery_updated_at: iso(d.batteryUpdatedAt),
    last_seen_at: iso(d.lastSeenAt),
    first_seen_at: iso(d.firstSeenAt),
    error: online ? d.error : null,
    host: host ? { id: host.id, name: host.name, online } : null,
  };
}

async function hostsById() {
  const rows = await sql<HostRow[]>`SELECT * FROM hosts ORDER BY lower(name)`;
  return new Map(rows.map((h) => [h.id, h]));
}

async function device(id: string) {
  const [d] = await sql<DeviceRow[]>`SELECT * FROM devices WHERE id = ${id}`;
  if (!d) throw new HttpError(404, "No device with that id");
  return d;
}


// --- Server ---

api.get("/server", (c) =>
  c.json({
    version: APP_VERSION,
    oidc: oidc ? { name: oidc.name } : null,
    internal: internal ? { url: internal.url, minutes: internal.minutes } : null,
  }),
);

api.get("/updates", async (c) => {
  if (!UPDATE_CHECK) return c.json({ current: APP_VERSION, latest: null, available: false, disabled: true, releasesUrl: "", checkedAt: new Date().toISOString() });
  return c.json(await updateStatus(c.req.query("refresh") === "1"));
});

// --- Devices ---

/** Everything the dashboard and the sidebar show, in one request. */
api.get("/overview", async (c) => {
  const hosts = await hostsById();
  const devices = await sql<DeviceRow[]>`SELECT * FROM devices WHERE vendor <> '' ORDER BY lower(name)`;
  const polled = [...hosts.values()].map((h) => h.polledAt?.getTime() ?? 0);
  return c.json({
    hosts: [...hosts.values()].map((h) => ({ ...hostView(h), devices: devices.filter((d) => d.hostId === h.id).length })),
    devices: devices.map((d) => deviceView(d, hosts)),
    polled_at: polled.length && Math.max(...polled) ? new Date(Math.max(...polled)).toISOString() : null,
  });
});

api.get("/devices/:id", async (c) => c.json(deviceView(await device(c.req.param("id")!), await hostsById())));

api.get("/devices/:id/history", async (c) => {
  const d = await device(c.req.param("id")!);
  const hours = Math.min(Math.max(Number(c.req.query("hours") ?? 24) || 24, 1), 24 * 365);
  const until = new Date();
  const since = new Date(until.getTime() - hours * 3_600_000);
  const host = d.hostId ? (await hostsById()).get(d.hostId) : undefined;
  return c.json(await readHistory(d.id, since, until, maxGap(host?.pollInterval ?? 30)));
});


/** Forget a device (it comes back if an agent sees it again). Its history goes with it. */
api.delete("/devices/:id", requireAdmin, async (c) => {
  await sql`DELETE FROM devices WHERE id = ${c.req.param("id")!}`;
  return c.json({ ok: true });
});

// --- Computers ---

api.get("/hosts", async (c) => {
  const hosts = await hostsById();
  return c.json([...hosts.values()].map(hostView));
});

/** Adds a computer and returns its agent key, shown once. */
api.post("/hosts", requireAdmin, async (c) => {
  const name = str((await body(c)).name, 80);
  if (!name) throw bad("Give the computer a name");
  const id = crypto.randomUUID();
  await sql`INSERT INTO hosts (id, name) VALUES (${id}, ${name})`;
  const { key } = await createKey("agent", name, { hostId: id });
  return c.json({ id, name, key }, 201);
});

api.patch("/hosts/:id", requireAdmin, async (c) => {
  const name = str((await body(c)).name, 80);
  if (!name) throw bad("Give the computer a name");
  const [row] = await sql`UPDATE hosts SET name = ${name}, updated_at = now() WHERE id = ${c.req.param("id")!} RETURNING id`;
  if (!row) throw new HttpError(404, "Unknown computer");
  return c.json({ ok: true });
});

// --- Linking a computer from the desktop app ---

const LINK_MINUTES = 10;

/**
 * The browser side: a signed-in admin approves the computer the desktop app asked to link
 * (/link?challenge=…&name=…). Creates the computer; its key is created when the app claims it.
 */
api.post("/link", requireSession, requireAdmin, async (c) => {
  const b = await body(c);
  const challenge = str(b.challenge, 64).toLowerCase();
  const name = str(b.name, 80);
  if (!/^[0-9a-f]{64}$/.test(challenge)) throw bad("This link is malformed: start again from the desktop app");
  if (!name) throw bad("Give the computer a name");
  const [taken] = await sql`SELECT 1 FROM link_grants WHERE challenge = ${challenge}`;
  if (taken) throw new HttpError(409, "This computer is already approved: go back to the desktop app");
  const id = crypto.randomUUID();
  await sql.begin(async (tx) => {
    await tx`INSERT INTO hosts (id, name) VALUES (${id}, ${name})`;
    await tx`
      INSERT INTO link_grants (challenge, user_id, host_id, expires_at)
      VALUES (${challenge}, ${c.get("user").id}, ${id}, ${new Date(Date.now() + LINK_MINUTES * 60_000)})`;
  });
  return c.json({ id, name }, 201);
});

/**
 * The desktop side, with its (read-only) API key: polls until the computer is approved, then gets
 * its agent key, once. The secret proves it is the app that asked; the approval must be by the
 * owner of the key.
 */
api.get("/link/claim", async (c) => {
  rateLimit(c, "link-claim", 120, 60_000);
  const secret = c.req.header("X-Link-Secret") ?? "";
  if (secret.length < 32) throw bad("Send the link secret as X-Link-Secret");
  const [grant] = await sql<{ userId: string; hostId: string; name: string }[]>`
    SELECT g.user_id, g.host_id, h.name FROM link_grants g JOIN hosts h ON h.id = g.host_id
    WHERE g.challenge = ${sha256(secret)} AND g.expires_at > ${new Date()}`;
  if (!grant) throw new HttpError(404, "Not approved yet");
  if (grant.userId !== c.get("user").id) throw new HttpError(403, "Approve the computer with the account the desktop app is connected with");
  await sql`DELETE FROM link_grants WHERE host_id = ${grant.hostId}`;
  await sql`DELETE FROM api_keys WHERE host_id = ${grant.hostId}`;
  const { key } = await createKey("agent", grant.name, { hostId: grant.hostId });
  return c.json({ hostId: grant.hostId, name: grant.name, key });
});

/** A new agent key for the computer; the old one stops working at once. */
api.post("/hosts/:id/key", requireAdmin, async (c) => {
  const [host] = await sql<{ id: string; name: string }[]>`SELECT id, name FROM hosts WHERE id = ${c.req.param("id")!}`;
  if (!host) throw new HttpError(404, "Unknown computer");
  await sql`DELETE FROM api_keys WHERE host_id = ${host.id}`;
  const { key } = await createKey("agent", host.name, { hostId: host.id });
  return c.json({ key });
});

/** Removes a computer and its key. Its devices and their history stay. */
api.delete("/hosts/:id", requireAdmin, async (c) => {
  await sql`DELETE FROM hosts WHERE id = ${c.req.param("id")!}`;
  return c.json({ ok: true });
});


// --- Account ---

api.patch("/profile", async (c) => {
  const name = str((await body(c)).name, 80);
  await sql`UPDATE users SET name = ${name} WHERE id = ${c.get("user").id}`;
  const [u] = await sql<User[]>`SELECT * FROM users WHERE id = ${c.get("user").id}`;
  return c.json(meView(u));
});

api.get("/sessions", requireSession, async (c) => {
  const current = c.get("session")?.id;
  const rows = await sql<{ id: string; method: string; userAgent: string; ip: string; createdAt: Date; lastSeenAt: Date }[]>`
    SELECT id, method, user_agent, ip, created_at, last_seen_at FROM sessions
    WHERE user_id = ${c.get("user").id} AND expires_at > now() ORDER BY last_seen_at DESC`;
  // The id is the token's hash: expose a short reference instead.
  return c.json(rows.map((s) => ({ ...s, id: s.id.slice(0, 16), current: s.id === current })));
});

api.delete("/sessions/:id", async (c) => {
  const ref = c.req.param("id")!;
  if (!/^[0-9a-f]{16}$/.test(ref)) throw bad();
  await sql`DELETE FROM sessions WHERE user_id = ${c.get("user").id} AND substr(id, 1, 16) = ${ref}`;
  return c.json({ ok: true });
});

/** Personal API keys: for the desktop app and scripts. They act as you. */
api.get("/keys", requireSession, async (c) => {
  const rows = await sql`
    SELECT id, name, created_at, last_used_at FROM api_keys WHERE user_id = ${c.get("user").id} ORDER BY created_at DESC`;
  return c.json(rows);
});

api.post("/keys", async (c) => {
  const name = str((await body(c)).name, 80) || "API key";
  const [{ count }] = await sql<{ count: number }[]>`SELECT count(*) AS count FROM api_keys WHERE user_id = ${c.get("user").id}`;
  if (count >= 50) throw bad("Delete an old key first");
  const { id, key } = await createKey("user", name, { userId: c.get("user").id });
  return c.json({ id, name, key }, 201);
});

api.delete("/keys/:id", async (c) => {
  await sql`DELETE FROM api_keys WHERE id = ${c.req.param("id")!} AND user_id = ${c.get("user").id}`;
  return c.json({ ok: true });
});

/** Everything about the devices, as JSON: the Data page's download. */
api.get("/export", async (c) => {
  const [hosts, devices, runs] = await Promise.all([
    sql`SELECT id, name, platform, agent_version, poll_interval, polled_at, last_seen_at, created_at FROM hosts ORDER BY name`,
    sql`SELECT * FROM devices ORDER BY name`,
    sql`SELECT device_id, started_at, ended_at, percent, state, millivolts, host_id FROM battery_runs ORDER BY device_id, started_at`,
  ]);
  c.header("Content-Disposition", `attachment; filename="devices-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.json({ exportedAt: new Date().toISOString(), hosts, devices, batteryRuns: runs });
});

// --- internal.bayfield.dev ---

api.get("/internal", requireSession, requireAdmin, async (c) => c.json(await internalStatus()));

api.post("/internal/sync", requireAdmin, async (c) => {
  if (!internal) throw new HttpError(409, "internal.bayfield.dev isn't configured (INTERNAL_URL, INTERNAL_API_KEY)");
  return c.json(await syncInternal());
});

// --- Users (admins) ---

api.get("/users", requireSession, requireAdmin, async (c) => {
  const rows = await sql<User[]>`SELECT * FROM users ORDER BY created_at`;
  return c.json(rows.map((u) => ({ ...meView(u), lastSeenAt: u.lastSeenAt })));
});

api.patch("/users/:id", requireAdmin, async (c) => {
  const role = (await body(c)).role;
  if (!isRole(role)) throw bad("Unknown role");
  if (c.req.param("id")! === c.get("user").id && role !== "admin") throw bad("You can't remove your own admin rights");
  await sql`UPDATE users SET role = ${role} WHERE id = ${c.req.param("id")!}`;
  return c.json({ ok: true });
});

api.delete("/users/:id", requireAdmin, async (c) => {
  if (c.req.param("id")! === c.get("user").id) throw bad("You can't delete your own account here");
  await sql`DELETE FROM users WHERE id = ${c.req.param("id")!}`;
  return c.json({ ok: true });
});
