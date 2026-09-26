"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import type { Settings } from "@/lib/types";

interface DeviceSettingsState {
  settings: Settings | null;
  setSettings: (settings: Settings) => void;
}

const DeviceSettingsContext = createContext<DeviceSettingsState | null>(null);

/**
 * One copy of a device's settings for the whole page, so the controls and
 * the 3D view agree: a colour applied in the lighting panel shows on the
 * model at once. `initial` is null for a device that is not connected.
 */
export function DeviceSettingsProvider({ initial, children }: { initial: Settings | null; children: ReactNode }) {
  const [settings, setSettings] = useState(initial);
  return (
    <DeviceSettingsContext.Provider value={{ settings, setSettings }}>{children}</DeviceSettingsContext.Provider>
  );
}

export function useDeviceSettings(): DeviceSettingsState | null {
  return useContext(DeviceSettingsContext);
}
