// Creates one verified, onboarded user (via the real UI) and saves its session for other specs.
import { expect, test as setup } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { createUser, pool } from "./helpers";

setup("create onboarded user", async ({ page }) => {
  setup.setTimeout(120_000); // cold dev-server compiles
  const { email, slug } = await createUser(page, { prefix: "setup", brand: "Latte Lane" });
  // One saved dashboard for the a11y scans of the M5 screens.
  await page.goto(`/w/${slug}/dashboards`);
  await page.getByTestId("new-dashboard").click();
  await page.getByTestId("template-brand_health").click();
  await page.waitForURL(/dashboards\/[0-9a-f-]{36}\?edit=1/);
  const dashboardId = /dashboards\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.getByTestId("save-dashboard").click();
  await expect(page.getByTestId("edit-dashboard")).toBeVisible();
  // A fired alert and a crisis room, for the M6 a11y scans (written the way the release job and the UI write them).
  const w = (
    await pool.query(
      `SELECT w.id AS ws, q.id AS q, u.id AS u FROM workspaces w JOIN queries q ON q.workspace_id = w.id JOIN users u ON u.id = q.created_by WHERE w.slug = $1 LIMIT 1`,
      [slug],
    )
  ).rows[0];
  const rule = (
    await pool.query(
      `INSERT INTO alert_rules (workspace_id, query_id, name, type, params, channels, created_by) VALUES ($1,$2,'Launch-day spike','volume_spike','{"multiple":3,"minVolume":20}','{in_app}',$3) RETURNING id`,
      [w.ws, w.q, w.u],
    )
  ).rows[0].id;
  const eventId = (
    await pool.query(
      `INSERT INTO alert_events (rule_id, workspace_id, fired_at, severity, summary, details) VALUES ($1,$2, now() - interval '2 hours', 'critical', '84 mentions in the last hour — 4.2× the usual 20 per hour.', '{"count":84,"negative":30,"usual":20,"multiple":4.2}') RETURNING id`,
      [rule, w.ws],
    )
  ).rows[0].id;
  const crisisId = (
    await pool.query(
      `INSERT INTO crises (workspace_id, query_id, alert_event_id, title, window_start, opened_by) VALUES ($1,$2,$3,'Latte Lane: volume spike', now() - interval '8 hours', $4) RETURNING id`,
      [w.ws, w.q, eventId, w.u],
    )
  ).rows[0].id;
  writeFileSync(
    "tests/.auth/meta.json",
    JSON.stringify({ slug, email, dashboardId, eventId, crisisId }),
  );
  await page.context().storageState({ path: "tests/.auth/user.json" });
});
