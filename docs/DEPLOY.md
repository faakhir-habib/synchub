# Deploying the SyncHub Hub

The Hub is a single stateless Node process + one persistent data directory
(`/data` = SQLite + relay store). It has **no native dependencies** (uses
built-in `node:sqlite`), so the image is small and portable.

## Docker (local / any host)

```bash
# Build (context is the repo root; the Dockerfile lives in apps/hub-api)
docker build -t synchub -f apps/hub-api/Dockerfile .

# Run (data persists in the named volume)
docker run -d --name synchub -p 8080:8080 -v synchub-data:/data \
  -e DATABASE_URL="file:/data/synchub.db" -e RELAY_STORE_DIR="/data/relay-store" \
  --restart unless-stopped synchub

# or with compose (from repo root) — env is set for you in docker-compose.yml
docker compose up -d --build
```

Open `http://localhost:8080`. Health: `GET /api/health` → `{"ok":true}`.

**Verified end-to-end** (see `apps/agent/test/agent-integration.e2e.test.ts`):
signup, pairing codes, agents, push/pull, append-only auto-merge, live
WebSocket fan-out, the file-watcher, UI serving, and data persistence across
restart.

```bash
# Re-run the agent's own e2e suite
pnpm --filter @synchub/agent test
```

## Coolify (or any Dockerfile-based PaaS)

1. **New Resource → Application → Docker / Dockerfile** (or "Docker Compose"
   and point at the repo's `docker-compose.yml`).
2. **Source:** this repo (or your fork). **Build context:** the repo
   root (`.`). **Dockerfile:** `apps/hub-api/Dockerfile`.
3. **Port:** `8080` (Coolify maps it behind the Cloudflare tunnel → HTTPS/wss).
4. **Persistent storage:** mount a volume at **`/data`** (holds the SQLite DB +
   relay store — do not lose this).
5. **Env:** `PORT=8080`, `DATABASE_URL=file:/data/synchub.db`,
   `RELAY_STORE_DIR=/data/relay-store` (all preset in `docker-compose.yml`; set
   them explicitly if deploying the raw Dockerfile). `WEB_DIST_DIR` is baked
   into the image.
6. Deploy. Verify the tunnel forwards **WebSocket upgrades** to `/ws/agent` and
   `/ws/user` (Cloudflare does by default; confirm no buffering/timeout).

Then on each machine: install the `synchub-agent` binary (see root `README.md`
→ "Installing the Agent"), `Machines → Connect machine` in the UI for a code,
then `synchub-agent pair <CODE> https://<your-hub-domain>` → `synchub-agent install`.

## Notes / hardening before wider use

- No rate-limiting or password-reset yet (single/trusted-user MVP).
- Relay store is plaintext at rest — encrypt the `/data` volume for sensitive
  transcripts.
- Back up the `/data` volume periodically (holds all sync coordination state).
