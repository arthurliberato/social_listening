import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
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
        /onboarding\.spec\.ts|public\.spec\.ts|queries\.spec\.ts|mentions\.spec\.ts|dashboards\.spec\.ts|alerts\.spec\.ts|ai\.spec\.ts|audit-coverage\.spec\.ts|throttle\.spec\.ts|auth-methods\.spec\.ts|insights\.spec\.ts|sales\.spec\.ts|reports\.spec\.ts|billing\.spec\.ts|team\.spec\.ts/,
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
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
