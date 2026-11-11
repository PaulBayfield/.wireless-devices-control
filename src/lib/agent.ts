// The agent running on this computer, started by the desktop app (see src-tauri/src/agent.rs).
// Devices are controlled through it, never through the server. The app talks to it on its stdin
// and stdout, through Rust: no port, no token. In a browser there is no agent: the data is shown,
// the controls are in the desktop app.

import { useCallback, useEffect, useState } from "react";
import { isTauri, type Battery, type Settings, type SettingsChanges } from "./api";

export class AgentError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** One request to the agent (see agent/src/agent/ipc.py for the methods). */
async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri) throw new AgentError(503, "Devices are controlled from the desktop app");
  try {
    return await invoke<T>("agent_request", { method, params });
  } catch (e) {
    const err = e as { status?: number; message?: string } | string;
    if (typeof err === "string") throw new AgentError(500, err);
    throw new AgentError(err.status ?? 500, err.message ?? "The agent failed");
  }
}

export const readSettings = (id: string) => call<Settings>("settings", { device_id: id });
export const applySettings = (id: string, changes: SettingsChanges) => call<Settings>("apply", { device_id: id, changes });
export const runAction = (id: string, action: string, params: Record<string, unknown> = {}) => call<null>("action", { device_id: id, action, params });
export const refreshAgent = () => call<unknown>("refresh");

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

/** What the desktop app knows about its agent and its link to the server (never the key). */
export interface AgentInfo {
  running: boolean;
  computer: string;
  link: { server: string; host_id: string; name: string } | null;
}

export const getAgentInfo = () => invoke<AgentInfo>("agent_info");
export const unlinkAgent = () => invoke<void>("agent_unlink");
export const saveAgentLink = (link: { server: string; key: string; host_id: string; name: string }) => invoke<void>("agent_link", { link });

/** While the app is visible, how often it tells the agent (which then polls every second). */
const WATCH_MS = 5_000;

/**
 * This computer's agent: whether it runs, the devices it sees (those are the ones this computer
 * can control, with their live readings, pushed after every poll), and its link to the server.
 */
export function useLocalAgent() {
  const [running, setRunning] = useState(false);
  const [devices, setDevices] = useState<Map<string, LocalDevice> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [nonce, setNonce] = useState(0);

  const reloadInfo = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!isTauri) return;
    void getAgentInfo().then(setInfo, () => setInfo(null));
  }, [nonce, running]);

  useEffect(() => {
    if (!isTauri) return;
    let live = true;
    const unlisten: (() => void)[] = [];
    const take = (list: LocalDevices) => live && setDevices(new Map(list.devices.map((d) => [d.id, d])));
    const load = () =>
      call<LocalDevices>("devices").then(
        (list) => {
          take(list);
          setRunning(true);
          setError(null);
        },
        (e: Error) => {
          if (!live) return;
          setRunning(false);
          setError(e.message);
        },
      );
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      unlisten.push(
        await listen<{ event: string; data: LocalDevices }>("agent-event", ({ payload }) => {
          if (payload.event === "devices") take(payload.data);
          else if (payload.event === "ready") void load();
        }),
        await listen<{ running: boolean }>("agent-status", ({ payload }) => {
          setRunning(payload.running);
          if (!payload.running) setError("The agent stopped: starting it again…");
        }),
      );
      if (!live) unlisten.forEach((u) => u());
    });
    void load();

    // The app is open and visible: the agent polls every second while it hears so.
    const watch = () => document.visibilityState === "visible" && void call("watch").catch(() => {});
    watch();
    const timer = window.setInterval(watch, WATCH_MS);
    document.addEventListener("visibilitychange", watch);
    return () => {
      live = false;
      unlisten.forEach((u) => u());
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", watch);
    };
  }, []);

  const ids = devices ? new Set(devices.keys()) : null;
  return { available: isTauri, running, devices, ids, error, info, reloadInfo };
}

export type LocalAgent = ReturnType<typeof useLocalAgent>;

/** A random secret, and its SHA-256 (hex) for the link page. */
async function linkSecret(): Promise<{ secret: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  return { secret, challenge: [...digest].map((b) => b.toString(16).padStart(2, "0")).join("") };
}

/**
 * Links this computer to the server: opens the link page in the browser, where a signed-in admin
 * approves it, then picks up the agent key and hands it to the agent. Resolves with the computer's
 * name; rejects after 10 minutes without an approval, or when `signal` aborts.
 */
export async function linkThisComputer(
  server: string,
  name: string,
  open: (url: string) => Promise<void>,
  claim: (secret: string) => Promise<{ hostId: string; name: string; key: string } | null>,
  signal: AbortSignal,
): Promise<string> {
  const { secret, challenge } = await linkSecret();
  await open(`${server}/link?${new URLSearchParams({ challenge, name })}`);
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until && !signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const grant = await claim(secret);
    if (grant) {
      await saveAgentLink({ server, key: grant.key, host_id: grant.hostId, name: grant.name });
      return grant.name;
    }
  }
  throw new AgentError(408, signal.aborted ? "Cancelled" : "Nobody approved the link in time");
}
