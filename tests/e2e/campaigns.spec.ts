import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createUser, pool } from "./helpers";

const setPlan = (email: string, tier: string) =>
  pool.query(
    `UPDATE accounts SET plan_tier = $2 WHERE id IN (SELECT m.account_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1)`,
    [email.toLowerCase(), tier],
  );

/** A list with two creators, built through the UI. */
async function makeList(page: Page, slug: string, name: string) {
  await page.goto(`/w/${slug}/creators`);
  for (const i of [0, 1]) {
    await page.getByTestId("add-to-list").nth(i).click();
    if (i === 0) await page.getByTestId("new-list-name").fill(name);
    else await page.getByLabel(name).check();
    await page.getByTestId("add-to-list-confirm").click();
    await expect(page.getByTestId("add-to-list-status").nth(i)).toContainText("Added");
  }
}

/** Send an invitation to one roster row through the real form. */
async function invite(row: ReturnType<Page["getByTestId"]>) {
  await row.getByTestId("invite-open").click();
  await row.getByTestId("invite-send").click();
  await expect(row.getByTestId("roster-status")).toHaveText("Invited");
}

async function newCampaign(page: Page, slug: string, name: string, budget: number) {
  await page.goto(`/w/${slug}/creators/campaigns`);
  await page.getByTestId("campaign-name").fill(name);
  await page.getByTestId("campaign-budget").fill(String(budget));
  await page.getByTestId("campaign-create").click();
  await page.waitForURL(/campaigns\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("campaign-title")).toHaveText(name);
}

test("a campaign takes creators from a list through the pipeline and tracks the budget", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const { slug, email } = await createUser(page, { prefix: "camp" });
  await setPlan(email, "growth");
  await makeList(page, slug, "Launch picks");
  await newCampaign(page, slug, "Spring launch", 1000);
  await expect(page.getByTestId("roster-empty")).toBeVisible();
  await expect(page.getByTestId("budget-committed")).toHaveText("$0");

  await page.getByTestId("add-from-list-submit").click();
  await expect(page.getByTestId("add-from-list-status")).toContainText("Added 2 creators");
  await expect(page.getByTestId("roster-row")).toHaveCount(2);
  // Adding the same list again adds nobody.
  await page.getByTestId("add-from-list-submit").click();
  await expect(page.getByTestId("add-from-list-status")).toContainText(
    "Added 0 creators; 2 already",
  );

  const first = page.getByTestId("roster-row").first();
  await expect(first.getByTestId("roster-status")).toHaveText("Shortlisted");
  // Can't jump ahead: the pipeline only offers the next steps.
  await expect(first.getByTestId("move-paid")).toHaveCount(0);
  // Inviting goes through outreach now: there is no manual "mark invited".
  await expect(first.getByTestId("move-invited")).toHaveCount(0);
  await invite(first);
  await expect(first.getByTestId("roster-status")).toHaveText("Invited");

  // Confirming needs a fee.
  await first.getByTestId("move-confirmed").click();
  await expect(first.getByTestId("roster-error")).toContainText("Set the agreed fee");
  await first.getByTestId("creator-fee").fill("600");
  await first.getByTestId("creator-fee").blur();
  await first.getByTestId("move-confirmed").click();
  await expect(first.getByTestId("roster-status")).toHaveText("Confirmed");
  await expect(page.getByTestId("budget-committed")).toHaveText("$600");
  await expect(page.getByTestId("budget-state")).toContainText("$400 left");

  // Confirming a second creator past the budget is allowed, with a clear warning.
  const second = page.getByTestId("roster-row").nth(1);
  await invite(second);
  await expect(second.getByTestId("roster-status")).toHaveText("Invited");
  await second.getByTestId("creator-fee").fill("700");
  await second.getByTestId("creator-fee").blur();
  await second.getByTestId("move-confirmed").click();
  await expect(second.getByTestId("roster-warning")).toContainText("$300 over its budget");
  await expect(page.getByTestId("budget-state")).toContainText("Over budget by $300");

  // Content, approval, payment.
  await first.getByTestId("move-content_submitted").click();
  await expect(first.getByTestId("roster-status")).toHaveText("Content submitted");
  // Reviewing content is outreach's job, not a manual step.
  await expect(first.getByTestId("move-approved")).toHaveCount(0);
  await first.getByTestId("review-approve").click();
  await expect(first.getByTestId("roster-status")).toHaveText("Content approved");
  await first.getByTestId("move-paid").click();
  await expect(first.getByTestId("roster-status")).toHaveText("Paid");
  await expect(first.getByTestId("move-paid")).toHaveCount(0); // terminal

  // Remove the other creator; the budget follows.
  await second.getByTestId("remove-creator").click();
  await expect(page.getByTestId("roster-row")).toHaveCount(1);
  await expect(page.getByTestId("budget-state")).toContainText("$400 left");
});

test("campaign lifecycle, edits, and the plan limit", async ({ page }) => {
  test.setTimeout(240_000);
  const { slug, email } = await createUser(page, { prefix: "camplim" });
  await newCampaign(page, slug, "First", 500);
  await expect(page.getByTestId("campaign-status")).toHaveText("Draft");

  await page.getByTestId("campaign-edit").click();
  await page.getByTestId("edit-budget").fill("750");
  await page.getByTestId("campaign-save").click();
  await expect(page.getByTestId("budget")).toContainText("$750");

  // Trial: one active campaign. A second hits the paywall.
  await page.goto(`/w/${slug}/creators/campaigns`);
  await page.getByTestId("campaign-name").fill("Second");
  await page.getByTestId("campaign-create").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("campaign-row")).toHaveCount(1);

  // Completing the first frees the slot, and it becomes read-only.
  await page.getByRole("link", { name: "First" }).click();
  await page.getByTestId("campaign-to-active").click();
  await expect(page.getByTestId("campaign-status")).toHaveText("Active");
  await page.getByTestId("campaign-to-completed").click();
  await expect(page.getByTestId("campaign-status")).toHaveText("Completed");
  await expect(page.getByTestId("add-from-list")).toHaveCount(0);
  await newCampaign(page, slug, "Second", 100);

  // Re-opening the first one now exceeds the plan.
  await page.goto(`/w/${slug}/creators/campaigns`);
  await page.getByRole("link", { name: "First" }).click();
  await page.getByTestId("campaign-to-active").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("campaign-status")).toHaveText("Completed");

  await setPlan(email, "growth");
  await page.reload();
  await page.getByTestId("campaign-to-active").click();
  await expect(page.getByTestId("campaign-status")).toHaveText("Active");
});

test("a viewer can see campaigns but not change them", async ({ page }) => {
  test.setTimeout(180_000);
  const { slug, email } = await createUser(page, { prefix: "campview" });
  await newCampaign(page, slug, "Read only", 100);
  await pool.query(
    `UPDATE memberships SET role = 'viewer' WHERE user_id IN (SELECT id FROM users WHERE lower(email) = $1)`,
    [email.toLowerCase()],
  );
  await page.reload();
  await expect(page.getByTestId("campaign-edit")).toBeDisabled();
  await expect(page.getByTestId("campaign-to-active")).toBeDisabled();
  await page.goto(`/w/${slug}/creators/campaigns`);
  await expect(page.getByTestId("campaign-create")).toBeDisabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`campaign screens have no serious a11y violations (${theme})`, async ({ page }) => {
    test.setTimeout(240_000);
    const { slug, email } = await createUser(page, { prefix: `campa11y${theme}` });
    await setPlan(email, "growth");
    await page.addInitScript((t) => localStorage.setItem("rw-theme", t), theme);
    await makeList(page, slug, "A11y picks");
    await newCampaign(page, slug, "A11y campaign", 1000);
    await page.getByTestId("add-from-list-submit").click();
    await expect(page.getByTestId("roster-row")).toHaveCount(2);
    const detail = new URL(page.url()).pathname;
    for (const path of [`/w/${slug}/creators/campaigns`, detail]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, `${path}: ${JSON.stringify(serious, null, 1)}`).toEqual([]);
    }
  });
}
