// Creates one verified, onboarded user (via the real UI) and saves its session for other specs.
import { expect, test as setup } from "@playwright/test";
import { writeFileSync } from "node:fs";

setup("create onboarded user", async ({ page }) => {
  const email = `setup-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.getByTestId("signup-name").fill("Setup User");
  await page.getByTestId("signup-email").fill(email);
  await page.getByTestId("signup-company").fill(`Setup Co ${Date.now()}`);
  await page.getByTestId("signup-password").fill("correct horse battery staple");
  await page.getByTestId("signup-submit").click();
  await page.waitForURL("**/verify");
  await page.goto("/inbox");
  const link = await page
    .getByTestId("inbox-message")
    .first()
    .locator("a")
    .first()
    .getAttribute("href");
  await page.goto(link!);
  await page.waitForURL("**/onboarding");
  await page.getByTestId("role-analyst").check();
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-skip").click();
  await page.getByTestId("brand-name").fill("Brewline");
  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("query-estimate")).toBeVisible();
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-skip").click();
  await page.waitForURL("**/w/*/home");
  const slug = new URL(page.url()).pathname.split("/")[2]!;
  writeFileSync("tests/.auth/meta.json", JSON.stringify({ slug, email }));
  await page.context().storageState({ path: "tests/.auth/user.json" });
});
