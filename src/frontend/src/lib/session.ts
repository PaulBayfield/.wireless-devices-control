import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * A stateless session: the cookie holds an expiry and an HMAC of it, never
 * the API token itself. The signing key is derived from API_TOKEN, so there
 * is no second secret to manage -- and rotating the token logs everyone out.
 *
 * Imported by `proxy.ts` (an optimistic redirect) and by the data access
 * layer (the real check), so it must not depend on anything request-bound.
 */

export const SESSION_COOKIE = "wdc_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds

function signingKey(): Buffer {
  const token = process.env.API_TOKEN ?? "";
  if (token.length < 32) {
    throw new Error("API_TOKEN is missing or shorter than 32 characters.");
  }
  return createHash("sha256").update(`wdc-session:${token}`).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A fresh session cookie value, valid for SESSION_MAX_AGE. */
export function createSession(): string {
  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  return `${expires}.${sign(String(expires))}`;
}

/** Whether a cookie value is a session this server signed and that has not expired. */
export function isValidSession(value: string | undefined): boolean {
  if (!value) return false;
  const [expires, signature] = value.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < Date.now() / 1000) return false;
  return safeEqual(signature, sign(expires));
}

/** Whether a login attempt typed the API token. Constant time. */
export function isApiToken(candidate: string): boolean {
  const token = process.env.API_TOKEN ?? "";
  return token.length >= 32 && safeEqual(candidate, token);
}
