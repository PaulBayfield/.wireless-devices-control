import { createContext, useContext, useState } from "react";
import type { Settings, SettingsChanges } from "../../../lib/api";
import { applySettings, runAction, type AgentConnection } from "../../../lib/agent";

export interface DeviceSettingsState {
  id: string;
  agent: AgentConnection;
  settings: Settings;
  setSettings: (settings: Settings) => void;
}

/**
 * One copy of a device's settings for the whole page, so the controls and the 3D view agree:
 * a colour applied in the lighting panel shows on the model at once.
 */
export const DeviceSettingsContext = createContext<DeviceSettingsState | null>(null);

/**
 * A device's settings, changed through this computer's agent. The settings shown are always the
 * ones the device read back, never an optimistic guess that it may have refused.
 */
export function useDevice() {
  const shared = useContext(DeviceSettingsContext);
  if (!shared) throw new Error("useDevice needs a DeviceSettingsContext");
  const { id, agent, settings, setSettings } = shared;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(changes: SettingsChanges) {
    setPending(true);
    try {
      setSettings(await applySettings(agent, id, changes));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function act(action: string, params: Record<string, unknown> = {}, done?: string) {
    setPending(true);
    try {
      await runAction(agent, id, action, params);
      setError(null);
      setNotice(done ?? null);
    } catch (e) {
      setError((e as Error).message);
      setNotice(null);
    } finally {
      setPending(false);
    }
  }

  return { settings, save, act, pending, error, notice };
}
