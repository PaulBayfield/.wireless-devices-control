# Wireless Devices — frontend

Next.js 16 (App Router) dashboard for the device API in `src/api`. It shows
every device's battery, lowest first, and the settings each model has.

## How it talks to the API

Only this server talks to the API: `src/lib/api.ts` is server-only and sends
`API_TOKEN`, so the token never reaches the browser. Pages read through it in
Server Components; changes go through Server Actions in `src/app/actions/`.

## Authentication

There is no user database. The login page asks for the API token; if it
matches `API_TOKEN`, the server sets an httpOnly cookie holding an expiry and
an HMAC of it (keyed from `API_TOKEN`), never the token itself. Sessions last
30 days, and changing `API_TOKEN` signs everyone out.

- `src/proxy.ts` redirects to `/login` without a valid session (an early,
  optimistic check).
- `verifySession()` in `src/lib/dal.ts` is the real check, run by every page
  and every Server Action.
- Failed logins are limited to 10 a minute per client IP, taken from
  `X-Forwarded-For`, so run it behind a reverse proxy that sets that header.

## Development

```bash
cp .env.example .env.local   # API_URL and API_TOKEN
npm install
npm run dev
```

The API has to be running (`uv run __main__.py serve` at the repository root,
on the machine the devices are connected to).

## Production

`output: "standalone"`: the `Dockerfile` builds `server.js` and serves it on
port 3000. The image is built and pushed by
`.github/workflows/deployment.yaml`; configure it at runtime with `API_URL`
and `API_TOKEN`.

## Device visuals

Each device page shows the model's 3D view, else its picture, else its icon.
Drop a `.glb` in `public/models/` or an image (transparent PNG/WebP) in
`public/devices/`, then add a line for the model's key in `src/lib/visuals.ts`.
3D models are shown with `<model-viewer>`, loaded only on a page that has one.
