// The user record and the shape the app sees.

import { sql } from "./db.ts";

/** Viewers look, admins also manage computers and users. Devices are controlled locally, through the agent. */
export const ROLES = ["viewer", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (v: unknown): v is Role => ROLES.includes(v as Role);

export interface User {
  id: string;
  name: string;
  email: string | null;
  oidcSub: string | null;
  role: Role;
  createdAt: Date;
  lastSeenAt: Date | null;
}

export async function getUser(id: string): Promise<User | undefined> {
  const [u] = await sql<User[]>`SELECT * FROM users WHERE id = ${id}`;
  return u;
}

/** What the signed-in user's app gets: no secrets. */
export function meView(u: User) {
  return {
    id: u.id,
    name: u.name || u.id,
    email: u.email,
    role: u.role,
    /** False for accounts created by an admin until their first sign-in. */
    ssoLinked: !!u.oidcSub,
    createdAt: u.createdAt,
  };
}

/** A free username based on `wanted` ("paul", "paul2", …). */
export async function freeUsername(wanted: string): Promise<string> {
  const base =
    wanted
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_.-]+/g, "")
      .replace(/^[^a-zA-Z0-9]+/, "")
      .slice(0, 50) || "user";
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : `${base}${i}`;
    const [taken] = await sql`SELECT 1 FROM users WHERE lower(id) = lower(${candidate})`;
    if (!taken) return candidate;
  }
}
