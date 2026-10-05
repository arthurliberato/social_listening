import { expect, test, type Page } from "@playwright/test";
import { createUser, pool } from "./helpers";

test.setTimeout(120_000);

const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows;
async function setPlan(email: string, plan: string) {
  await pool.query(
    `UPDATE accounts SET plan_tier = $2 WHERE id IN (SELECT m.account_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1)`,
    [email, plan],
  );
}
async function queryReady(slug: string) {
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
/** A fired alert, written the way the release job writes it. */
async function fire(slug: string, severity = "warning") {
  const { rows } = await pool.query(
    `SELECT w.id AS ws, q.id AS q, u.id AS u FROM workspaces w JOIN queries q ON q.workspace_id = w.id JOIN users u ON u.id = q.created_by WHERE w.slug = $1 LIMIT 1`,
    [slug],
  );
  const r = rows[0];
  const rule = (
    await pool.query(
      `INSERT INTO alert_rules (workspace_id, query_id, name, type, params, channels, created_by) VALUES ($1,$2,'Launch-day spike','volume_spike','{"multiple":3,"minVolume":20}','{in_app}',$3) RETURNING id`,
      [r.ws, r.q, r.u],
    )
  ).rows[0].id;
  const ev = (
    await pool.query(
      `INSERT INTO alert_events (rule_id, workspace_id, fired_at, severity, summary, details) VALUES ($1,$2, now() - interval '2 hours', $3, '84 mentions in the last hour — 4.2× the usual 20 per hour.', '{"count":84,"negative":30,"usual":20,"multiple":4.2}') RETURNING id`,
      [rule, r.ws, severity],
    )
  ).rows[0].id;
  return { rule: rule as string, event: ev as string };
}
const gotoAlerts = async (page: Page, slug: string, path = "") => {
  await page.goto(`/w/${slug}/alerts${path}`);
  // A production build paints server-rendered buttons before React attaches to them; a click in that gap is lost.
  await page.waitForLoadState("networkidle");
};

test("empty state → build an alert with a live backtest → it appears in the list", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  await queryReady(slug);
  await gotoAlerts(page, slug);
  await expect(page.getByTestId("alerts-empty")).toBeVisible();
  await page.getByTestId("empty-new-alert").click();
  await page.waitForURL(/alerts\/new/);

  // The backtest replays the query's history as soon as the form loads, and again when a threshold moves.
  await expect(page.getByTestId("backtest-count")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("th-a").fill("1.5");
  await page.getByTestId("th-b").fill("5");
  await expect(page.getByTestId("backtest-count")).toContainText(/time|Never/, { timeout: 30_000 });
  const looser = await page.getByTestId("backtest-count").innerText();
  await page.getByTestId("th-a").fill("40");
  await expect(page.getByTestId("backtest-count")).not.toHaveText(looser, { timeout: 30_000 });

  // Sentiment alerts are a Growth feature: choosing one explains and offers an upgrade, without switching.
  await page
    .getByTestId("type-sentiment_drop")
    .check({ force: true })
    .catch(() => {});
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("type-volume_spike")).toBeChecked();

  await page.getByTestId("th-a").fill("2");
  // Let the backtest for this threshold settle, so the Alert Created event can report it.
  await expect(page.getByTestId("backtest-loading")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("backtest-count")).toBeVisible();
  await page.getByTestId("channel-email").check();
  await page.getByTestId("save-alert").click();
  await page.waitForURL(/alerts\?created=1/);
  await expect(page.getByTestId("alert-created")).toBeVisible();
  await expect(page.getByTestId("rule-row")).toHaveCount(1);
  await expect(page.getByTestId("rule-row")).toContainText("2× usual hourly volume");
  await expect(page.getByTestId("rule-row")).toContainText("email");

  await expect.poll(async () => (await events(email, "Alert Created")).length).toBe(1);
  const [created] = await events(email, "Alert Created");
  expect(created.props).toMatchObject({
    alert_type: "volume_spike",
    threshold: 2,
    channel: "in_app+email",
  });
  expect(typeof created.props.backtest_fire_count).toBe("number");

  // The Home checklist notices, and says so once.
  await page.goto(`/w/${slug}/home`);
  await expect(page.locator('[data-checklist-item="set_alert"]')).toHaveAttribute(
    "data-done",
    "true",
  );
  await expect
    .poll(
      async () =>
        (await events(email, "Checklist Item Completed")).filter(
          (e) => e.props.item_id === "set_alert",
        ).length,
    )
    .toBe(1);
});

test("a fired alert: bell → alert page → acknowledge; crisis rooms need an upgrade", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  await queryReady(slug);
  const { rule, event } = await fire(slug, "critical");
  await page.goto(`/w/${slug}/home`);

  await expect(page.getByTestId("notification-count")).toHaveText("1");
  await page.getByTestId("notifications").click();
  await page.getByTestId("notification").first().click();
  await page.waitForURL(new RegExp(`alerts/events/${event}`));
  await expect(page.getByTestId("event-summary")).toContainText("4.2× the usual");
  await expect(page.getByTestId("severity")).toContainText("Critical");
  await expect(page.getByTestId("event-stats")).toContainText("84");
  await expect(page.getByTestId("hourly-chart")).toBeVisible();
  // Chart numbers are also available as a table.
  await page.getByTestId("hourly-table-toggle").click();
  await expect(page.getByRole("table")).toBeVisible();

  await expect.poll(async () => (await events(email, "Alert Opened")).length).toBe(1);
  expect((await events(email, "Alert Opened"))[0]!.props).toMatchObject({ alert_id: rule });
  // Reloading doesn't count as a second first-open.
  await page.reload();
  await expect(page.getByTestId("event-summary")).toBeVisible();
  await page.waitForTimeout(500);
  expect((await events(email, "Alert Opened")).length).toBe(1);

  // The feed link carries the query and the time window.
  await expect(page.getByTestId("view-mentions")).toHaveAttribute(
    "href",
    /mentions\?q=.*range=custom/,
  );

  // Trial plan: the crisis room is a paywall, not a dead button.
  await page.getByTestId("start-crisis").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("acknowledge").click();
  await expect(page.getByTestId("acked")).toBeVisible();
  await expect.poll(async () => (await events(email, "Alert Acknowledged")).length).toBe(1);
  const [ack] = await events(email, "Alert Acknowledged");
  expect(ack.props).toMatchObject({ alert_id: rule });
  expect(ack.props.time_to_ack_ms).toBeGreaterThan(0);
  await page.goto(`/w/${slug}/home`);
  await expect(page.getByTestId("notification-count")).toHaveCount(0);
});

test("mute, unmute and delete a rule; the plan's alert limit opens a paywall", async ({ page }) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  await queryReady(slug);
  await fire(slug);
  await gotoAlerts(page, slug);
  const row = page.getByTestId("rule-row").first();
  await expect(row.getByTestId("rule-status")).toHaveText("Active");
  await row.getByTestId("alert-mute").click();
  await expect(row.getByTestId("rule-status")).toHaveText("Muted");
  await expect.poll(async () => (await events(email, "Alert Muted")).length).toBe(1);
  await row.getByTestId("alert-mute").click();
  await expect(row.getByTestId("rule-status")).toHaveText("Active");

  // Fill the rest of the trial allowance, then "New alert" is a paywall.
  const { rows } = await pool.query(
    `SELECT workspace_id, query_id, created_by FROM alert_rules ORDER BY created_at DESC LIMIT 1`,
  );
  const limit = (await pool.query(`SELECT 1`)).rowCount; // keep pool warm
  void limit;
  const used = Number((await page.getByTestId("alert-usage").innerText()).match(/^(\d+)/)![1]);
  const cap = Number((await page.getByTestId("alert-usage").innerText()).match(/of (\d+)/)![1]);
  for (let i = used; i < cap; i++)
    await pool.query(
      `INSERT INTO alert_rules (workspace_id, query_id, name, type, created_by) VALUES ($1,$2,$3,'volume_spike',$4)`,
      [rows[0].workspace_id, rows[0].query_id, `Filler ${i}`, rows[0].created_by],
    );
  await gotoAlerts(page, slug);
  await page.getByTestId("new-alert").click();
  await expect(page.getByTestId("paywall-modal")).toContainText("alert limit");
  await page.keyboard.press("Escape");
  // Server-side too: the builder page itself refuses.
  await gotoAlerts(page, slug, "/new");
  await expect(page.getByTestId("alert-limit")).toBeVisible();

  // Delete is two steps, and cancel keeps the rule.
  await gotoAlerts(page, slug);
  const before = await page.getByTestId("rule-row").count();
  await page.getByTestId("alert-delete").first().click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByTestId("rule-row")).toHaveCount(before);
  await page.getByTestId("alert-delete").first().click();
  await page.getByTestId("alert-delete-confirm").click();
  await expect(page.getByTestId("rule-row")).toHaveCount(before - 1);
  await expect.poll(async () => (await events(email, "Alert Deleted")).length).toBe(1);
});

test("crisis room: tasks, a stakeholder update that lands in the inbox, and resolving", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  await queryReady(slug);
  await setPlan(email, "growth");
  const { rule, event } = await fire(slug, "critical");

  await page.goto(`/w/${slug}/alerts/events/${event}`);
  await page.getByTestId("start-crisis").click();
  await page.waitForURL(/crisis\/[0-9a-f-]{36}/);
  const crisisId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByTestId("room-title")).toContainText("Latte Lane");
  await expect(page.getByTestId("room-kpis")).toBeVisible();
  await expect.poll(async () => (await events(email, "Crisis Room Opened")).length).toBe(1);
  expect((await events(email, "Crisis Room Opened"))[0]!.props).toMatchObject({
    crisis_id: crisisId,
  });
  // The alert was acknowledged by opening the room, and a second click reuses it.
  await page.goto(`/w/${slug}/alerts/events/${event}`);
  await expect(page.getByTestId("open-crisis")).toHaveAttribute("href", new RegExp(crisisId));
  void rule;
  await page.goto(`/w/${slug}/crisis/${crisisId}`);

  await expect(page.getByTestId("tasks-empty")).toBeVisible();
  await page.getByTestId("task-title").fill("Draft holding statement");
  await page.getByTestId("add-task").click();
  await expect(page.getByTestId("task")).toHaveCount(1);
  await page.getByTestId("task").getByRole("checkbox").check();
  await expect(page.getByTestId("task").getByRole("checkbox")).toBeChecked();
  await expect.poll(async () => (await events(email, "Crisis Task Created")).length).toBe(1);

  // The update is pre-drafted from live numbers; sending needs a recipient.
  await expect(page.getByTestId("update-body")).toHaveValue(/mentions, \d+% negative/);
  await page.getByTestId("send-update").click();
  await expect(page.getByTestId("update-error")).toContainText("recipient");
  await page.getByTestId("recipient-E2E User").check();
  await page.getByTestId("send-update").click();
  await expect(page.getByTestId("update-sent")).toContainText("Sent to 1 person");
  await expect
    .poll(async () => (await events(email, "Stakeholder Update Sent"))[0]?.props)
    .toMatchObject({ crisis_id: crisisId, recipients_count: 1, is_ai_drafted: false });
  await page.goto("/inbox");
  await expect(
    page.getByTestId("inbox-message").filter({ hasText: "Update:" }).first(),
  ).toBeVisible();

  await page.goto(`/w/${slug}/crisis/${crisisId}`);
  await page.waitForLoadState("networkidle"); // a production build paints buttons before React attaches
  await page.getByTestId("resolve").click();
  await page.getByTestId("resolve-confirm").click();
  await expect(page.getByTestId("room-status")).toContainText("Resolved");
  await expect
    .poll(async () => (await events(email, "Crisis Room Resolved"))[0]?.props.duration_ms)
    .toBeGreaterThan(0);
  await page.getByTestId("reopen").click();
  await expect(page.getByTestId("room-status")).toHaveText("Open");

  await page.goto(`/w/${slug}/crisis`);
  await expect(page.getByTestId("crisis-row")).toHaveCount(1);
});

test("crisis rooms are locked on a plan without them", async ({ page }) => {
  const { slug } = await createUser(page, { brand: "Latte Lane" });
  await page.goto(`/w/${slug}/crisis`);
  await expect(page.getByTestId("crisis-locked")).toBeVisible();
  await expect(page.getByTestId("crisis-upgrade")).toBeVisible();
});

test("alerts and crisis rooms are scoped to their workspace", async ({ page, browser }) => {
  const a = await createUser(page, { brand: "Latte Lane" });
  await queryReady(a.slug);
  const { event } = await fire(a.slug);
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  const b = await createUser(p2, { brand: "Latte Lane" });
  await p2.goto(`/w/${b.slug}/alerts/events/${event}`);
  // (Streaming pages answer 200 and render the not-found UI.) Nothing of the other workspace's alert shows.
  await expect(p2.getByText("could not be found")).toBeVisible();
  await expect(p2.getByText("4.2× the usual")).toHaveCount(0);
  await ctx2.close();
});
