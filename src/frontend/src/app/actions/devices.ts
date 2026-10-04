"use server";

import { refresh } from "next/cache";

import * as api from "@/lib/api";
import { verifySession } from "@/lib/dal";
import type { ActionResult, BatteryHistory, Settings, SettingsChanges } from "@/lib/types";

function failure(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
}

/** Poll every device now rather than waiting for the API's next round. */
export async function refreshDevices(): Promise<ActionResult> {
  await verifySession();
  try {
    await api.refreshDevices();
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true };
}

/** The battery history over another range than the one the page was rendered with. */
export async function loadHistory(id: string, hours: number): Promise<ActionResult<BatteryHistory>> {
  await verifySession();
  try {
    return { ok: true, data: await api.getHistory(id, hours) };
  } catch (error) {
    return failure(error);
  }
}

/** Change some settings; returns them all, read back from the device. */
export async function updateSettings(id: string, changes: SettingsChanges): Promise<ActionResult<Settings>> {
  await verifySession();
  try {
    return { ok: true, data: await api.updateSettings(id, changes) };
  } catch (error) {
    return failure(error);
  }
}

/**
 * A one-shot action: play, pause, power_off, pairing...
 *
 * No `refresh()` afterwards: none of these change a setting the page shows,
 * and re-rendering would re-read every setting over Bluetooth for nothing.
 */
export async function runAction(
  id: string,
  action: string,
  params: Record<string, unknown> = {},
): Promise<ActionResult> {
  await verifySession();
  try {
    await api.runAction(id, action, params);
  } catch (error) {
    return failure(error);
  }
  return { ok: true };
}
