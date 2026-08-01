import "dotenv/config"; // load DATABASE_URL etc. from apps/hub-api/.env before Prisma
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 8080;
  await app.listen(port);
  console.log(`SyncHub hub-api on :${port}`);
}
bootstrap();
