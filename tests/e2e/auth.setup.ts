// Creates one verified, onboarded user (via the real UI) and saves its session for other specs.
import { expect, test as setup } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { createUser } from "./helpers";

setup("create onboarded user", async ({ page }) => {
  setup.setTimeout(120_000); // cold dev-server compiles
  const { email, slug } = await createUser(page, { prefix: "setup", brand: "Latte Lane" });
  // One saved dashboard for the a11y scans of the M5 screens.
  await page.goto(`/w/${slug}/dashboards`);
  await page.getByTestId("new-dashboard").click();
  await page.getByTestId("template-brand_health").click();
  await page.waitForURL(/dashboards\/[0-9a-f-]{36}\?edit=1/);
  const dashboardId = /dashboards\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.getByTestId("save-dashboard").click();
  await expect(page.getByTestId("edit-dashboard")).toBeVisible();
  writeFileSync("tests/.auth/meta.json", JSON.stringify({ slug, email, dashboardId }));
  await page.context().storageState({ path: "tests/.auth/user.json" });
});
