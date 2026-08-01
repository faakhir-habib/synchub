import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["reflect-metadata", "dotenv/config"],
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
  plugins: [swc.vite({ module: { type: "es6" } })],
});
