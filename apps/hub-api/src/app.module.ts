import { existsSync } from "node:fs";
import { join } from "node:path";
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { ServeStaticModule } from "@nestjs/serve-static";
import { HealthController } from "./health/health.controller.js";
import { LegacyHealthController } from "./health/legacy-health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { AuthModule } from "./common/auth/auth.module.js";
import { UsersModule } from "./users/users.module.js";
import { MachinesModule } from "./machines/machines.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { NotifyModule } from "./notify/notify.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { DashboardModule } from "./dashboard/dashboard.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { SyncModule } from "./sync/sync.module.js";

// The built SPA (apps/hub-web/dist) sits next to hub-api's own build output.
// Compiled, hub-api runs from apps/hub-api/dist/main.js, so two levels up
// (apps/hub-api/dist -> apps/hub-api -> apps) plus hub-web/dist lands on
// apps/hub-web/dist. WEB_DIST_DIR overrides this for Docker/other layouts.
const DEFAULT_WEB_DIST_DIR = join(__dirname, "..", "..", "hub-web", "dist");
const webDistDir = process.env.WEB_DIST_DIR ?? DEFAULT_WEB_DIST_DIR;

// ServeStaticModule.forRoot() registers Express static + catch-all routes at
// module init; the loader itself tolerates a missing rootPath (no crash), but
// we only register it when the dist actually exists so hub-api's own tests
// (which boot AppModule without a built SPA) don't get a static handler
// silently intercepting requests, and boot stays clean either way.
const serveStaticImports = existsSync(webDistDir)
  ? [
      ServeStaticModule.forRoot({
        rootPath: webDistDir,
        // Never let the SPA fallback shadow the REST API, the WS upgrade
        // paths, or the health probes.
        exclude: ["/api", "/api/(.*)", "/health", "/api/health", "/ws", "/ws/(.*)"],
      }),
    ]
  : [];

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ...serveStaticImports,
    PrismaModule,
    RealtimeModule,
    AuthModule,
    UsersModule,
    MachinesModule,
    ProjectsModule,
    NotifyModule,
    NotificationsModule,
    DashboardModule,
    SyncModule,
  ],
  controllers: [HealthController, LegacyHealthController],
})
export class AppModule {}
