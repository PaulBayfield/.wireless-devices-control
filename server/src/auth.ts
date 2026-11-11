// Who is calling, and whether they may.
//
//  - People sign in with Authentik (OIDC authorization code + PKCE) and get a session cookie,
//    or send one of their API keys (Authorization: Bearer dvc_…) from the desktop app or a script.
//  - Agents send their computer's key (Authorization: Bearer dva_…), only accepted on /api/agent.
//
// Every /api route needs one or the other, except the sign-in flow itself. Cookies and keys
// are random tokens; the database only stores their SHA-256.

import { createHash } from "node:crypto";
import { Hono, type Context, type Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sql } from "./db.ts";
import { DEV_LOGIN_USER, PUBLIC_URL, SECURE_COOKIES, SESSION_IDLE_DAYS, oidc } from "./config.ts";
import { randomToken, sha256 } from "./crypto.ts";
import { HttpError, clientIp, rateLimit, str } from "./http.ts";
import { freeUsername, getUser, meView, type User } from "./users.ts";

export interface Session {
  id: string;
  userId: string;
  method: string;
}

export type AppEnv = { Variables: { user: User; session: Session | null } };
export type AgentEnv = { Variables: { hostId: string } };

const COOKIE = SECURE_COOKIES ? "__Host-devices" : "devices";
const DAY = 24 * 60 * 60_000;

/** Key prefixes, so a leaked key says what it is. */
export const USER_KEY_PREFIX = "dvc_";
export const AGENT_KEY_PREFIX = "dva_";

// --- Sessions ---

async function startSession(c: Context, user: User, method: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_IDLE_DAYS * DAY);
  await sql`
    INSERT INTO sessions (id, user_id, method, user_agent, ip, expires_at)
    VALUES (${sha256(token)}, ${user.id}, ${method}, ${str(c.req.header("User-Agent"), 300)}, ${clientIp(c)}, ${expires})`;
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "Lax",
    path: "/",
    // The cookie outlives idle expiry; the database decides when it's dead.
    maxAge: 400 * 24 * 60 * 60,
  });
  await sql`UPDATE users SET last_seen_at = now() WHERE id = ${user.id}`;
}

async function currentSession(c: Context): Promise<(Session & { user: User }) | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const [s] = await sql<(Session & { expiresAt: Date; lastSeenAt: Date })[]>`
    SELECT id, user_id, method, expires_at, last_seen_at FROM sessions WHERE id = ${sha256(token)}`;
  if (!s || s.expiresAt < new Date()) return null;
  const user = await getUser(s.userId);
  if (!user) return null;
  // Slide the idle expiry, at most once a minute per session.
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) {
    const expires = new Date(Date.now() + SESSION_IDLE_DAYS * DAY);
    await sql`UPDATE sessions SET last_seen_at = now(), expires_at = ${expires}, ip = ${clientIp(c)} WHERE id = ${s.id}`;
    await sql`UPDATE users SET last_seen_at = now() WHERE id = ${user.id}`;
  }
  return { ...s, user };
}

// --- API keys ---

const bearer = (c: Context) => c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;

interface KeyRow {
  id: string;
  kind: "user" | "agent";
  userId: string | null;
  hostId: string | null;
  lastUsedAt: Date | null;
}

async function resolveKey(c: Context, token: string, kind: KeyRow["kind"]): Promise<KeyRow> {
  const [row] = await sql<KeyRow[]>`SELECT id, kind, user_id, host_id, last_used_at FROM api_keys WHERE key_hash = ${sha256(token)}`;
  if (!row || row.kind !== kind) {
    // Slow down guessing.
    rateLimit(c, "bad-key", 20, 60_000);
    c.header("WWW-Authenticate", `Bearer realm="Devices", error="invalid_token"`);
    throw new HttpError(401, kind === "agent" ? "Invalid agent key: create one in Settings → Computers" : "Invalid API key");
  }
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await sql`UPDATE api_keys SET last_used_at = now() WHERE id = ${row.id}`;
  }
  return row;
}

/**
 * A person: their session cookie, or one of their API keys.
 *
 * API keys (the desktop app, scripts) are read-only: anything that changes something needs a
 * session, so a leaked key can read the devices but not create keys, add computers or touch users.
 */
export async function requireUser(c: Context<AppEnv>, next: Next) {
  const token = bearer(c);
  if (token) {
    const key = await resolveKey(c, token, "user");
    const user = await getUser(key.userId!);
    if (!user) throw new HttpError(401, "Invalid API key");
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      throw new HttpError(403, "API keys are read-only: sign in on the web app to change this");
    }
    c.set("user", user);
    c.set("session", null);
    return next();
  }
  const s = await currentSession(c);
  if (!s) throw new HttpError(401, "Not signed in");
  c.set("user", s.user);
  c.set("session", s);
  await next();
}

/** A computer's agent, by its key. */
export async function requireAgent(c: Context<AgentEnv>, next: Next) {
  const token = bearer(c);
  if (!token) throw new HttpError(401, "Send the agent key as Authorization: Bearer <key>");
  const key = await resolveKey(c, token, "agent");
  c.set("hostId", key.hostId!);
  await next();
}

/** Keys, sessions, users, the internal.bayfield.dev sync: a signed-in session only, never an API key. */
export async function requireSession(c: Context<AppEnv>, next: Next) {
  if (!c.get("session")) throw new HttpError(403, "Sign in on the web app for this: API keys can't reach it");
  await next();
}

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  if (c.get("user").role !== "admin") throw new HttpError(403, "Admins only");
  await next();
}


/**
 * Cookie-authenticated writes must come from the app itself. Browsers send Origin on every
 * cross-site POST, so a mismatch means another site is trying to act as the user.
 * Requests with an API key carry no ambient credential, so they're not concerned.
 */
export async function sameOrigin(c: Context, next: Next) {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && getCookie(c, COOKIE) && !bearer(c)) {
    const origin = c.req.header("Origin");
    const site = c.req.header("Sec-Fetch-Site");
    const allowed = new URL(PUBLIC_URL).origin;
    if ((origin && origin !== allowed && !isDevOrigin(origin)) || (!origin && site && site !== "same-origin" && site !== "none")) {
      throw new HttpError(403, "Cross-site request blocked");
    }
  }
  await next();
}

const isDevOrigin = (o: string) => process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(o);

// --- OIDC ---

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  issuer: string;
}
let discovery: Promise<Discovery> | null = null;
function discover(): Promise<Discovery> {
  if (!oidc) throw new HttpError(404, "Single sign-on isn't configured");
  const url = `${oidc.issuer}/.well-known/openid-configuration`;
  discovery ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`OIDC discovery failed (${r.status} from ${JSON.stringify(url)}): check OIDC_ISSUER`);
      return r.json() as Promise<Discovery>;
    })
    .catch((e) => {
      discovery = null;
      throw e;
    });
  return discovery;
}

const challenge = (verifier: string) => createHash("sha256").update(verifier).digest().toString("base64url");

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new HttpError(400, "Malformed ID token");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

interface Claims {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  groups?: string[];
}

/** Finds (or creates) the account for a provider identity, as in Llip. */
async function oidcUser(claims: Claims): Promise<User> {
  const cfg = oidc;
  if (!cfg) throw new HttpError(404, "Single sign-on isn't configured");
  const groups = Array.isArray(claims.groups) ? claims.groups : [];
  if (cfg.allowedGroups.length && !groups.some((g) => cfg.allowedGroups.includes(g))) {
    throw new HttpError(403, "Your account isn't allowed to use Devices.");
  }
  // With OIDC_ADMIN_GROUPS set, the provider decides who is an admin, at every sign-in.
  const managed = cfg.adminGroups.length > 0;
  const admin = managed && groups.some((g) => cfg.adminGroups.includes(g));
  const signedIn = async (id: string) => {
    if (managed) await sql`UPDATE users SET role = CASE WHEN ${admin} THEN 'admin' ELSE 'viewer' END WHERE id = ${id}`;
    return (await getUser(id))!;
  };
  const claim = async (u: User) => {
    await sql`UPDATE users SET oidc_sub = ${claims.sub} WHERE id = ${u.id}`;
    return signedIn(u.id);
  };

  const [bySub] = await sql<User[]>`SELECT * FROM users WHERE oidc_sub = ${claims.sub}`;
  if (bySub) return signedIn(bySub.id);

  const email = claims.email?.toLowerCase();
  if (email) {
    const [byEmail] = await sql<User[]>`SELECT * FROM users WHERE lower(email) = ${email} AND oidc_sub IS NULL`;
    if (byEmail) return claim(byEmail);
  }
  if (claims.preferred_username) {
    const [byName] = await sql<User[]>`SELECT * FROM users WHERE lower(id) = lower(${claims.preferred_username}) AND oidc_sub IS NULL`;
    if (byName) return claim(byName);
  }

  const [{ count }] = await sql<{ count: number }[]>`SELECT count(*) AS count FROM users`;
  if (count > 0 && !cfg.autoCreate) throw new HttpError(403, "No Devices account matches yours. Ask an admin to create one.");
  const id = await freeUsername(claims.preferred_username || email?.split("@")[0] || "user");
  const [emailTaken] = email ? await sql`SELECT 1 FROM users WHERE lower(email) = ${email}` : [];
  // The first account is the admin: it's your server.
  await sql`
    INSERT INTO users (id, name, email, oidc_sub, role)
    VALUES (${id}, ${claims.name ?? ""}, ${email && !emailTaken ? email : null}, ${claims.sub}, ${admin || (count === 0 && !managed) ? "admin" : "viewer"})`;
  return (await getUser(id))!;
}

// --- Routes ---

export const authRoutes = new Hono<AppEnv>();

// What the sign-in screen needs to draw itself: no secrets, so it's open.
authRoutes.get("/config", (c) => c.json({ oidc: oidc ? { name: oidc.name } : null, dev: !!DEV_LOGIN_USER }));

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await sql`DELETE FROM sessions WHERE id = ${sha256(token)}`;
  deleteCookie(c, COOKIE, { path: "/", secure: SECURE_COOKIES });
  return c.json({ ok: true });
});

authRoutes.get("/oidc/start", async (c) => {
  rateLimit(c, "oidc", 30, 60_000);
  const d = await discover();
  const state = randomToken(24);
  const verifier = randomToken(48);
  const nonce = randomToken(16);
  await sql`DELETE FROM oidc_states WHERE expires_at < now()`;
  await sql`
    INSERT INTO oidc_states (state, verifier, nonce, expires_at)
    VALUES (${state}, ${verifier}, ${nonce}, ${new Date(Date.now() + 10 * 60_000)})`;
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: oidc!.clientId,
    redirect_uri: oidc!.redirectUri,
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: challenge(verifier),
    code_challenge_method: "S256",
  }).toString();
  return c.redirect(url.toString());
});

authRoutes.get("/oidc/callback", async (c) => {
  const fail = (message: string) => c.redirect(`/?signin_error=${encodeURIComponent(message)}`);
  const { code, state, error, error_description } = c.req.query();
  if (error) return fail(error_description || error);
  if (!code || !state) return fail("The sign-in response was incomplete.");
  const [saved] = await sql<{ verifier: string; nonce: string }[]>`
    DELETE FROM oidc_states WHERE state = ${state} AND expires_at > now() RETURNING verifier, nonce`;
  if (!saved) return fail("This sign-in link has expired. Try again.");

  try {
    const d = await discover();
    const tokenRes = await fetch(d.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: oidc!.redirectUri,
        client_id: oidc!.clientId,
        client_secret: oidc!.clientSecret,
        code_verifier: saved.verifier,
      }),
    });
    const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; id_token?: string; error_description?: string };
    if (!tokenRes.ok || !token.access_token || !token.id_token) throw new Error(token.error_description ?? `Token exchange failed (${tokenRes.status})`);

    // The ID token came straight from the token endpoint over TLS, so checking its claims is enough (OIDC Core 3.1.3.7).
    const id = decodeJwt(token.id_token);
    const aud = Array.isArray(id.aud) ? id.aud : [id.aud];
    if (id.iss !== d.issuer || !aud.includes(oidc!.clientId) || id.nonce !== saved.nonce) throw new Error("The ID token doesn't match this app");
    if (typeof id.exp === "number" && id.exp * 1000 < Date.now() - 60_000) throw new Error("The ID token has expired");

    const infoRes = await fetch(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${token.access_token}` } });
    const info = (await infoRes.json().catch(() => ({}))) as Claims;
    if (!infoRes.ok || info.sub !== id.sub) throw new Error("Couldn't read your profile from the provider");

    const user = await oidcUser({ ...info, groups: info.groups ?? (id.groups as string[] | undefined) });
    await startSession(c, user, "oidc");
    return c.redirect("/");
  } catch (e) {
    console.warn("OIDC sign-in failed:", e);
    return fail(e instanceof Error ? e.message : "Sign-in failed");
  }
});

/** Local development only (see DEV_LOGIN_USER): signs in without the identity provider. */
authRoutes.post("/dev-login", async (c) => {
  if (!DEV_LOGIN_USER) throw new HttpError(404, "Not found");
  let user = await getUser(DEV_LOGIN_USER);
  if (!user) {
    const [{ count }] = await sql<{ count: number }[]>`SELECT count(*) AS count FROM users`;
    await sql`INSERT INTO users (id, name, role) VALUES (${DEV_LOGIN_USER}, ${DEV_LOGIN_USER}, ${count === 0 ? "admin" : "viewer"})`;
    user = (await getUser(DEV_LOGIN_USER))!;
  }
  await startSession(c, user, "dev");
  return c.json({ ok: true });
});

// readOnly: signed in with an API key (the desktop app), which can't change anything.
authRoutes.get("/me", requireUser, (c) => c.json({ ...meView(c.get("user")), readOnly: !c.get("session") }));

/** Creates a key and returns it: the only time it is ever shown. */
export async function createKey(kind: "user" | "agent", name: string, owner: { userId?: string; hostId?: string }) {
  const key = (kind === "user" ? USER_KEY_PREFIX : AGENT_KEY_PREFIX) + randomToken(32);
  const id = randomToken(9);
  await sql`
    INSERT INTO api_keys (id, key_hash, kind, name, user_id, host_id)
    VALUES (${id}, ${sha256(key)}, ${kind}, ${name}, ${owner.userId ?? null}, ${owner.hostId ?? null})`;
  return { id, key };
}

export { COOKIE as SESSION_COOKIE };
