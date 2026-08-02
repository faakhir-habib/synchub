# syntax=docker/dockerfile:1
#
# Production image for @synchub/hub-api (NestJS API + serves the hub-web SPA).
#
# Build context MUST be the repo root, e.g.:
#   docker build -f apps/hub-api/Dockerfile -t synchub .
#
# Build order:
#   1. Install the full pnpm workspace (frozen lockfile).
#   2. Build @synchub/shared (dual CJS/ESM lib consumed by both apps).
#   3. Build @synchub/hub-web (Vite SPA -> apps/hub-web/dist).
#   4. Build @synchub/hub-api (prisma generate + nest build -> apps/hub-api/dist).
#   5. `pnpm deploy` hub-api into a flattened, self-contained folder that
#      correctly resolves the `@synchub/shared` workspace dependency (pnpm
#      deploy hard-copies workspace deps instead of leaving pnpm's usual
#      symlinks, which don't survive being copied into a fresh image layer).
#      devDependencies are kept (no --prod) so the `prisma` CLI is present in
#      the deploy output for `prisma migrate deploy` at container startup.

FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# --- Install dependencies (separate layer, cached while only source changes) ---
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc* ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/hub-api/package.json apps/hub-api/package.json
COPY apps/hub-web/package.json apps/hub-web/package.json
# apps/agent is a workspace project too (unrelated to this image, not built
# or shipped here), but `pnpm install --frozen-lockfile` validates the full
# workspace against pnpm-lock.yaml, so its manifest must be present.
COPY apps/agent/package.json apps/agent/package.json

# hub-api's own "postinstall" script runs `prisma generate`, which pnpm
# triggers as part of `pnpm install` itself -- the schema must exist before
# that runs, so pull it in ahead of the rest of the source.
COPY apps/hub-api/prisma/schema.prisma apps/hub-api/prisma/schema.prisma

RUN pnpm install --frozen-lockfile

# --- Copy full source and build every workspace package in dependency order ---
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/ apps/

RUN pnpm --filter @synchub/shared build \
 && pnpm --filter @synchub/hub-web build \
 && pnpm --filter @synchub/hub-api build

# --- Flatten hub-api (+ its built workspace deps) into a self-contained deploy dir ---
# No --prod: keeps devDependencies (notably the `prisma` CLI) available at
# runtime for `prisma migrate deploy`.
RUN pnpm --filter @synchub/hub-api deploy /app/deploy

# prisma/migrate deploy needs the schema + migrations; copy them explicitly
# rather than relying on pnpm deploy's file-inclusion rules.
RUN rm -rf /app/deploy/prisma && cp -r /app/apps/hub-api/prisma /app/deploy/prisma

# Regenerate the Prisma client inside the deploy dir so it's guaranteed to
# match the @prisma/client version actually present in its own node_modules
# (pnpm deploy re-resolves node_modules from scratch, so the client generated
# during the earlier `hub-api build` step may not carry over).
RUN cd /app/deploy && npx prisma generate --schema=./prisma/schema.prisma

FROM node:22-slim AS runtime

# openssl/ca-certificates: required by Prisma's query engine on Debian slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/deploy ./
COPY --from=builder /app/apps/hub-web/dist ./hub-web-dist
COPY apps/hub-api/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

ENV PORT=8080 \
    NODE_ENV=production \
    WEB_DIST_DIR=/app/hub-web-dist

EXPOSE 8080

ENTRYPOINT ["./docker-entrypoint.sh"]
