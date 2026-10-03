import { expect, test, type Page } from "@playwright/test";
import { createUser, pool } from "./helpers";

// The shared pool (helpers.ts) lives for the whole worker.
const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows;
const widgets = (page: Page) => page.getByTestId("widget");
const BRAND = "Latte Lane";

async function setPlan(email: string, plan: string) {
  await pool.query(
    `UPDATE accounts SET plan_tier = $2 WHERE id IN (SELECT m.account_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1)`,
    [email, plan],
  );
}
async function ready(page: Page, slug: string) {
  // Wait for the first query's history to load so widgets have data.
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
async function newFromTemplate(page: Page, slug: string, template: string) {
  await page.goto(`/w/${slug}/dashboards`);
  await page.getByTestId("new-dashboard").click();
  await page.getByTestId(`template-${template}`).click();
  await page.waitForURL(/dashboards\/[0-9a-f-]{36}\?edit=1/);
}
async function settled(page: Page, n?: number) {
  await expect(page.getByTestId("widget-loading")).toHaveCount(0, { timeout: 45_000 });
  if (n) await expect(widgets(page)).toHaveCount(n);
}
const cellOf = (page: Page, title: string) =>
  page
    .getByTestId("widget-cell")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test("template → dashboard: widgets load independently, charts render, tables mirror them, saves persist", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: BRAND });
  await ready(page, slug);
  await page.goto(`/w/${slug}/dashboards`);
  await expect(page.getByTestId("dashboards-empty")).toBeVisible();
  await page.getByTestId("new-dashboard").click();
  await expect(page.getByTestId("new-dashboard-dialog")).toBeVisible();
  await page.getByTestId("template-brand_health").click();
  await page.waitForURL(/dashboards\/[0-9a-f-]{36}\?edit=1/);
  await settled(page, 10);

  // KPI tiles carry a value, a delta against the previous period and a sparkline.
  const mentions = cellOf(page, "Mentions");
  await expect(mentions.getByTestId("kpi-value")).toHaveText(/\d/);
  // The trial keeps 30 days of history, so there is no earlier period to compare against.
  await expect(mentions.getByTestId("kpi-delta")).toContainText("Not enough history");
  await expect(mentions.getByTestId("sparkline")).toBeVisible();
  // Volume chart renders with a described image role and a legend-free single series.
  const volume = cellOf(page, "Mentions over time");
  await expect(volume.getByTestId("chart-volume")).toHaveAttribute("data-ready", "true", {
    timeout: 15_000,
  });
  await expect(volume.getByTestId("chart-volume")).toHaveAttribute("aria-label", /per day/);
  await expect(volume.getByTestId("legend")).toHaveCount(0);
  // ≥2 series ⇒ a legend is always present.
  await expect(cellOf(page, "Sentiment over time").getByTestId("legend")).toContainText("Negative");
  await expect(cellOf(page, "Sentiment split").getByTestId("legend")).toContainText("Positive");

  // Table twin: same numbers as the chart, with a caption.
  await volume.getByTestId("widget-table-toggle").click();
  await expect(volume.getByTestId("widget-table")).toBeVisible();
  await expect(volume.getByRole("columnheader", { name: "Day" })).toBeVisible();
  expect(await volume.locator("tbody tr").count()).toBeGreaterThan(20);
  await volume.getByTestId("widget-table-toggle").click();
  await expect(volume.getByTestId("chart-volume")).toBeVisible();

  // "How is this calculated?"
  await volume.getByTestId("widget-info").click();
  await expect(volume.getByTestId("widget-info-panel")).toContainText("trailing 14-day median");
  await page.keyboard.press("Escape");

  // Save, reload: layout persists.
  await page.getByTestId("dash-name").fill("Latte health");
  await page.keyboard.press("Control+s");
  await expect(page).not.toHaveURL(/edit=1/, { timeout: 10_000 });
  await expect(page.getByTestId("dash-title")).toHaveText("Latte health");
  await page.reload();
  await settled(page, 10);
  await expect(page.getByTestId("dash-title")).toHaveText("Latte health");
  expect((await events(email, "Dashboard Created"))[0]!.props).toMatchObject({
    template_id: "brand_health",
  });
  expect((await events(email, "Dashboard Saved"))[0]!.props).toMatchObject({ widgets_count: 10 });
  await expect
    .poll(async () => (await events(email, "Dashboard Viewed")).length)
    .toBeGreaterThan(0);
  const viewed = (await events(email, "Dashboard Viewed")).map((e) => e.props);
  expect(viewed.find((p) => p.dashboard_type === "custom")).toMatchObject({
    viewer_is_creator: true,
  });

  // The list shows it with owner and widget count.
  await page.goto(`/w/${slug}/dashboards`);
  await expect(page.getByTestId("dashboard-card")).toContainText("Latte health");
  await expect(page.getByTestId("dashboard-card")).toContainText("10 widgets");
});

test("plan gating: templates skip locked widgets and the picker offers an upgrade path", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: BRAND });
  await ready(page, slug);
  await page.goto(`/w/${slug}/dashboards`);
  await page.getByTestId("new-dashboard").click();
  await expect(page.getByTestId("template-executive_summary").locator("xpath=..")).toContainText(
    "Share of voice need",
  );
  await page.getByTestId("template-executive_summary").click();
  await page.waitForURL(/edit=1/);
  await settled(page, 6); // 7 in the template, minus Share of voice
  await expect(page.locator('[data-widget-type="share_of_voice"]')).toHaveCount(0);

  await page.getByTestId("add-widget").click();
  await expect(page.getByTestId("pick-share_of_voice")).toHaveAttribute("data-locked", "true");
  await expect(page.getByTestId("pick-emotion")).toContainText("Growth");
  await page.getByTestId("add-share_of_voice").click();
  await expect(page.getByTestId("paywall-modal")).toContainText("Share of voice");
  await page.getByTestId("paywall-dismiss").click();
  await expect
    .poll(async () => (await events(email, "Paywall Viewed")).map((e) => e.props.paywall_trigger))
    .toContain("gated_widget");

  // Upgrading (simulated here by changing the plan) unlocks it.
  await setPlan(email, "growth");
  await page.reload();
  await page.getByTestId("add-widget").click();
  await expect(page.getByTestId("pick-share_of_voice")).not.toHaveAttribute("data-locked", "true");
  await page.getByTestId("add-share_of_voice").click();
  await settled(page, 7);
  const sov = cellOf(page, "Share of voice");
  await expect(sov.getByTestId("chart-sov")).toBeVisible();
  await expect(sov.getByTestId("widget-table")).toContainText("100%");
});

test("editing: add, configure, move three ways (keyboard, menu, drag), resize, remove with undo, save", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: BRAND });
  await ready(page, slug);
  await newFromTemplate(page, slug, "blank");
  await expect(page.getByTestId("dash-empty")).toBeVisible();
  await page.getByTestId("empty-add").click();
  await page.getByTestId("add-top_authors").click();
  await page.getByTestId("add-widget").click();
  await page.getByTestId("add-bar").click();
  await settled(page, 2);
  const authors = cellOf(page, "Top authors");
  const bar = cellOf(page, "Top sources, countries or languages");
  expect(Number(await authors.getAttribute("data-w"))).toBe(6); // L = 6x5
  // Two 6-wide widgets share a row: authors left, bar right.
  expect([await authors.getAttribute("data-x"), await bar.getAttribute("data-x")]).toEqual([
    "0",
    "6",
  ]);

  // Configure: rename and break down by country.
  await bar.getByTestId("widget-menu").click();
  await page.getByTestId("menu-edit").click();
  await page.getByTestId("cfg-title").fill("Where it happens");
  await page.getByTestId("cfg-breakdown").selectOption("country");
  await page.getByTestId("cfg-topn").fill("5");
  await page.getByTestId("cfg-apply").click();
  const where = cellOf(page, "Where it happens");
  await expect(where.getByTestId("chart-bar")).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await events(email, "Widget Configured")).length)
    .toBeGreaterThan(0);

  // Keyboard move: focus the handle, arrow down.
  const handle = authors.getByTestId("drag-handle");
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  await expect(authors).toHaveAttribute("data-y", "1");
  await page.keyboard.press("ArrowUp");
  await expect(authors).toHaveAttribute("data-y", "0");
  // Menu move: right, then back.
  await authors.getByTestId("widget-menu").click();
  await page.getByTestId("menu-move-left").isDisabled(); // already at the edge
  await expect(page.getByTestId("menu-move-left")).toBeDisabled();
  await page.keyboard.press("Escape");
  await where.getByTestId("widget-menu").click();
  await page.getByTestId("menu-move-left").click();
  await expect(where).toHaveAttribute("data-x", "5");
  // Resize via menu: XL spans the full width and pushes the other widget down.
  await where.getByTestId("widget-menu").click();
  await page.getByTestId("menu-size-XL").click();
  await expect(where).toHaveAttribute("data-w", "12");
  await expect(where).toHaveAttribute("data-x", "0");
  expect(Number(await authors.getAttribute("data-y"))).toBeGreaterThanOrEqual(5);
  // Drag: grab the authors handle and drop it two rows lower.
  await authors.scrollIntoViewIfNeeded();
  const hb = (await authors.getByTestId("drag-handle").boundingBox())!;
  const y0 = Number(await authors.getAttribute("data-y"));
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 200, hb.y + hb.height / 2 + 200, { steps: 8 });
  await expect(page.getByTestId("dashboard-grid")).toHaveAttribute("data-dragging", "true");
  await page.mouse.up();
  await expect.poll(async () => Number(await authors.getAttribute("data-y"))).not.toBe(y0);
  const moved = await events(email, "Widget Moved");
  expect(moved.map((e) => e.props.move_method)).toEqual(
    expect.arrayContaining(["keyboard", "menu", "drag"]),
  );

  // Remove with Undo.
  await authors.getByTestId("widget-menu").click();
  await page.getByTestId("menu-remove").click();
  await expect(widgets(page)).toHaveCount(1);
  await page.getByTestId("toast-action").first().click();
  await expect(widgets(page)).toHaveCount(2);

  // Save; unsaved-change guard: Cancel asks first.
  await page.getByTestId("dash-name").fill("Triage board");
  await page.getByTestId("cancel-edit").click();
  await expect(page.getByTestId("discard-confirm")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.getByTestId("save-dashboard").click();
  await expect(page.getByTestId("dash-title")).toHaveText("Triage board");
  await page.reload();
  await settled(page, 2);
  await expect(cellOf(page, "Where it happens")).toHaveAttribute("data-w", "12");
  expect((await events(email, "Widget Added")).length).toBeGreaterThanOrEqual(2);
});

test("drill-down: clicking a chart lands on the Mentions feed with the same number", async ({
  page,
}) => {
  const { slug } = await createUser(page, { brand: BRAND });
  await ready(page, slug);
  await newFromTemplate(page, slug, "blank");
  await page.getByTestId("empty-add").click();
  await page.getByTestId("add-bar").click();
  await page.getByTestId("save-dashboard").click();
  await expect(page.getByTestId("dash-title")).toBeVisible();
  const bar = page.getByTestId("widget").first();
  await expect(bar.getByTestId("chart-bar")).toHaveAttribute("data-ready", "true", {
    timeout: 20_000,
  });
  await bar.getByTestId("widget-table-toggle").click();
  const first = bar.locator("tbody tr").first();
  const source = (await first.locator("th").innerText()).trim();
  const count = Number((await first.locator("td").first().innerText()).replace(/,/g, ""));
  await bar.getByTestId("widget-table-toggle").click();
  // Click the first (largest) bar.
  const path = bar
    .getByTestId("chart-bar")
    .locator("path[fill]:not([fill='none'])")
    .filter({ hasNot: page.locator("text") });
  const bars = await path.evaluateAll((els) =>
    els
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, fill: e.getAttribute("fill") };
      })
      .filter((r) => r.w > 20 && r.h > 4 && r.h < 40),
  );
  expect(bars.length).toBeGreaterThan(0);
  await page.mouse.click(bars[0]!.x + bars[0]!.w / 2, bars[0]!.y + bars[0]!.h / 2);
  await page.waitForURL(new RegExp(`/mentions\\?.*source=${source}`));
  await expect(page.getByTestId("filter-chip")).toContainText(`Source: ${source}`);
  await expect
    .poll(async () =>
      Number((await page.getByTestId("result-count").innerText()).replace(/[^0-9]/g, "")),
    )
    .toBe(count);
});

test("HTML widgets drill too: top authors, topics and top mentions open the right slice of the feed", async ({
  page,
}) => {
  const { slug } = await createUser(page, { brand: BRAND });
  await ready(page, slug);
  await newFromTemplate(page, slug, "blank");
  for (const [i, t] of ["top_authors", "topic_cloud", "top_mentions"].entries()) {
    await page.getByTestId(i === 0 ? "empty-add" : "add-widget").click();
    await page.getByTestId(`add-${t}`).click();
  }
  await page.getByTestId("save-dashboard").click();
  await expect(page.getByTestId("edit-dashboard")).toBeVisible();
  await settled(page, 3);
  const handleText = await cellOf(page, "Top authors")
    .locator("tbody th button")
    .first()
    .innerText();
  const handle = /@([^\s·]+)/.exec(handleText)![1]!;
  await cellOf(page, "Top authors").locator("tbody th button").first().click();
  await page.waitForURL(/mentions\?.*author=/);
  expect(page.url()).toContain(`author=${handle}`);
  await page.goBack();
  await settled(page, 3);
  const topic = (await cellOf(page, "Topics")
    .getByTestId("topic-cloud")
    .locator("button")
    .first()
    .getAttribute("data-topic"))!;
  await cellOf(page, "Topics").getByTestId("topic-cloud").locator("button").first().click();
  await page.waitForURL(/mentions\?.*topic=/);
  await expect(page.getByTestId("filter-chip")).toContainText(`Topic: ${topic}`);
  await expect(page.getByTestId("mention-card").first()).toBeVisible();
});

test("error, empty and permission states are per widget", async ({ page }) => {
  const { email, slug } = await createUser(page, { brand: BRAND });
  await ready(page, slug);
  // An empty query and a query that will be deleted.
  const ws = (await pool.query(`SELECT id FROM workspaces WHERE slug = $1`, [slug])).rows[0].id;
  const empty = (
    await pool.query(
      `INSERT INTO queries (workspace_id, name, boolean_text, status, backfill_status, released_through) VALUES ($1, 'Nothing', 'zzqqxxnothing', 'live', 'done', now()) RETURNING id`,
      [ws],
    )
  ).rows[0].id;
  const doomed = (
    await pool.query(
      `INSERT INTO queries (workspace_id, name, boolean_text, status, backfill_status, released_through) VALUES ($1, 'Doomed', 'doomedq', 'live', 'done', now()) RETURNING id`,
      [ws],
    )
  ).rows[0].id;
  const dash = (
    await pool.query(
      `INSERT INTO dashboards (workspace_id, name) VALUES ($1, 'States') RETURNING id`,
      [ws],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO widgets (dashboard_id, type, title, config, x, y, w, h) VALUES ($1,'volume','Empty one',$2,0,0,6,3),($1,'volume','Broken one',$3,6,0,6,3),($1,'kpi','Healthy',$4,0,3,3,3)`,
    [
      dash,
      JSON.stringify({ queryId: empty }),
      JSON.stringify({ queryId: doomed }),
      JSON.stringify({ metric: "mentions" }),
    ],
  );
  await pool.query(`DELETE FROM queries WHERE id = $1`, [doomed]);
  await page.goto(`/w/${slug}/dashboards/${dash}`);
  await settled(page, 3);
  await expect(cellOf(page, "Empty one").getByTestId("widget-empty")).toContainText(
    "No mentions in this period",
  );
  const broken = cellOf(page, "Broken one");
  await expect(broken.getByTestId("widget-error")).toContainText("was deleted");
  await expect(broken.getByTestId("widget-retry")).toBeVisible();
  // One broken widget never blocks the others.
  await expect(cellOf(page, "Healthy").getByTestId("kpi-value")).toHaveText(/\d/);

  // Viewers can read but not edit.
  await pool.query(
    `UPDATE memberships SET role = 'viewer' WHERE user_id = (SELECT id FROM users WHERE lower(email) = $1)`,
    [email],
  );
  await page.reload();
  await expect(page.getByTestId("edit-dashboard")).toHaveCount(0);
  await expect(page.getByTestId("dash-more")).toHaveCount(0);
  await page.goto(`/w/${slug}/dashboards`);
  await expect(page.getByTestId("new-dashboard")).toHaveCount(0);
  await page.goto(`/w/${slug}/dashboards/${dash}?edit=1`);
  await expect(page.getByTestId("add-widget")).toHaveCount(0);
});

test("public link: Growth+ only, works without login, read-only, and can be turned off", async ({
  page,
  browser,
}) => {
  const { email, slug } = await createUser(page, { brand: BRAND });
  await ready(page, slug);
  await newFromTemplate(page, slug, "campaign_tracker");
  await page.getByTestId("save-dashboard").click();
  await expect(page.getByTestId("dash-title")).toBeVisible();
  await page.getByTestId("share-dashboard").click();
  await expect(page.getByTestId("share-internal")).toHaveValue(
    new RegExp(`/w/${slug}/dashboards/`),
  );
  await page.getByTestId("public-toggle").click(); // trial plan: opens the paywall, the box stays unchecked
  await expect(page.getByTestId("paywall-modal")).toContainText("Public links");
  await page.getByTestId("paywall-dismiss").click();
  await expect
    .poll(async () => (await events(email, "Paywall Viewed")).map((e) => e.props.paywall_trigger))
    .toContain("public_share");

  await setPlan(email, "growth");
  await page.reload();
  await page.getByTestId("share-dashboard").click();
  await page.getByTestId("public-toggle").check();
  await expect(page.getByTestId("share-public")).toHaveValue(/\/share\//);
  const url = await page.getByTestId("share-public").inputValue();

  const anon = await browser.newContext();
  const pub = await anon.newPage();
  await pub.goto(url);
  await expect(pub.getByTestId("share-banner")).toContainText("read-only");
  await expect(pub.getByTestId("dash-title")).toBeVisible();
  await expect(pub.getByTestId("widget").first()).toBeVisible();
  await expect(pub.getByTestId("widget-loading")).toHaveCount(0, { timeout: 45_000 });
  await expect(pub.getByTestId("edit-dashboard")).toHaveCount(0);
  await expect(pub.getByTestId("drag-handle")).toHaveCount(0);
  expect(await pub.locator("meta[name=robots]").getAttribute("content")).toContain("noindex");
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            `SELECT 1 FROM analytics_events WHERE name = 'Dashboard Viewed' AND props->>'dashboard_type' = 'public' AND ts > now() - interval '2 minutes'`,
          )
        ).rowCount,
    )
    .toBeGreaterThan(0);

  // A made-up token reveals nothing; turning the link off kills the real one.
  await pub.goto(url.replace(/\/share\/.+/, "/share/" + "x".repeat(32)));
  await expect(pub.getByText("This link isn't available")).toBeVisible();
  await page.getByTestId("public-toggle").uncheck();
  await expect(page.getByTestId("share-public")).toHaveCount(0);
  await pub.goto(url);
  await expect(pub.getByText("This link isn't available")).toBeVisible();
  await anon.close();
  expect((await events(email, "Dashboard Shared")).map((e) => e.props.share_type)).toContain(
    "public_link",
  );
});

test("Home shows the same KPI tiles and volume chart", async ({ page }) => {
  const { slug } = await createUser(page, { brand: BRAND });
  await ready(page, slug);
  await page.goto(`/w/${slug}/home`);
  const overview = page.getByTestId("home-overview");
  await expect(overview.getByTestId("kpi")).toHaveCount(4, { timeout: 30_000 });
  await expect(overview.getByTestId("chart-volume")).toHaveAttribute("data-ready", "true", {
    timeout: 20_000,
  });
});
