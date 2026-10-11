import { expect, test } from "@playwright/test";
import { createUser, pool } from "./helpers";

const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows;

test("copy a query to another workspace, duplicate it in place, and hit the plan limit", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { email, slug } = await createUser(page, { brand: "Orbit Lace" });
  const first = (
    await pool.query(
      `SELECT q.id, q.name, q.boolean_text, w.id AS ws, w.account_id AS acct FROM queries q JOIN workspaces w ON w.id = q.workspace_id WHERE w.slug = $1`,
      [slug],
    )
  ).rows[0];

  // A second workspace in the same account (agency plans allow several), owned by the same person.
  await pool.query(`UPDATE accounts SET plan_tier = 'agency' WHERE id = $1`, [first.acct]);
  const other = `second-${Date.now()}`;
  const w2 = (
    await pool.query(
      `INSERT INTO workspaces (account_id, name, slug) VALUES ($1, 'Second client', $2) RETURNING id`,
      [first.acct, other],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO memberships (user_id, workspace_id, account_id, role) SELECT u.id, $1, $2, 'owner' FROM users u WHERE lower(u.email) = $3`,
    [w2, first.acct, email],
  );

  await page.goto(`/w/${slug}/queries`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`copy-${first.id}`).click();
  await page.getByTestId(`copy-target-${first.id}`).selectOption(other);
  await page.getByTestId(`copy-confirm-${first.id}`).click();
  await expect(page.getByTestId(`copied-${first.id}`)).toContainText("Second client");

  const copy = (
    await pool.query(
      `SELECT name, boolean_text, status, created_by FROM queries WHERE workspace_id = $1`,
      [w2],
    )
  ).rows;
  expect(copy).toHaveLength(1);
  expect(copy[0]).toMatchObject({
    name: first.name,
    boolean_text: first.boolean_text,
    status: "live",
  });
  await expect.poll(async () => (await events(email, "Query Copied")).length).toBe(1);
  expect((await events(email, "Query Copied"))[0]!.props).toMatchObject({
    across_workspaces: true,
  });
  const log = (
    await pool.query(
      `SELECT action, meta FROM audit_log WHERE workspace_id = $1 AND action = 'query.copied'`,
      [w2],
    )
  ).rows;
  expect(log).toHaveLength(1);
  expect(log[0].meta).toMatchObject({ name: first.name, from: expect.any(String) });

  // The copy collects its own history in the new workspace.
  await page.goto(`/w/${other}/queries`);
  await expect(page.getByRole("row").filter({ hasText: first.name })).toBeVisible();

  // Duplicate in place: the name says so.
  await page.goto(`/w/${slug}/queries`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`copy-${first.id}`).click();
  await page.getByTestId(`copy-target-${first.id}`).selectOption(slug);
  await page.getByTestId(`copy-confirm-${first.id}`).click();
  await expect(page.getByRole("row").filter({ hasText: `${first.name} (copy)` })).toBeVisible();

  // At the plan's limit the copy is refused with the usual upgrade prompt, and nothing is created.
  await pool.query(`UPDATE accounts SET plan_tier = 'trial' WHERE id = $1`, [first.acct]);
  await pool.query(
    `INSERT INTO queries (workspace_id, name, boolean_text, status) VALUES ($1,'Filler','filler','paused')`,
    [first.ws],
  );
  const before = Number(
    (await pool.query(`SELECT count(*) FROM queries WHERE workspace_id = $1`, [first.ws])).rows[0]
      .count,
  );
  await pool.query(`UPDATE queries SET status = 'live' WHERE workspace_id = $1`, [first.ws]);
  await page.goto(`/w/${slug}/queries`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`copy-${first.id}`).click();
  await page.getByTestId(`copy-target-${first.id}`).selectOption(slug);
  await page.getByTestId(`copy-confirm-${first.id}`).click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  expect(
    Number(
      (await pool.query(`SELECT count(*) FROM queries WHERE workspace_id = $1`, [first.ws])).rows[0]
        .count,
    ),
  ).toBe(before);
});

test("viewers don't get a copy action", async ({ page }) => {
  const { slug } = await createUser(page, { brand: "Orbit Lace" });
  await pool.query(
    `UPDATE memberships SET role = 'viewer' WHERE workspace_id = (SELECT id FROM workspaces WHERE slug = $1)`,
    [slug],
  );
  await page.goto(`/w/${slug}/queries`);
  await expect(page.getByText("View only").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Copy / })).toHaveCount(0);
});
