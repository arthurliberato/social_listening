import { expect, test } from "@playwright/test";
import { createUser, pool } from "./helpers";

const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2`,
      [email, name],
    )
  ).rows;

test("categories: define a theme, see its size, open its mentions, delete it", async ({ page }) => {
  test.setTimeout(120_000);
  const { email, slug } = await createUser(page, { brand: "Juniper Roast" });
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

  await page.goto(`/w/${slug}/tags`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("categories-empty")).toBeVisible();

  // A bad search explains itself and saves nothing.
  await page.getByTestId("category-name").fill("Coffee talk");
  await page.getByTestId("category-text").fill("(coffee OR");
  await page.getByTestId("category-save").click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByTestId("category-row")).toHaveCount(0);

  // A good one: check it first, then save.
  await page.getByTestId("category-text").fill("coffee OR roast");
  await page.getByTestId("category-check").click();
  await expect(page.getByTestId("category-preview")).toContainText(/mentions in the last 30 days/);
  await page.getByTestId("category-save").click();
  await expect(page.getByTestId("category-row")).toHaveCount(1);
  await expect(page.getByTestId("category-row")).toContainText("Coffee talk");
  const total = Number(
    (await page.getByTestId("category-total").innerText()).replace(/[^0-9]/g, ""),
  );
  expect(total).toBeGreaterThan(0);

  // Names are unique, ignoring case.
  await page.getByTestId("category-name").fill("coffee TALK");
  await page.getByTestId("category-text").fill("tea");
  await page.getByTestId("category-save").click();
  await expect(page.getByRole("alert").filter({ hasText: "already exists" })).toBeVisible();

  // It opens the feed with the same search, and the counts agree.
  await page.getByTestId("category-open").click();
  await page.waitForURL(/mentions\?.*search=/);
  await expect
    .poll(async () =>
      Number((await page.getByTestId("result-count").innerText()).replace(/[^0-9]/g, "")),
    )
    .toBe(total);

  // Delete is two steps, and "Keep it" backs out.
  await page.goto(`/w/${slug}/tags`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("category-delete").click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByTestId("category-row")).toHaveCount(1);
  await page.getByTestId("category-delete").click();
  await page.getByTestId("category-delete-confirm").click();
  await expect(page.getByTestId("category-row")).toHaveCount(0);

  await expect.poll(async () => (await events(email, "Category Created")).length).toBe(1);
  await expect.poll(async () => (await events(email, "Category Deleted")).length).toBe(1);
  const log = (
    await pool.query(
      `SELECT action FROM audit_log a JOIN workspaces w ON w.id = a.workspace_id WHERE w.slug = $1 AND action LIKE 'category.%' ORDER BY seq`,
      [slug],
    )
  ).rows.map((r) => r.action);
  expect(log).toEqual(["category.created", "category.deleted"]);
});

test("a viewer can read categories but not change them", async ({ page }) => {
  const { slug } = await createUser(page, { brand: "Orbit Lace" });
  await pool.query(
    `UPDATE memberships SET role = 'viewer' WHERE workspace_id = (SELECT id FROM workspaces WHERE slug = $1)`,
    [slug],
  );
  await page.goto(`/w/${slug}/tags`);
  await expect(page.getByTestId("categories-readonly")).toBeVisible();
  await expect(page.getByTestId("category-form")).toHaveCount(0);
});
