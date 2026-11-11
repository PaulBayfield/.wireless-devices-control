// Small request helpers shared by the routes.

import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { CLIENT_IP_HEADER } from "./config.ts";

export class HttpError extends Error {
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 502 | 503;
  constructor(status: HttpError["status"], message: string) {
    super(message);
    this.status = status;
  }
}

export const bad = (message = "Invalid request") => new HttpError(400, message);

export function clientIp(c: Context): string {
  if (CLIENT_IP_HEADER) {
    // X-Forwarded-For: the proxy appends the address it saw, so only the last entry is trustworthy.
    const ip = c.req.header(CLIENT_IP_HEADER)?.split(",").at(-1)?.trim();
    if (ip) return ip;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

const hits = new Map<string, number[]>();

/** Sliding-window limit per key (bucket + client IP). Throws 429 when exceeded. */
export function rateLimit(c: Context, bucket: string, limit: number, windowMs: number) {
  const key = `${bucket}:${clientIp(c)}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) {
    for (const [k, times] of hits) if (times[times.length - 1] < now - 60 * 60_000) hits.delete(k);
  }
  if (recent.length > limit) throw new HttpError(429, "Too many attempts, try again later");
}

export async function body(c: Context): Promise<Record<string, unknown>> {
  const data = await c.req.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw bad();
  return data as Record<string, unknown>;
}

export const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** An integer within bounds, or null. */
export const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
