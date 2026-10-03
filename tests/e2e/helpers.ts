import { expect, type Page } from "@playwright/test";
import { Pool } from "pg";

export const PASSWORD = "correct horse battery staple";
export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://ripplewise:ripplewise@localhost:5432/ripplewise",
});

/** Sign up, verify via the simulated inbox and finish onboarding through the real UI. */
export async function createUser(page: Page, opts: { brand?: string; prefix?: string } = {}) {
  const email = `${opts.prefix ?? "u"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  await page.goto("/signup");
  await page.getByTestId("signup-name").fill("E2E User");
  await page.getByTestId("signup-email").fill(email);
  await page.getByTestId("signup-company").fill(`E2E Co ${Date.now()}`);
  await page.getByTestId("signup-password").fill(PASSWORD);
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
  await page.getByTestId("brand-name").fill(opts.brand ?? "Orbit Lace"); // small brand: leaves monthly quota for tests
  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("query-estimate")).toBeVisible();
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-skip").click();
  await page.waitForURL("**/w/*/home");
  const slug = new URL(page.url()).pathname.split("/")[2]!;
  return { email, slug };
}

/** Wait until the user's first query has finished collecting history, then return the feed's first page. */
export async function openFeed(page: Page, slug: string, qs = "") {
  await page.goto(`/w/${slug}/mentions${qs}`);
  await page
    .waitForFunction(
      () =>
        document.querySelector('[data-testid="mention-card"]') ||
        document.querySelector('[data-testid="feed-empty"]'),
      null,
      { timeout: 30_000 },
    )
    .catch(() => {});
  if (await page.getByTestId("feed-collecting").count()) {
    await expect(page.getByTestId("mention-card").first())
      .toBeVisible({ timeout: 45_000 })
      .catch(async () => {
        await page.reload();
      });
  }
}
