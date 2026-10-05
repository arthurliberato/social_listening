import { expect, test } from "@playwright/test";
import { createUser, pool } from "./helpers";

test.setTimeout(180_000);

const accountOf = async (email: string) =>
  (
    await pool.query(
      `SELECT m.account_id AS id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1 LIMIT 1`,
      [email],
    )
  ).rows[0].id as string;
const logged = async (accountId: string) =>
  (
    await pool.query(
      `SELECT action, meta, target_type FROM audit_log WHERE account_id = $1 AND (action LIKE 'query.%' OR action LIKE 'dashboard.%' OR action LIKE 'report.%' OR action LIKE 'alert.%' OR action LIKE 'crisis.%') ORDER BY seq`,
      [accountId],
    )
  ).rows as { action: string; meta: Record<string, unknown>; target_type: string }[];
const actions = async (accountId: string) => (await logged(accountId)).map((r) => r.action);

test("what people change in queries, dashboards, reports, alerts and crisis rooms is in the audit log", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Orbit Lace", prefix: "aud" });
  const accountId = await accountOf(email);
  const q = (
    await pool.query(
      `SELECT q.id, q.name FROM queries q JOIN workspaces w ON w.id = q.workspace_id WHERE w.slug = $1`,
      [slug],
    )
  ).rows[0];
  await expect
    .poll(
      async () =>
        (await pool.query(`SELECT backfill_status AS s FROM queries WHERE id = $1`, [q.id])).rows[0]
          .s,
    )
    .toMatch(/done|quota_exhausted/);

  // Recording doesn't depend on the plan: a change made on the trial shows up once the log is unlocked.
  await page.goto(`/w/${slug}/queries`);
  await expect(page.getByTestId(`toggle-${q.id}`)).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`toggle-${q.id}`).click();
  await expect.poll(async () => (await actions(accountId)).includes("query.paused")).toBe(true);
  await page.getByTestId(`toggle-${q.id}`).click();
  await expect.poll(async () => (await actions(accountId)).includes("query.resumed")).toBe(true);
  await pool.query(`UPDATE accounts SET plan_tier = 'enterprise' WHERE id = $1`, [accountId]);

  // Dashboard from a template.
  await page.goto(`/w/${slug}/dashboards`);
  await page.getByTestId("new-dashboard").click();
  await page.getByTestId("template-executive_summary").click();
  await page.waitForURL(/dashboards\/[0-9a-f-]{36}\?edit=1/);
  await expect
    .poll(async () => (await actions(accountId)).includes("dashboard.created"))
    .toBe(true);

  // Report: create, then delete.
  await page.goto(`/w/${slug}/reports`);
  await page.getByTestId("empty-new-report").click();
  await page.getByTestId("template-weekly_brand_summary").click();
  await page.waitForURL(/reports\/[0-9a-f-]{36}\?edit=1/);
  await expect.poll(async () => (await actions(accountId)).includes("report.created")).toBe(true);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("delete-report").click();
  await page.getByTestId("delete-confirm").click();
  await expect.poll(async () => (await actions(accountId)).includes("report.deleted")).toBe(true);

  // Alert: mute, unmute, delete.
  const ids = (
    await pool.query(
      `SELECT w.id AS ws, u.id AS u FROM workspaces w JOIN users u ON lower(u.email) = $2 WHERE w.slug = $1`,
      [slug, email],
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO alert_rules (workspace_id, query_id, name, type, params, channels, created_by) VALUES ($1,$2,'Spike watch','volume_spike','{"multiple":3,"minVolume":20}','{in_app}',$3)`,
    [ids.ws, q.id, ids.u],
  );
  await page.goto(`/w/${slug}/alerts`);
  const row = page.getByTestId("rule-row").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await row.getByTestId("alert-mute").click();
  await expect.poll(async () => (await actions(accountId)).includes("alert.muted")).toBe(true);
  await row.getByTestId("alert-mute").click();
  await expect.poll(async () => (await actions(accountId)).includes("alert.unmuted")).toBe(true);
  await row.getByTestId("alert-delete").click();
  await page.getByTestId("alert-delete-confirm").click();
  await expect.poll(async () => (await actions(accountId)).includes("alert.deleted")).toBe(true);

  // Crisis room: resolve, reopen.
  const crisis = (
    await pool.query(
      `INSERT INTO crises (workspace_id, query_id, title, window_start, opened_by) VALUES ($1,$2,'Orbit Lace: test room', now() - interval '2 days', $3) RETURNING id`,
      [ids.ws, q.id, ids.u],
    )
  ).rows[0].id;
  await page.goto(`/w/${slug}/crisis/${crisis}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("resolve").click();
  await page.getByTestId("resolve-confirm").click();
  await expect.poll(async () => (await actions(accountId)).includes("crisis.resolved")).toBe(true);
  await page.getByTestId("reopen").click();
  await expect.poll(async () => (await actions(accountId)).includes("crisis.reopened")).toBe(true);

  // Query deletion last.
  await page.goto(`/w/${slug}/queries`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`delete-${q.id}`).click();
  await page.getByTestId(`confirm-delete-${q.id}`).click();
  await expect.poll(async () => (await actions(accountId)).includes("query.deleted")).toBe(true);

  // Order, and that the entries carry who/what but never anything sensitive.
  const all = await logged(accountId);
  expect(all.map((r) => r.action)).toEqual([
    "query.paused",
    "query.resumed",
    "dashboard.created",
    "report.created",
    "report.deleted",
    "alert.muted",
    "alert.unmuted",
    "alert.deleted",
    "crisis.resolved",
    "crisis.reopened",
    "query.deleted",
  ]);
  expect(all.find((r) => r.action === "dashboard.created")!.meta).toMatchObject({
    template: "executive_summary",
  });
  expect(all.find((r) => r.action === "query.deleted")!.meta).toMatchObject({ name: q.name });

  // The log screen shows them, with readable labels and working category filters.
  await page.goto("/settings/audit?cat=alerts");
  await expect(page.getByTestId("audit-row").first()).toBeVisible({ timeout: 30_000 });
  const alertRows = await page
    .getByTestId("audit-row")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-action")));
  expect(alertRows.sort()).toEqual([
    "alert.deleted",
    "alert.muted",
    "alert.unmuted",
    "crisis.reopened",
    "crisis.resolved",
  ]);
  await expect(page.locator('[data-testid="audit-row"][data-action="alert.muted"]')).toContainText(
    "Spike watch",
  );
  await page.goto("/settings/audit?cat=content");
  const contentRows = await page
    .getByTestId("audit-row")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-action")));
  expect(contentRows.sort()).toEqual(
    [
      "dashboard.created",
      "query.deleted",
      "query.paused",
      "query.resumed",
      "report.created",
      "report.deleted",
    ].sort(),
  );
  await expect(page.getByTestId("audit-row").filter({ hasText: "Deleted a query" })).toContainText(
    q.name,
  );
});
