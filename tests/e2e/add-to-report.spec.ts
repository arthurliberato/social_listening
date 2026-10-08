import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createUser, pool } from "./helpers";

test.setTimeout(240_000);

const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows.map((r) => r.props as Record<string, unknown>);
const sectionsOf = async (slug: string) =>
  (
    await pool.query(
      `SELECT r.id, r.name, r.sections FROM reports r JOIN workspaces w ON w.id = r.workspace_id WHERE w.slug = $1 ORDER BY r.created_at`,
      [slug],
    )
  ).rows as {
    id: string;
    name: string;
    sections: { type: string; title: string; config: object }[];
  }[];
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
async function addFromWidget(page: Page, title: string) {
  const cell = page
    .getByTestId("widget-cell")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await cell.getByTestId("widget-menu").click();
  await page.getByTestId("menu-add-to-report").click();
  await expect(page.getByTestId("add-to-report-dialog")).toBeVisible();
}

test("add widgets from a dashboard, Topics and Authors to a new and an existing report", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane", prefix: "atr" });
  await pool.query(
    `UPDATE accounts SET plan_tier = 'enterprise' WHERE id IN (SELECT m.account_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1)`,
    [email],
  );
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

  await page.goto(`/w/${slug}/dashboards`);
  await page.getByTestId("new-dashboard").click();
  await page.getByTestId("template-brand_health").click();
  await page.waitForURL(/dashboards\/[0-9a-f-]{36}\?edit=1/);
  await expect(page.getByTestId("widget-loading")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForLoadState("networkidle");

  // First one: no reports yet, so "a new report" is the only (and selected) choice.
  await addFromWidget(page, "Mentions over time");
  await expect(page.getByTestId("atr-report")).toHaveCount(0);
  await expect(page.getByTestId("atr-new")).toBeChecked();
  await scan(page);
  await page.getByTestId("atr-submit").click();
  await expect(page.getByTestId("atr-done")).toContainText("a new report", { timeout: 20_000 });
  await page.getByTestId("atr-close").click();
  await expect(page.getByTestId("add-to-report-dialog")).toBeHidden();

  // Second: the existing report is offered and preselected.
  await addFromWidget(page, "Top sources");
  await expect(page.getByTestId("atr-report")).toHaveCount(1);
  await expect(page.getByTestId("atr-report")).toBeChecked();
  await page.getByTestId("atr-submit").click();
  await expect(page.getByTestId("atr-done")).not.toContainText("a new report", { timeout: 20_000 });
  await page.getByTestId("atr-open").click();
  await page.waitForURL(/reports\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("report-section")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId("section-loading")).toHaveCount(0, { timeout: 45_000 });

  // Topics and Authors.
  await page.goto(`/w/${slug}/topics?range=90d`);
  await expect(page.getByTestId("topics-table")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await page.getByTestId("add-to-report").click();
  await page.getByTestId("atr-submit").click();
  await expect(page.getByTestId("atr-done")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("atr-close").click();
  await page.goto(`/w/${slug}/authors?range=90d`);
  await expect(page.getByTestId("authors-table")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await page.getByTestId("add-to-report").click();
  await page.getByTestId("atr-submit").click();
  await expect(page.getByTestId("atr-done")).toBeVisible({ timeout: 20_000 });

  const rs = await sectionsOf(slug);
  expect(rs).toHaveLength(1);
  expect(rs[0]!.sections.map((s) => s.type)).toEqual([
    "volume",
    "bar",
    "topic_cloud",
    "top_authors",
  ]);
  expect(rs[0]!.sections.map((s) => s.title)).toEqual([
    "Mentions over time",
    "Top sources",
    "Topics",
    "Top authors",
  ]);
  expect(rs[0]!.name).toBe("Mentions over time report");

  await expect.poll(async () => (await events(email, "Report Section Added")).length).toBe(4);
  expect(
    (await events(email, "Report Section Added")).map((e) => [e.source, e.is_new_report]),
  ).toEqual([
    ["dashboard", true],
    ["dashboard", false],
    ["topics", false],
    ["authors", false],
  ]);
  expect(
    (await events(email, "Report Created")).filter((e) => e.template_id === "blank"),
  ).toHaveLength(1);
  const audit = (
    await pool.query(
      `SELECT action FROM audit_log a JOIN workspaces w ON w.id = a.workspace_id WHERE w.slug = $1 AND a.action LIKE 'report.%' ORDER BY a.seq`,
      [slug],
    )
  ).rows.map((r) => r.action);
  expect(audit).toEqual([
    "report.created",
    "report.section_added",
    "report.section_added",
    "report.section_added",
    "report.section_added",
  ]);

  // A full report is shown as full and can't be picked; the dialog falls back to a new report.
  await pool.query(
    `UPDATE reports SET sections = (SELECT jsonb_agg(jsonb_build_object('id','s'||g,'type','kpi','title','KPI '||g,'config','{}'::jsonb)) FROM generate_series(1,20) g) WHERE id = $1`,
    [rs[0]!.id],
  );
  await page.goto(`/w/${slug}/topics?range=90d`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("add-to-report").click();
  await expect(page.getByTestId("atr-report")).toBeDisabled();
  await expect(page.getByTestId("atr-new")).toBeChecked();
  await expect(page.getByTestId("add-to-report-dialog")).toContainText("Full: 20 sections");
});

test("people who can't edit don't see Add to report", async ({ page }) => {
  // A busy brand, and wait for its history: Topics shows an empty state, not a table, until there is data to rank.
  const { email, slug } = await createUser(page, { brand: "Juniper Roast", prefix: "atrv" });
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
  await page.goto(`/w/${slug}/dashboards`);
  await page.getByTestId("new-dashboard").click();
  await page.getByTestId("template-brand_health").click();
  await page.waitForURL(/dashboards\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("widget-loading")).toHaveCount(0, { timeout: 60_000 });
  await pool.query(
    `UPDATE memberships SET role = 'viewer' WHERE user_id = (SELECT id FROM users WHERE lower(email) = $1)`,
    [email],
  );
  await page.reload();
  await expect(page.getByTestId("widget").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await page.getByTestId("widget-menu").first().click();
  await expect(page.getByRole("menuitem", { name: /Export CSV/ })).toBeVisible();
  await expect(page.getByTestId("menu-add-to-report")).toHaveCount(0);
  await page.goto(`/w/${slug}/topics?range=90d`);
  await expect(page.getByTestId("topics-table")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("add-to-report")).toHaveCount(0);
});
