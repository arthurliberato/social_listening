// Not part of the test suite: `npm run screenshots` builds a demo account and captures docs/screenshots.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/screenshots",
  workers: 1,
  timeout: 900_000,
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1360, height: 860 },
    reducedMotion: "reduce",
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
