/** Shapes returned by the device API (`src/api` in the Python project). */

export type ChargeState =
  | "discharging"
  | "charging"
  | "full"
  | "not charging"
  | "error"
  | "unknown";

export interface Battery {
  percent: number | null;
  state: ChargeState;
  charging: boolean | null;
  millivolts: number | null;
}

export interface Device {
  id: string;
  vendor: string;
  key: string;
  kind: "headphones" | "speaker" | "mouse" | string;
  model: string;
  name: string;
  address: string;
  connected: boolean;
  battery: Battery | null;
  battery_updated_at: string | null;
  last_seen_at: string | null;
  error: string | null;
}

export interface DevicesList {
  devices: Device[];
  polled_at: string | null;
  poll_interval: number;
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
  /** "profile": the onboard profile holds it; "last set": set from here. */
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
  info?: { firmware: string | null; serial: string | null; mac: string | null };
  // Logitech
  dpi?: { value: number; default: number; min: number; max: number; step: number };
  report_rate?: { value: number; supported: number[] };
  onboard_mode?: { value: string; modes: string[] };
  led?: {
    zones: string[];
    effects: string[];
    /** What each zone shows now; null when unknown (host mode, nothing set yet). */
    current: Record<string, ZoneLight> | null;
    /** Where `current` comes from: one source for every zone, "mixed", or null when unknown. */
    source: "profile" | "last set" | "mixed" | null;
  };
}

export type SettingsChanges = Record<string, unknown>;

/** What a Server Action hands back to the client. */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };
