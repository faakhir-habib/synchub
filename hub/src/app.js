import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { openDb } from "./db.js";
import { createRelayStore } from "./lib/relayStore.js";
import { createRealtime } from "./lib/realtime.js";
import { authRoutes } from "./routes/auth.js";
import { machineRoutes, pairRedeemRoutes } from "./routes/machines.js";
import { projectRoutes } from "./routes/projects.js";
import { agentRoutes } from "./routes/agent.js";
import { conflictRoutes } from "./routes/conflicts.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { notificationRoutes } from "./routes/notifications.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(db = openDb(), opts = {}) {
  const relayDir = opts.relayDir
    || process.env.RELAY_STORE_DIR
    || join(__dirname, "..", "relay-store");
  const store = createRelayStore(relayDir);
  const realtime = createRealtime(db);

  const app = express();
  app.locals.db = db;
  app.locals.store = store;
  app.locals.realtime = realtime;
  app.use(express.json({ limit: "25mb" }));

  const publicDir = join(__dirname, "..", "public");
  // Per-boot build id → changes on every deploy/restart, busting CDN + browser cache.
  const BUILD = process.env.BUILD_ID || String(Date.now());

  // Serve HTML with a version stamped onto every asset URL (and an import map so
  // ES-module imports are versioned too). HTML itself is never cached, so a new
  // deploy is picked up immediately even behind Cloudflare.
  app.get(/.*\.html$/, (req, res, next) => {
    let html;
    try { html = readFileSync(join(publicDir, req.path), "utf8"); } catch { return next(); }
    html = html.replace(/\b(src|href)="((?:\/|)(?:js|assets)\/[^"?]+\.(?:js|css))"/g, `$1="$2?v=${BUILD}"`);
    const importmap = `<script type="importmap">{"imports":{`
      + `"/js/session.js":"/js/session.js?v=${BUILD}",`
      + `"/js/app-shell.js":"/js/app-shell.js?v=${BUILD}"}}</script>`;
    html = html.replace('<script src="assets/js/app.js', importmap + '<script src="assets/js/app.js');
    res.set("Cache-Control", "no-store").type("html").send(html);
  });

  app.use(express.static(publicDir, {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (/\.(js|css)$/.test(filePath)) res.setHeader("Cache-Control", "no-cache");
    },
  }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRoutes(db));
  app.use("/api/machines", machineRoutes(db));
  app.use("/api/agent", pairRedeemRoutes(db));
  app.use("/api/agent", agentRoutes(db, store, realtime));
  app.use("/api/projects", projectRoutes(db, store, realtime));
  app.use("/api/conflicts", conflictRoutes(db));
  app.use("/api/dashboard", dashboardRoutes(db));
  app.use("/api/notifications", notificationRoutes(db));

  app.get("/", (_req, res) => res.redirect("/login.html"));
  return app;
}
