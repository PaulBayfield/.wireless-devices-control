"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE, SESSION_MAX_AGE, createSession, isApiToken } from "@/lib/session";

export type LoginState = { error?: string };

/** Failed logins per client, to slow down guessing: 10 a minute. */
const failures = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;

async function clientKey(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

function throttled(key: string): boolean {
  const entry = failures.get(key);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = failures.get(key);
  if (!entry || entry.resetAt < now) {
    failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const key = await clientKey();
  if (throttled(key)) {
    return { error: "Too many attempts. Wait a minute and try again." };
  }

  const token = String(formData.get("token") ?? "").trim();
  if (!isApiToken(token)) {
    recordFailure(key);
    return { error: "That token is not valid." };
  }

  failures.delete(key);
  (await cookies()).set(SESSION_COOKIE, createSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect("/");
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
