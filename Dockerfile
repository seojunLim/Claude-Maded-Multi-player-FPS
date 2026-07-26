# Single long-lived Node process serving the client and the WebSocket game
# server. Any host that can run a container and pass through WebSocket
# upgrades will work (Fly.io, Render, Railway, Koyeb, a plain VPS…).
FROM node:22-alpine

WORKDIR /app

# Install dependencies first so image layers cache well.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# three.js is committed under public/vendor, but re-vendor if it is missing so
# the image never depends on a CDN at runtime.
RUN test -f public/vendor/three/three.module.min.js || npm run vendor

ENV NODE_ENV=production
ENV PORT=8080
ENV BOTS=6
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O- "http://127.0.0.1:${PORT}/api/status" > /dev/null || exit 1

CMD ["node", "server/index.js"]
