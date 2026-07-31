# SyncHub Hub — Node 24 (built-in node:sqlite, no native build needed).
FROM node:24-alpine

WORKDIR /app

# Install deps first for layer caching.
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# App source.
COPY . .

ENV PORT=8080 \
    NODE_ENV=production \
    DB_PATH=/data/synchub.sqlite \
    RELAY_STORE_DIR=/data/relay-store

EXPOSE 8080

# Persist DB + relay store outside the image.
VOLUME ["/data"]

# Basic container healthcheck against the health endpoint.
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
