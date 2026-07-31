import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "./db.js";
import { createRelayStore } from "./lib/relayStore.js";
import { authRoutes } from "./routes/auth.js";
import { machineRoutes, pairRedeemRoutes } from "./routes/machines.js";
import { projectRoutes } from "./routes/projects.js";
import { agentRoutes } from "./routes/agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(db = openDb(), opts = {}) {
  const relayDir = opts.relayDir
    || process.env.RELAY_STORE_DIR
    || join(__dirname, "..", "relay-store");
  const store = createRelayStore(relayDir);

  const app = express();
  app.locals.db = db;
  app.locals.store = store;
  app.use(express.json({ limit: "25mb" }));
  app.use(express.static(join(__dirname, "..", "public")));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRoutes(db));
  app.use("/api/machines", machineRoutes(db));
  app.use("/api/agent", pairRedeemRoutes(db));
  app.use("/api/agent", agentRoutes(db, store));
  app.use("/api/projects", projectRoutes(db));

  app.get("/", (_req, res) => res.redirect("/login.html"));
  return app;
}
