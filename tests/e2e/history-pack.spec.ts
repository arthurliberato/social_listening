import { expect, test } from "@playwright/test";
import { createUser, pool } from "./helpers";

const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows;

async function ready(slug: string) {
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            `SELECT q.backfill_status AS s FROM queries q JOIN workspaces w ON w.id = q.workspace_id WHERE w.slug = $1`,
            [slug],
          )
        ).rows[0]?.s,
      { timeout: 45_000 },
    )
    .toMatch(/done|quota_exhausted/);
}
const query = async (slug: string) =>
  (
    await pool.query(
      `SELECT q.id, w.account_id AS acct FROM queries q JOIN workspaces w ON w.id = q.workspace_id WHERE w.slug = $1`,
      [slug],
    )
  ).rows[0] as { id: string; acct: string };

test("buy a history pack: explained, charged once, older mentions collected, invoiced", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const { email, slug } = await createUser(page, { brand: "Juniper Roast" });
  await ready(slug);
  const q = await query(slug);

  // On a trial the offer is explained but needs a paid plan.
  await page.goto(`/w/${slug}/queries`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`history-${q.id}`).click();
  await expect(page.getByTestId(`history-panel-${q.id}`)).toContainText("$49");
  await expect(page.getByTestId("history-upgrade")).toHaveAttribute(
    "href",
    /upgrade\?from=history_pack/,
  );
  await expect(page.getByTestId(`history-buy-${q.id}`)).toHaveCount(0);

  // On a paid plan with a card on file, an owner can buy it.
  await pool.query(
    `UPDATE accounts SET plan_tier = 'starter', billing_status = 'active' WHERE id = $1`,
    [q.acct],
  );
  await pool.query(
    `INSERT INTO payment_methods (account_id, brand, last4, exp_month, exp_year, holder_name, behavior, is_default) VALUES ($1,'visa','4242',12,2030,'E2E','ok',true)`,
    [q.acct],
  );
  await page.goto(`/w/${slug}/queries`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`history-${q.id}`).click();
  await expect(page.getByTestId(`history-panel-${q.id}`)).toContainText("4242");
  await page.getByTestId(`history-buy-${q.id}`).click();
  await expect(page.getByTestId(`history-status-${q.id}`)).toContainText(
    "Collecting older mentions",
  );

  // The worker collects it; the row then says how much came back.
  await expect
    .poll(
      async () =>
        (await pool.query(`SELECT status, matched FROM history_packs WHERE query_id = $1`, [q.id]))
          .rows[0],
      { timeout: 90_000 },
    )
    .toMatchObject({ status: "done" });
  const pack = (await pool.query(`SELECT matched FROM history_packs WHERE query_id = $1`, [q.id]))
    .rows[0];
  expect(pack.matched).toBeGreaterThan(0);
  await page.goto(`/w/${slug}/queries`);
  await expect(page.getByTestId(`history-status-${q.id}`)).toContainText("+1 year of history");
  await expect(page.getByTestId(`history-${q.id}`)).toHaveCount(0); // one pack per query

  // Charged once, receipted, tracked, and visible on the billing page.
  const inv = (
    await pool.query(`SELECT kind, amount_cents FROM invoices WHERE account_id = $1`, [q.acct])
  ).rows;
  expect(inv).toEqual([{ kind: "addon", amount_cents: 4900 }]);
  await expect.poll(async () => (await events(email, "Add-on Purchased")).length).toBe(1);
  expect((await events(email, "Add-on Purchased"))[0]!.props).toMatchObject({
    addon: "history_pack",
    price_cents: 4900,
  });
  await page.goto("/inbox");
  await expect(
    page.getByTestId("inbox-message").filter({ hasText: "History pack" }).first(),
  ).toBeVisible();
  await page.goto("/settings/billing");
  await expect(page.getByText(/History pack/).first()).toBeVisible();
});

test("an editor can't buy add-ons", async ({ page }) => {
  const { slug } = await createUser(page, { brand: "Orbit Lace" });
  await ready(slug);
  const q = await query(slug);
  await pool.query(
    `UPDATE accounts SET plan_tier = 'starter', billing_status = 'active' WHERE id = $1`,
    [q.acct],
  );
  await pool.query(
    `UPDATE memberships SET role = 'editor' WHERE workspace_id = (SELECT id FROM workspaces WHERE slug = $1)`,
    [slug],
  );
  await page.goto(`/w/${slug}/queries`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`history-${q.id}`).click();
  await expect(page.getByTestId("history-ask-admin")).toBeVisible();
  await expect(page.getByTestId(`history-buy-${q.id}`)).toHaveCount(0);
});
