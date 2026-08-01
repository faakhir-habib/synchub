import "dotenv/config"; // load DATABASE_URL etc. from apps/hub-api/.env before Prisma
import "reflect-metadata";
import { json } from "express";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { AllExceptionsFilter } from "./common/errors/all-exceptions.filter.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global "/api" prefix for all feature routes; the infra health probe stays
  // unprefixed at /health so uptime checks/load balancers don't need updating.
  // "api/health" (the legacy-parity controller's raw path) is also excluded so
  // it isn't double-prefixed into /api/api/health — see legacy-health.controller.ts.
  app.setGlobalPrefix("api", { exclude: ["health", "api/health"] });

  // 25mb JSON body limit — matches the legacy Express hub (hub/src/app.js:29).
  // Nest 10.4's ExpressAdapter doesn't expose useBodyParser, so apply the
  // express json() middleware directly.
  app.use(json({ limit: "25mb" }));

  // Pin trust proxy to 1 hop (we sit behind exactly one reverse proxy/LB).
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT ?? 8080;
  await app.listen(port);
  console.log(`SyncHub hub-api on :${port}`);
}
bootstrap();
