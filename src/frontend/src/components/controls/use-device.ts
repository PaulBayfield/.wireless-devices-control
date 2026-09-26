"use client";

import { useState, useTransition } from "react";

import { runAction, updateSettings } from "@/app/actions/devices";
import type { Settings, SettingsChanges } from "@/lib/types";

/**
 * A device's settings on the client. Every change goes through a Server
 * Action, and the settings shown are always the ones the device read back --
 * never an optimistic guess that the device may have refused.
 */
export function useDevice(id: string, initial: Settings) {
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(changes: SettingsChanges) {
    startTransition(async () => {
      const result = await updateSettings(id, changes);
      if (result.ok) {
        setSettings(result.data!);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }

  function act(action: string, params: Record<string, unknown> = {}, done?: string) {
    startTransition(async () => {
      const result = await runAction(id, action, params);
      setError(result.ok ? null : result.error);
      setNotice(result.ok ? (done ?? null) : null);
    });
  }

  return { settings, save, act, pending, error, notice };
}
