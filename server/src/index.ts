// Devices server: the web app, its API, the agents' API, and the copy to internal.bayfield.dev.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { DESKTOP_ORIGINS, DEV_LOGIN_USER, DIST_DIR, HISTORY_DAYS, PORT, PUBLIC_URL, internal, oidc } from "./config.ts";
import { migrate, sql } from "./db.ts";
import { api } from "./api.ts";
import { agent } from "./agent.ts";
import { authRoutes, requireUser, sameOrigin, type AppEnv } from "./auth.ts";
import { startInternalSync } from "./internal.ts";
import { HttpError } from "./http.ts";

await migrate();

const indexPath = resolve(DIST_DIR, "index.html");
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;
// index.html applies the theme in a tiny inline script before the bundle loads (no flash of the
// wrong theme). The policy allows exactly that script, by hash.
const inlineScripts = [...(indexHtml ?? "").matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
);

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...inlineScripts],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      // model-viewer (the 3D mouse) decodes in workers it creates from blobs.
      workerSrc: ["'self'", "blob:"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);
// The desktop app is another origin: it calls the API with an API key (never a cookie).
app.use(
  "/api/*",
  cors({
    origin: (origin) => (DESKTOP_ORIGINS.includes(origin) || (process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin)) ? origin : null),
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    maxAge: 600,
  }),
);
app.use("/api/*", bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) }));
app.use("/api/*", sameOrigin);

// Behind a key or a session too, like every other route.
app.get("/api/health", requireUser as never, async (c: Context<AppEnv>) => {
  await sql`SELECT 1`;
  return c.json({ ok: true });
});

app.route("/api/auth", authRoutes);
app.route("/api/app", api);
// The agents, with their computer's key.
app.route("/api/agent", agent);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

if (indexHtml) {
  const index = indexHtml;
  app.use("/assets/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  const page = (c: Context) => {
    c.header("Cache-Control", "no-cache");
    return c.html(index);
  };
  app.get("/", page);
  app.get("/index.html", page);
  app.use("/*", serveStatic({ root: relative(process.cwd(), DIST_DIR) }));
  app.get("*", page);
} else {
  console.warn(`No web build at ${DIST_DIR}; only the API is served. Run \`npm run build\` in the project root.`);
}

// Once an hour: expired sessions and sign-in attempts, history past its retention.
setInterval(
  () => {
    void sql`DELETE FROM sessions WHERE expires_at < now()`.catch(() => {});
    void sql`DELETE FROM oidc_states WHERE expires_at < now()`.catch(() => {});
    void sql`DELETE FROM battery_runs WHERE ended_at < ${new Date(Date.now() - HISTORY_DAYS * 86_400_000)}`.catch(() => {});
  },
  60 * 60_000,
);

startInternalSync();

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  console.log(`Devices on http://localhost:${port} (public URL ${PUBLIC_URL})`);
  console.log(`  sign-in: ${[oidc && `SSO (${oidc.name})`, DEV_LOGIN_USER && `development sign-in as ${DEV_LOGIN_USER}`].filter(Boolean).join(", ")}`);
  console.log(`  internal.bayfield.dev: ${internal ? `${internal.url}, every ${internal.minutes} min` : "off"}`);
});
