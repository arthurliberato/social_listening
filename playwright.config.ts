import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  // A dev server compiles each route on first visit, so some first loads are slow; CI serves a production
  // build instead (below), and a single retry absorbs the odd genuine hiccup without hiding real failures.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    // Cloud sandboxes ship a pre-installed Chromium; set to use it instead of downloading.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Specs that start signed out (they create their own users).
    {
      name: "anonymous",
      testMatch:
        /onboarding\.spec\.ts|public\.spec\.ts|queries\.spec\.ts|mentions\.spec\.ts|dashboards\.spec\.ts|alerts\.spec\.ts|ai\.spec\.ts|add-to-report\.spec\.ts|audit-coverage\.spec\.ts|throttle\.spec\.ts|auth-methods\.spec\.ts|insights\.spec\.ts|sales\.spec\.ts|reports\.spec\.ts|billing\.spec\.ts|team\.spec\.ts|sim-clock\.spec\.ts|categories\.spec\.ts|help\.spec\.ts|query-copy\.spec\.ts/,
    },
    // Specs that need a signed-in, onboarded user.
    {
      name: "authed",
      testMatch: /shell\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: "tests/.auth/user.json" },
    },
  ],
  webServer: {
    // CI builds first (a separate step) and serves the production build. PW_PROD=1 does the same locally.
    command: process.env.CI || process.env.PW_PROD ? "npm run start" : "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
