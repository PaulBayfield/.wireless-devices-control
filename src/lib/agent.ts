// The agent running on this computer (agent/ in this repository): devices are controlled through
// it, never through the server. Its address and token are kept on this device only.

import { useCallback, useEffect, useState } from "react";
import type { Battery, Settings, SettingsChanges } from "./api";

export interface AgentConnection {
  url: string;
  token: string;
}

const STORAGE_KEY = "devices.agent";
export const DEFAULT_AGENT_URL = "http://127.0.0.1:7000";

export function loadAgent(): AgentConnection | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as AgentConnection | null;
    return raw?.url && raw.token ? raw : null;
  } catch {
    return null;
  }
}

export function saveAgent(c: AgentConnection | null) {
  try {
    if (c) localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: c.url.replace(/\/+$/, ""), token: c.token }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not critical.
  }
  window.dispatchEvent(new Event("devices:agent"));
}

export class AgentError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Calls the local agent's API ({success, data | message} answers). */
export async function agentCall<T>(c: AgentConnection, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${c.url}/v1${path}`, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${c.token}`, ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new AgentError(0, "The agent on this computer isn't answering. Is it running?");
  }
  const json = (await res.json().catch(() => null)) as { data?: T; message?: string } | null;
  if (!res.ok) throw new AgentError(res.status, json?.message ?? `The agent answered ${res.status}`);
  return json?.data as T;
}

export const readSettings = (c: AgentConnection, id: string) => agentCall<Settings>(c, `/devices/${encodeURIComponent(id)}/settings`);
export const applySettings = (c: AgentConnection, id: string, changes: SettingsChanges) =>
  agentCall<Settings>(c, `/devices/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: changes });
export const runAction = (c: AgentConnection, id: string, action: string, params: Record<string, unknown> = {}) =>
  agentCall<null>(c, `/devices/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`, { body: params });
export const refreshAgent = (c: AgentConnection) => agentCall<unknown>(c, "/devices/refresh", { method: "POST" });

/** A device as this computer's agent sees it right now. */
export interface LocalDevice {
  id: string;
  connected: boolean;
  battery: Battery | null;
  battery_updated_at: string | null;
  last_seen_at: string | null;
  error: string | null;
}

interface LocalDevices {
  devices: LocalDevice[];
}

/** While the app is visible, how often it asks the agent (which then polls every second). */
const WATCH_MS = 2_000;
/** While hidden: just enough to know which devices are here. */
const IDLE_MS = 30_000;

/**
 * The local agent and the devices it sees: those are the ones this computer can control.
 *
 * While the app is visible it asks every 2 s with `?watch=1`: the agent then reads the
 * batteries every second, and the app shows those live readings for this computer's devices
 * (the server gets them every 10 s). Hidden, it checks every 30 s without watching, and the
 * agent goes back to its battery-friendly 30-60 s rate.
 */
export function useLocalAgent() {
  const [agent, setAgent] = useState(loadAgent);
  const [devices, setDevices] = useState<Map<string, LocalDevice> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const onChange = () => setAgent(loadAgent());
    window.addEventListener("devices:agent", onChange);
    return () => window.removeEventListener("devices:agent", onChange);
  }, []);

  useEffect(() => {
    if (!agent) {
      setDevices(null);
      setError(null);
      return;
    }
    let live = true;
    let timer: number | undefined;
    const visible = () => document.visibilityState === "visible";
    const check = async () => {
      window.clearTimeout(timer);
      try {
        const list = await agentCall<LocalDevices>(agent, visible() ? "/devices?watch=1" : "/devices");
        if (!live) return;
        setDevices(new Map(list.devices.map((d) => [d.id, d])));
        setError(null);
      } catch (e) {
        if (!live) return;
        setDevices(null);
        setError((e as Error).message);
      }
      if (live) timer = window.setTimeout(check, visible() ? WATCH_MS : IDLE_MS);
    };
    // Coming back to the window: watch again at once.
    const onVisible = () => visible() && void check();
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return () => {
      live = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [agent, nonce]);

  const recheck = useCallback(() => setNonce((n) => n + 1), []);
  const ids = devices ? new Set(devices.keys()) : null;
  return { agent, devices, ids, error, recheck };
}

export type LocalAgent = ReturnType<typeof useLocalAgent>;
