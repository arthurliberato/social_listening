// Builds one realistic demo account through the real UI, then photographs each screen in light and dark.
// Run with `npm run screenshots`. Output: docs/screenshots/NN-name-{light,dark}.jpg
import { expect, test, type Page } from "@playwright/test";
import { runBackfill } from "../../jobs/backfill";
import { runNightlyScoring } from "../../jobs/pqa";
import { evaluateAlerts } from "../../lib/alerts/engine";
import { createUser, pool } from "../e2e/helpers";

const BRAND = "Skyharbor Air"; // had a real (synthetic) crisis ~18 days ago, so alerts and the crisis room have substance
const CRISIS_ID = 22008;
const consoleErrors: string[] = [];

const OUT = "docs/screenshots";
type Shot = {
  n: string;
  name: string;
  path: string;
  ready: (p: Page) => Promise<void>;
  /** Viewport height to use for long pages. */
  full?: number;
};

const settled = async (p: Page) => {
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(400);
};
const widgetsLoaded = async (p: Page) => {
  await expect(p.getByTestId("widget").first()).toBeVisible({ timeout: 60_000 });
  await expect(p.getByTestId("widget-loading")).toHaveCount(0, { timeout: 60_000 });
  await settled(p);
};

async function shoot(page: Page, s: Shot) {
  for (const theme of ["light", "dark"] as const) {
    await page.addInitScript((t) => localStorage.setItem("rw-theme", t), theme);
    await page.evaluate((t) => localStorage.setItem("rw-theme", t), theme).catch(() => {});
    await page.goto(s.path);
    await s.ready(page);
    // The dev server's own badge isn't part of the product.
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    const base = page.viewportSize()!;
    if (s.full) {
      // The app shell is exactly one viewport tall and scrolls inside, so grow the viewport instead.
      await page.setViewportSize({ width: base.width, height: s.full });
      await page.waitForTimeout(900);
    }
    await page.screenshot({
      path: `${OUT}/${s.n}-${s.name}-${theme}.jpg`,
      type: "jpeg",
      quality: 82,
    });
    if (s.full) await page.setViewportSize(base);
  }
}

test("tour", async ({ page }) => {
  page.on("pageerror", (e) => consoleErrors.push(`pageerror ${page.url()} ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`console ${page.url()} ${m.text().slice(0, 200)}`);
  });
  // Signed out: the two public screens people meet first.
  const publicShots: Shot[] = [
    {
      n: "01",
      name: "pricing",
      path: "/pricing",
      ready: async (p) => {
        await expect(p.getByTestId("cta-enterprise")).toBeVisible({ timeout: 30_000 });
        await settled(p);
      },
      full: 980,
    },
    {
      n: "02",
      name: "login",
      path: "/login",
      ready: async (p) => {
        await expect(p.getByTestId("login-email")).toBeVisible({ timeout: 30_000 });
        await settled(p);
      },
    },
  ];
  for (const s of publicShots) await shoot(page, s);

  // A demo workspace, set up the way a customer would, then dressed with fictitious names.
  const { email, slug } = await createUser(page, { brand: BRAND, prefix: "demo" });
  await pool.query(`UPDATE users SET name = 'Maya Okafor' WHERE lower(email) = $1`, [email]);
  const acct = (
    await pool.query(
      `SELECT m.account_id AS id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1`,
      [email],
    )
  ).rows[0].id as string;
  // An Enterprise customer in good standing (billing state kept consistent with the plan).
  await pool.query(
    `UPDATE accounts SET name = 'Skyharbor Air', plan_tier = 'enterprise', motion = 'sales_assisted', billing_status = 'active', current_period_start = now(), current_period_end = now() + interval '1 year', trial_end_at = NULL WHERE id = $1`,
    [acct],
  );
  await pool.query(`UPDATE workspaces SET name = 'Skyharbor Air' WHERE slug = $1`, [slug]);
  const queryId = (
    await pool.query(
      `SELECT q.id FROM queries q JOIN workspaces w ON w.id = q.workspace_id WHERE w.slug = $1`,
      [slug],
    )
  ).rows[0].id as string;
  // Onboarding backfilled on the trial's small allowance; redo it with Enterprise's, so the whole crisis is there.
  await pool.query(`DELETE FROM usage_counters WHERE account_id = $1`, [acct]);
  await runBackfill(queryId);

  // A dashboard and a report, built from templates through the UI.
  await page.goto(`/w/${slug}/dashboards`);
  await page.getByTestId("new-dashboard").click();
  await page.getByTestId("template-brand_health").click();
  await page.waitForURL(/dashboards\/([0-9a-f-]{36})\?edit=1/);
  const dashId = new URL(page.url()).pathname.split("/").pop()!;
  await page.goto(`/w/${slug}/reports`);
  await page.getByTestId("empty-new-report").click();
  await page.getByTestId("template-weekly_brand_summary").click();
  await page.waitForURL(/reports\/([0-9a-f-]{36})\?edit=1/);
  const reportId = new URL(page.url()).pathname.split("/").pop()!;

  // A real alert: replay the release cycle through the crisis until the engine fires.
  const ids = (
    await pool.query(
      `SELECT w.id AS ws, u.id AS u FROM workspaces w JOIN users u ON lower(u.email) = $2 WHERE w.slug = $1`,
      [slug, email],
    )
  ).rows[0];
  const rule = (
    await pool.query(
      `INSERT INTO alert_rules (workspace_id, query_id, name, type, params, channels, created_by) VALUES ($1,$2,'Volume spike','volume_spike','{"multiple":3,"minVolume":20}','{in_app,email}',$3) RETURNING id`,
      [ids.ws, queryId, ids.u],
    )
  ).rows[0].id as string;
  const start = new Date(
    (
      await pool.query(
        `SELECT min(m.published_at) AS s FROM mentions m JOIN query_matches qm ON qm.mention_id = m.id WHERE qm.query_id = $1 AND m.crisis_id = $2`,
        [queryId, CRISIS_ID],
      )
    ).rows[0].s,
  );
  for (let t = start.getTime(); t < start.getTime() + 24 * 3_600_000; t += 5 * 60_000)
    if ((await evaluateAlerts(queryId, new Date(t))).length) break;
  const eventId = (
    await pool.query(`SELECT id FROM alert_events WHERE rule_id = $1 ORDER BY fired_at LIMIT 1`, [
      rule,
    ])
  ).rows[0]?.id as string;
  expect(eventId, "the crisis should trip the spike alert").toBeTruthy();
  await page.goto(`/w/${slug}/alerts/events/${eventId}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("start-crisis").click();
  await page.waitForURL(/crisis\/([0-9a-f-]{36})/);
  const crisisId = new URL(page.url()).pathname.split("/").pop()!;

  // An Ask AI answer, so the page has something to show.
  await page.goto(`/w/${slug}/ask`);
  await expect(page.getByTestId("ask-input")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await page.getByTestId("ask-input").fill("What are people complaining about this week?");
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("ask-result").getByTestId("ai-answer")).toBeVisible({
    timeout: 30_000,
  });

  // The overnight scoring job, run once so Usage has a health panel to show.
  await runNightlyScoring(new Date(), [acct]);

  const shots: Shot[] = [
    {
      n: "03",
      name: "home",
      path: `/w/${slug}/home`,
      ready: async (p) => {
        await expect(p.getByTestId("checklist")).toBeVisible({ timeout: 30_000 });
        await widgetsLoaded(p);
      },
    },
    {
      n: "04",
      name: "mentions",
      path: `/w/${slug}/mentions`,
      ready: async (p) => {
        await p.waitForSelector('[data-testid="mentions-feed"][data-hydrated="true"]', {
          timeout: 45_000,
        });
        await expect(p.getByTestId("mention-card").first()).toBeVisible({ timeout: 45_000 });
        await settled(p);
      },
    },
    {
      n: "05",
      name: "dashboard",
      path: `/w/${slug}/dashboards/${dashId}`,
      ready: widgetsLoaded,
      full: 1900,
    },
    {
      n: "06",
      name: "alert",
      path: `/w/${slug}/alerts/events/${eventId}`,
      ready: settled,
    },
    {
      n: "07",
      name: "crisis-room",
      path: `/w/${slug}/crisis/${crisisId}`,
      ready: async (p) => {
        await expect(p.getByTestId("room-kpis")).toBeVisible({ timeout: 30_000 });
        await settled(p);
      },
      full: 1900,
    },
    {
      n: "08",
      name: "report",
      path: `/w/${slug}/reports/${reportId}`,
      ready: async (p) => {
        await expect(p.getByTestId("report-section").first()).toBeVisible({ timeout: 45_000 });
        await expect(p.getByTestId("section-loading")).toHaveCount(0, { timeout: 60_000 });
        await settled(p);
      },
      full: 1900,
    },
    {
      n: "09",
      name: "ask-ai",
      path: `/w/${slug}/ask`,
      ready: async (p) => {
        await expect(p.getByTestId("ai-history")).toBeVisible({ timeout: 30_000 });
        await p.getByTestId("ai-history").locator("summary").first().click();
        await expect(p.getByTestId("ai-citations").first()).toBeVisible();
        await settled(p);
      },
    },
    {
      n: "10",
      name: "topics",
      path: `/w/${slug}/topics?range=90d`,
      ready: async (p) => {
        await expect(p.getByTestId("topics-table")).toBeVisible({ timeout: 30_000 });
        await settled(p);
      },
    },
    {
      n: "11",
      name: "authors",
      path: `/w/${slug}/authors?range=90d`,
      ready: async (p) => {
        await expect(p.getByTestId("authors-table")).toBeVisible({ timeout: 30_000 });
        await settled(p);
      },
    },
    {
      n: "12",
      name: "usage",
      path: `/settings/usage`,
      ready: async (p) => {
        await expect(p.getByTestId("meters")).toBeVisible({ timeout: 30_000 });
        await settled(p);
      },
    },
    {
      n: "13",
      name: "audit-log",
      path: `/settings/audit`,
      ready: async (p) => {
        await expect(p.getByTestId("audit-filters")).toBeVisible({ timeout: 30_000 });
        await settled(p);
      },
    },
  ];
  for (const s of shots) await shoot(page, s);
  console.log(
    `CONSOLE ERRORS (${consoleErrors.length})\n${[...new Set(consoleErrors)].join("\n")}`,
  );
});
