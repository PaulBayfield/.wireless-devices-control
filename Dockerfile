# Web build + API server in one image. The agent is not in it: it runs natively on each computer
# the devices are connected to (Bluetooth radio, USB receiver), see agent/.
#   docker build -t devices .
#   docker run -p 8830:8830 -v devices-data:/data --env-file server/.env devices

FROM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-alpine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=web /app/dist /app/dist
# The database: one SQLite file, kept in a volume.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    PORT=8830 \
    DIST_DIR=/app/dist \
    DATABASE_PATH=/data/devices.db \
    APP_VERSION=$APP_VERSION
EXPOSE 8830
USER node
# Every route needs a key or a session, /api/health too: check that the server accepts connections.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "require('net').connect(8830,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
# node:sqlite is still flagged experimental: it works, the warning is just noise.
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.ts"]
