// What every part of the signed-in app can reach: the user, the devices, navigation.

import { createContext, useContext } from "react";
import type { Device, Host, Me, Overview, ServerInfo } from "./api";
import type { LocalAgent } from "./agent";
import type { Route } from "./router";

export type SettingsPage = "profile" | "preferences" | "thisComputer" | "security" | "data" | "computers" | "users" | "internal" | "shortcuts" | "about";

/** The sidebar's lists. */
export type ListFilter = "all" | "low" | "charging";

/** At or below this, a device needs charging. */
export const LOW_BATTERY = 20;

export interface AppContextValue {
  me: Me;
  setMe: (me: Me) => void;
  server: ServerInfo | undefined;
  route: Route;
  query: Record<string, string>;
  navigate: (route: Route, replace?: boolean) => void;
  setQuery: (patch: Record<string, string | undefined>, replace?: boolean) => void;
  overview: Overview | undefined;
  reloadOverview: () => void;
  /** The devices the sidebar's filter and the preferences leave, in display order. */
  visible: Device[];
  list: ListFilter;
  host: Host | undefined;
  openDevice: (id: string | null) => void;
  /** The agent on this computer, through which its devices are controlled. */
  local: LocalAgent;
  /** Whether this computer's agent can reach the device (and so change its settings). */
  isLocal: (deviceId: string) => boolean;
  /** Ask this computer's agent to poll now, then reload. */
  refresh: () => Promise<void>;
  refreshing: boolean;
  openSettings: (page?: SettingsPage) => void;
  signOut: () => void;
  sidebarVisible: boolean;
  toggleSidebar: () => void;
  panelVisible: boolean;
  togglePanel: () => void;
  openSearch: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error("useApp outside the app");
  return v;
}

export const isLow = (d: Device) => d.battery?.percent != null && d.battery.percent <= LOW_BATTERY;
export const isCharging = (d: Device) => d.connected && (d.battery?.state === "charging" || d.battery?.charging === true);

export function matches(d: Device, list: ListFilter, host: string | undefined): boolean {
  if (host && d.host?.id !== host) return false;
  if (list === "low") return isLow(d);
  if (list === "charging") return isCharging(d);
  return true;
}

/** Connected first, then lowest battery (what needs charging) or by name. */
export function sortDevices(devices: Device[], sort: "battery" | "name"): Device[] {
  return [...devices].sort(
    (a, b) =>
      Number(b.connected) - Number(a.connected) ||
      (sort === "battery" ? (a.battery?.percent ?? 101) - (b.battery?.percent ?? 101) : 0) ||
      a.name.localeCompare(b.name),
  );
}
