import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { runNightlyScoring } from "../../jobs/pqa";
import { runSalesDesk } from "../../lib/sales/desk";
import { createUser, pool } from "./helpers";

test.setTimeout(120_000);

const scan = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    serious,
    JSON.stringify(
      serious.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html.slice(0, 140)) })),
    ),
  ).toEqual([]);
};
const userEvents = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows.map((r) => r.props as Record<string, unknown>);
const accountOf = async (email: string) =>
  (
    await pool.query(
      `SELECT m.account_id AS id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1 LIMIT 1`,
      [email],
    )
  ).rows[0].id as string;
async function openContact(page: Page, qs = "") {
  await page.goto(`/contact-sales${qs}`);
  await expect(page.getByTestId("sales-name")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

test("anonymous visitor: pricing → contact form (validated) → request, and a booked demo", async ({
  page,
}) => {
  const started = new Date();
  await page.goto("/pricing");
  await page.getByTestId("cta-enterprise").click();
  await page.waitForURL(/contact-sales\?entry=pricing_enterprise/);
  await page.waitForLoadState("networkidle");

  await page.getByTestId("sales-submit").click();
  await expect(page.getByTestId("sales-error")).toContainText("name");
  const company = `Northwind ${Date.now()}`;
  await page.getByTestId("sales-name").fill("Pat Buyer");
  await page.getByTestId("sales-email").fill(`pat-${Date.now()}@example.test`);
  await page.getByTestId("sales-company").fill(company);
  await page.getByTestId("sales-seats").fill("0");
  await page.getByTestId("sales-submit").click();
  await expect(page.getByTestId("sales-error")).toContainText("how many");
  await scan(page);
  await page.getByTestId("sales-seats").fill("45");
  await page.getByTestId("sales-submit").click();
  await expect(page.getByTestId("sales-done")).toBeVisible({ timeout: 20_000 });
  const row = (
    await pool.query(
      `SELECT kind, seats, status, entry_point FROM sales_requests WHERE company = $1`,
      [company],
    )
  ).rows[0];
  expect(row).toMatchObject({
    kind: "contact",
    seats: 45,
    status: "new",
    entry_point: "pricing_enterprise",
  });
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            `SELECT count(*)::int AS n FROM analytics_events WHERE name = 'Sales Contact Requested' AND ts >= $1 AND props->>'entry_point' = 'pricing_enterprise'`,
            [started],
          )
        ).rows[0].n,
    )
    .toBeGreaterThanOrEqual(1);

  // Demo
  await openContact(page, "?entry=direct");
  await page.getByTestId("kind-demo").check();
  const company2 = `Contoso ${Date.now()}`;
  await page.getByTestId("sales-name").fill("Sam Buyer");
  await page.getByTestId("sales-email").fill(`sam-${Date.now()}@example.test`);
  await page.getByTestId("sales-company").fill(company2);
  await page.getByTestId("sales-seats").fill("12");
  await page.getByTestId("sales-submit").click();
  await expect(page.getByTestId("sales-error")).toContainText("Pick a time");
  await page.getByTestId("demo-slots").locator('input[type="radio"]').first().check();
  await page.getByTestId("sales-submit").click();
  await expect(page.getByTestId("sales-done")).toContainText("demo is booked", { timeout: 20_000 });
  expect(
    (await pool.query(`SELECT status FROM sales_requests WHERE company = $1`, [company2])).rows[0]
      .status,
  ).toBe("demo_booked");
});

test("a customer asks for a quote, accepts and signs it, and Enterprise switches on", async ({
  page,
  browser,
}) => {
  const { email } = await createUser(page, { brand: "Orbit Lace", prefix: "sale" });
  const accountId = await accountOf(email);
  await pool.query(
    `UPDATE accounts SET plan_tier = 'growth', billing_status = 'active' WHERE id = $1`,
    [accountId],
  );

  await openContact(page, "?entry=upgrade_page");
  await expect(page.getByTestId("sales-email")).toHaveValue(email);
  await page.getByTestId("sales-seats").fill("25");
  await page.getByTestId("sales-submit").click();
  await expect(page.getByTestId("sales-done")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await userEvents(email, "Sales Contact Requested")).length)
    .toBe(1);
  expect((await userEvents(email, "Sales Contact Requested"))[0]).toMatchObject({
    entry_point: "upgrade_page",
    seats_requested: 25,
  });

  // The (simulated) rep replies fifteen minutes later with a quote.
  const reqId = (
    await pool.query(`SELECT id FROM sales_requests WHERE account_id = $1`, [accountId])
  ).rows[0].id;
  await runSalesDesk(new Date(Date.now() + 15 * 60_000), [reqId]);
  await page.goto("/inbox");
  const link = await page
    .getByTestId("inbox-message")
    .filter({ hasText: "Enterprise quote" })
    .first()
    .locator("a")
    .first()
    .getAttribute("href");
  expect(link).toMatch(/\/quote\/[0-9a-f]{48}/);

  // Signed out, the quote is readable but can't be acted on.
  const anon = await browser.newContext();
  const ap = await anon.newPage();
  await ap.goto(link!);
  await expect(ap.getByTestId("quote-summary")).toContainText("25");
  await expect(ap.getByTestId("quote-login")).toBeVisible();
  await anon.close();

  await page.goto(link!);
  await expect(page.getByTestId("quote-summary")).toContainText("12 months");
  await page.waitForLoadState("networkidle");
  await expect
    .poll(async () => (await userEvents(email, "Quote Viewed")).length)
    .toBeGreaterThanOrEqual(1);
  await scan(page);
  await page.getByTestId("quote-accept").click();
  await expect(page.getByTestId("sign-submit")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await userEvents(email, "Quote Accepted")).length).toBe(1);
  await page.getByTestId("sign-submit").click();
  await expect(page.getByTestId("quote-error")).toContainText("Tick the box");
  await page.getByTestId("sign-name").fill("E2E User");
  await page.getByTestId("sign-agree").check();
  await page.getByTestId("sign-submit").click();
  await expect(page.getByTestId("quote-signed")).toBeVisible({ timeout: 20_000 });

  const acct = (
    await pool.query(`SELECT plan_tier, motion, billing_status FROM accounts WHERE id = $1`, [
      accountId,
    ])
  ).rows[0];
  expect(acct).toEqual({
    plan_tier: "enterprise",
    motion: "sales_assisted",
    billing_status: "active",
  });
  const signed = await userEvents(email, "Contract Signed");
  expect(signed).toHaveLength(1);
  expect(signed[0]).toMatchObject({ contract_months: 12, plan_tier: "enterprise" });

  // The product reflects it straight away.
  await page.goto("/settings/usage");
  await expect(page.getByTestId("usage-plan")).toContainText("Enterprise");
  await page.goto("/settings/billing");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  // Re-opening a signed quote shows it's done.
  await page.goto(link!);
  await expect(page.getByTestId("quote-signed")).toBeVisible();
});

test("a busy account sees the sales card once, with an experiment variant and a health panel", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Orbit Lace", prefix: "pqa" });
  const accountId = await accountOf(email);

  // Before the first overnight run there is nothing to show.
  await page.goto("/settings/usage");
  await expect(page.getByTestId("health-empty")).toBeVisible();
  await page.goto(`/w/${slug}/home`);
  await expect(page.getByTestId("checklist")).toBeVisible();
  await expect(page.getByTestId("pqa-card")).toHaveCount(0);

  // The nightly job runs for real; this fresh account is active but not a lead.
  const [r] = await runNightlyScoring(new Date(), [accountId]);
  expect(r!.pqa).toBeLessThan(60);
  await page.goto("/settings/usage");
  await expect(page.getByTestId("health-band")).toBeVisible();
  await expect(page.getByTestId("health-band")).toHaveAttribute(
    "data-band",
    /healthy|watch|at_risk/,
  );
  await scan(page);

  // Pretend a heavier night: the stored score crosses the threshold.
  await pool.query(`UPDATE account_scores SET pqa = 72 WHERE account_id = $1`, [accountId]);
  await page.goto(`/w/${slug}/home`);
  const card = page.getByTestId("pqa-card");
  await expect(card).toBeVisible();
  const variant = (await card.getAttribute("data-variant"))!;
  await expect(page.getByTestId("pqa-cta")).toHaveText(
    variant === "expert" ? "Talk to an Enterprise expert" : "Talk to sales",
  );
  await expect.poll(async () => (await userEvents(email, "Experiment Exposed")).length).toBe(1);
  expect((await userEvents(email, "Experiment Exposed"))[0]).toMatchObject({
    flag_key: "sales_cta_copy",
    variant,
  });
  // Reloading in the same session doesn't expose again.
  await page.reload();
  await expect(card).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await userEvents(email, "Experiment Exposed")).toHaveLength(1);
  await scan(page);

  await page.getByTestId("pqa-cta").click();
  await page.waitForURL(/contact-sales\?entry=pqa_card/);

  await page.goto(`/w/${slug}/home`);
  await page.getByTestId("pqa-dismiss").click();
  await expect(page.getByTestId("pqa-card")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("checklist")).toBeVisible();
  await expect(page.getByTestId("pqa-card")).toHaveCount(0);
});
