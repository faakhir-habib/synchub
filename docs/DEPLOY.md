# Deploying the SyncHub Hub

The Hub is a single stateless Node process + one persistent data directory
(`/data` = SQLite + relay store). It has **no native dependencies** (uses
built-in `node:sqlite`), so the image is small and portable.

## Docker (local / any host)

```bash
# Build
docker build -t synchub-hub ./hub

# Run (data persists in the named volume)
docker run -d --name synchub-hub -p 8080:8080 -v synchub-data:/data \
  --restart unless-stopped synchub-hub

# or with compose (from repo root)
docker compose up -d --build
```

Open `http://localhost:8080`. Health: `GET /api/health` → `{"ok":true}`.

**Verified end-to-end in Docker** (see `agent/e2e-docker.mjs`): signup, pairing
codes, two agents, push/pull, append-only auto-merge, live WebSocket fan-out,
the chokidar file-watcher, UI serving, and data persistence across restart.

```bash
# Re-run the container e2e any time the Hub is up on :8080
cd agent && node --disable-warning=ExperimentalWarning e2e-docker.mjs
# (point elsewhere with HUB=https://synchub.example.com)
```

## Coolify (mylogiclab.cloud)

1. **New Resource → Application → Docker / Dockerfile** (or "Docker Compose"
   and point at the repo's `docker-compose.yml`).
2. **Source:** the `faakhir-habib/synchub` repo. **Build context / Dockerfile:**
   `hub/` and `hub/Dockerfile`.
3. **Port:** `8080` (Coolify maps it behind the Cloudflare tunnel → HTTPS/wss).
4. **Persistent storage:** mount a volume at **`/data`** (holds the SQLite DB +
   relay store — do not lose this).
5. **Env (optional):** `PORT=8080`. `DB_PATH` / `RELAY_STORE_DIR` already point
   into `/data` via the Dockerfile.
6. Deploy. Verify the tunnel forwards **WebSocket upgrades** to `/ws/agent` and
   `/ws/user` (Cloudflare does by default; confirm no buffering/timeout).

Then on each machine: `Machines → Connect machine` in the UI for a code, and
`node agent/src/cli.js pair <CODE> https://<your-hub-domain>` → `run`.

## Notes / hardening before wider use

- No rate-limiting or password-reset yet (single/trusted-user MVP).
- Relay store is plaintext at rest — encrypt the `/data` volume for sensitive
  transcripts.
- Back up the `/data` volume periodically (holds all sync coordination state).
