// Talking to the Devices server.
//  - Web: same origin, with the session cookie (Vite proxies /api in development).
//  - Desktop: the server the app was connected to, with a personal API key (see desktop.ts).

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const isTauri = "__TAURI_INTERNALS__" in window;

/** Where the API is and how to authenticate; null on the web (same origin, cookie). */
let connection: { url: string; key: string } | null = null;

export function setConnection(c: { url: string; key: string } | null) {
  connection = c ? { url: c.url.replace(/\/+$/, ""), key: c.key } : null;
}

export const serverUrl = () => connection?.url ?? location.origin;

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";
  if (connection) headers.Authorization = `Bearer ${connection.key}`;
  let res: Response;
  try {
    res = await fetch(`${connection?.url ?? ""}/api${path}`, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: connection ? "omit" : "same-origin",
    });
  } catch {
    throw new ApiError(0, "Can't reach the server");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("devices:signed-out"));
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

// --- Types (mirroring the server) ---

/** Viewers look, collaborators also change device settings, admins manage computers and users. */
export const ROLES = ["viewer", "collaborator", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Whether someone may change settings and press buttons (everyone but viewers). */
export const canControl = (u: { role: Role }) => u.role !== "viewer";

export interface Me {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  ssoLinked: boolean;
  createdAt: string;
  /** Signed in with an API key (the desktop app): it can read, not change anything. */
  readOnly?: boolean;
}

export interface AuthConfig {
  oidc: { name: string } | null;
  dev: boolean;
}

export interface ServerInfo {
  version: string;
  oidc: { name: string } | null;
  internal: { url: string; minutes: number } | null;
}

export interface Session {
  id: string;
  method: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface UpdateStatus {
  current: string;
  latest: { version: string; url: string; publishedAt: string | null } | null;
  available: boolean;
  releasesUrl: string;
  checkedAt: string;
  error?: string;
  disabled?: boolean;
}

export interface InternalStatus {
  configured: boolean;
  url: string | null;
  minutes: number | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
  runsSent: number;
  pending: number;
}

export interface UserRow extends Me {
  lastSeenAt: string | null;
}

// Devices: the shapes of the agent's own API (snake_case), relayed by the server.

export type ChargeState = "discharging" | "charging" | "full" | "not charging" | "error" | "unknown";

export interface Battery {
  percent: number | null;
  state: ChargeState;
  charging: boolean | null;
  millivolts: number | null;
}

/** A computer running the agent. */
export interface Host {
  id: string;
  name: string;
  platform: string;
  agent_version: string;
  poll_interval: number;
  polled_at: string | null;
  last_seen_at: string | null;
  online: boolean;
  created_at: string;
  devices?: number;
}

export interface Device {
  id: string;
  vendor: string;
  key: string;
  kind: "headphones" | "speaker" | "mouse" | "phone" | string;
  model: string;
  name: string;
  address: string;
  connected: boolean;
  battery: Battery | null;
  battery_updated_at: string | null;
  last_seen_at: string | null;
  first_seen_at: string | null;
  error: string | null;
  host: { id: string; name: string; online: boolean } | null;
}

export interface Overview {
  hosts: Host[];
  devices: Device[];
  polled_at: string | null;
}

/** Consecutive polls that returned the same level and charging state. */
export interface HistoryReading {
  from: string;
  to: string;
  percent: number;
  state: ChargeState;
  millivolts: number | null;
  /** The device was not read between the previous reading and this one. */
  gap: boolean;
}

export interface HistoryPhase {
  state: ChargeState;
  /** Deduced from a rising level, on a device that does not report its charging state. */
  inferred: boolean;
  from: string;
  to: string;
  from_percent: number;
  to_percent: number;
}

export interface BatteryHistory {
  since: string;
  until: string;
  readings: HistoryReading[];
  phases: HistoryPhase[];
}

export interface EqBand {
  band: string;
  value: number;
  min: number;
  max: number;
}

export interface ModeSlot {
  slot: number;
  name: string;
  editable: boolean;
  configured: boolean;
  cnc: number;
  wind_block: boolean;
}

export interface ZoneLight {
  effect: "off" | "static" | "breathe" | "cycle" | "ripple" | "unknown" | string;
  /** "rrggbb", or null for effects without a colour. */
  color: string | null;
  source: "profile" | "last set";
}

/** Everything is optional: a device only reports the settings it has. */
export interface Settings {
  name?: string | null;
  actions: string[];
  // Bose
  volume?: { level: number; max: number; safe_max: number };
  eq?: EqBand[];
  source?: { kind: string; address: string | null };
  standby_minutes?: number | null;
  multipoint?: boolean | null;
  prompts?: { enabled: boolean | null; language: string | null };
  sidetone?: { level: string | null; levels: string[] };
  cnc?: { level: number | null; max: number };
  mode?: { current: number | null; modes: ModeSlot[] };
  info?: { firmware?: string | null; serial?: string | null; mac?: string | null; model?: string | null };
  // Logitech
  dpi?: { value: number; default: number; min: number; max: number; step: number };
  report_rate?: { value: number; supported: number[] };
  onboard_mode?: { value: string; modes: string[] };
  led?: {
    zones: string[];
    effects: string[];
    current: Record<string, ZoneLight> | null;
    source: "profile" | "last set" | "mixed" | null;
  };
}

export type SettingsChanges = Record<string, unknown>;
