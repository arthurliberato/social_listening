import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["datagen/**/*.test.ts", "lib/**/*.test.ts"], testTimeout: 60_000 },
});
