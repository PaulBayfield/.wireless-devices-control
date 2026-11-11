// The desktop app (Tauri): its server connection, kept in the OS credential store by the Rust
// side, the tray and start at sign-in. Every function is a no-op on the web.

import { useEffect } from "react";
import { isTauri } from "./api";
import type { Translate } from "./i18n";

export interface Connection {
  url: string;
  key: string;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** The server and personal API key this desktop app was connected with, if any. */
export async function loadConnection(): Promise<Connection | null> {
  if (!isTauri) return null;
  try {
    return await invoke<Connection | null>("load_connection");
  } catch {
    return null;
  }
}

export async function saveConnection(c: Connection | null): Promise<void> {
  if (!isTauri) return;
  await invoke("save_connection", { connection: c });
}

/** Opens a page in the default browser (the desktop app), or a new tab (the web). */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

/** Whether the app launches (hidden in the tray) when the user logs in. */
export async function getAutostart(): Promise<boolean> {
  const { isEnabled } = await import("@tauri-apps/plugin-autostart");
  return isEnabled();
}

export async function setAutostart(on: boolean): Promise<void> {
  const { enable, disable } = await import("@tauri-apps/plugin-autostart");
  await (on ? enable() : disable());
}

/** Keeps the native side (tray menu language, close button behaviour) in step with settings. */
export function useDesktopSync(closeToTray: boolean, t: Translate) {
  useEffect(() => {
    if (!isTauri) return;
    void invoke("set_close_to_tray", { enabled: closeToTray }).catch(() => {});
  }, [closeToTray]);

  const labels = JSON.stringify({ open: t("trayOpen"), quit: t("trayQuit") });
  useEffect(() => {
    if (!isTauri) return;
    void invoke("set_tray_labels", JSON.parse(labels)).catch(() => {});
  }, [labels]);
}
