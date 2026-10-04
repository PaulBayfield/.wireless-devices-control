import "server-only";

import type { BatteryHistory, Device, DevicesList, Settings, SettingsChanges } from "./types";

/**
 * The device API client. Server-only: API_TOKEN never reaches the browser,
 * which only ever talks to this Next.js server.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.API_URL;
  if (!base) throw new ApiError(500, "API_URL is not configured.");

  let response: Response;
  try {
    response = await fetch(new URL(path, base), {
      ...init,
      headers: {
        Authorization: `Bearer ${process.env.API_TOKEN ?? ""}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError(503, "The device API is unreachable. Is it running on the device host?");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    throw new ApiError(response.status, body?.message ?? `The device API answered ${response.status}.`);
  }
  return body.data as T;
}

export function getDevices(): Promise<DevicesList> {
  return request<DevicesList>("/v1/devices");
}

export function refreshDevices(): Promise<DevicesList> {
  return request<DevicesList>("/v1/devices/refresh", { method: "POST" });
}

export function getDevice(id: string): Promise<Device> {
  return request<Device>(`/v1/devices/${encodeURIComponent(id)}`);
}

export function getHistory(id: string, hours: number): Promise<BatteryHistory> {
  return request<BatteryHistory>(`/v1/devices/${encodeURIComponent(id)}/history?hours=${hours}`);
}

export function getSettings(id: string): Promise<Settings> {
  return request<Settings>(`/v1/devices/${encodeURIComponent(id)}/settings`);
}

export function updateSettings(id: string, changes: SettingsChanges): Promise<Settings> {
  return request<Settings>(`/v1/devices/${encodeURIComponent(id)}/settings`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export async function runAction(id: string, action: string, params: Record<string, unknown> = {}): Promise<void> {
  await request<unknown>(
    `/v1/devices/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`,
    { method: "POST", body: JSON.stringify(params) },
  );
}
