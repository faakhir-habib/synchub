import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["reflect-metadata", "dotenv/config"],
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // All e2e suites share one on-disk SQLite file (DATABASE_URL=file:./dev.db).
    // Running test FILES in parallel causes SQLite single-writer contention
    // across suites, which surfaces as intermittent e2e timeouts. Serializing
    // file execution avoids suites fighting over the writer lock.
    fileParallelism: false,
  },
  plugins: [swc.vite({ module: { type: "es6" } })],
});
