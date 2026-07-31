import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { machineRoutes, pairRedeemRoutes } from "./routes/machines.js";
import { projectRoutes } from "./routes/projects.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(db = openDb()) {
  const app = express();
  app.locals.db = db;
  app.use(express.json({ limit: "25mb" }));
  app.use(express.static(join(__dirname, "..", "public")));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRoutes(db));
  app.use("/api/machines", machineRoutes(db));
  app.use("/api/agent", pairRedeemRoutes(db));
  app.use("/api/projects", projectRoutes(db));

  app.get("/", (_req, res) => res.redirect("/login.html"));
  return app;
}
