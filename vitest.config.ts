import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["datagen/**/*.test.ts", "lib/**/*.test.ts", "jobs/**/*.test.ts"],
    alias: { "@": new URL(".", import.meta.url).pathname },
    testTimeout: 60_000,
  },
});
