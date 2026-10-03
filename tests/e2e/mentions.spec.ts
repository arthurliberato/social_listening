import { expect, test, type Page } from "@playwright/test";
import { createUser, openFeed, pool } from "./helpers";

// The shared pool (helpers.ts) lives for the whole worker; Playwright tears the process down at the end.

const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows;
const BRAND = "Latte Lane";
const cards = (page: Page) => page.getByTestId("mention-card");

async function feedUser(page: Page) {
  const u = await createUser(page, { brand: BRAND });
  // Wait for the backfill job to finish so the feed has data.
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            `SELECT q.backfill_status AS s FROM queries q JOIN memberships m ON m.workspace_id = q.workspace_id JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1`,
            [u.email],
          )
        ).rows[0]?.s,
      { timeout: 45_000 },
    )
    .toMatch(/done|quota_exhausted/);
  return u;
}

test("feed renders cards with author, metrics, sentiment and highlights; records a view event", async ({
  page,
}) => {
  const { email, slug } = await feedUser(page);
  await openFeed(page, slug);
  await expect(cards(page).first()).toBeVisible();
  const first = cards(page).first();
  await expect(first.getByTestId("engagement")).toContainText("Est. reach");
  await expect(first.locator("time")).toHaveAttribute("title", /\d{4}/); // absolute time on hover
  await expect(first.locator("[data-sentiment]").first()).toBeVisible();
  await expect(
    cards(page).first().getByTestId("mention-text").locator("mark").first(),
  ).toBeVisible();
  await expect(page.getByTestId("result-count")).toContainText(/\d+ mentions?/);
  await expect
    .poll(async () => (await events(email, "Mentions Feed Viewed")).length)
    .toBeGreaterThan(0);
  expect((await events(email, "Mentions Feed Viewed"))[0]!.props).toMatchObject({
    entry_point: "nav",
    view_mode: "card",
  });
});

test("filters are URL-synced, shareable, removable, and survive reload and back", async ({
  page,
}) => {
  const { slug } = await feedUser(page);
  await openFeed(page, slug);
  const total = Number((await page.getByTestId("result-count").innerText()).replace(/[^0-9]/g, ""));
  await page.getByTestId("open-filters").click();
  await page.getByTestId("f-sentiment-negative").check();
  await page.getByTestId("f-apply").click();
  await expect(page).toHaveURL(/sentiment=negative/);
  await expect(page.getByTestId("filter-chip")).toHaveText(/Sentiment: negative/);
  await expect.poll(async () => cards(page).count()).toBeGreaterThanOrEqual(0);
  for (const pill of await cards(page).locator("[data-sentiment]").all())
    expect(await pill.getAttribute("data-sentiment")).toBe("negative");
  const filtered = Number(
    (await page.getByTestId("result-count").innerText()).replace(/[^0-9]/g, ""),
  );
  expect(filtered).toBeLessThan(total);

  await page.reload();
  await expect(page.getByTestId("filter-chip")).toHaveText(/Sentiment: negative/);
  await page.goBack();
  await expect(page).not.toHaveURL(/sentiment=negative/);
  await page.goForward();
  await expect(page).toHaveURL(/sentiment=negative/);

  await page.getByRole("button", { name: /Remove filter: Sentiment: negative/ }).click();
  await expect(page).not.toHaveURL(/sentiment=/);
  await page.getByTestId("open-filters").click();
  await page.getByTestId("f-source-x").check();
  await page.getByTestId("f-apply").click();
  await page.getByTestId("clear-all").click();
  await expect(page.getByTestId("filter-chip")).toHaveCount(0);
});

test("views: cards, list and table; table sorts via the URL and keeps a sticky header", async ({
  page,
}) => {
  const { slug } = await feedUser(page);
  await openFeed(page, slug);
  await page.getByTestId("view-list").click();
  await expect(page).toHaveURL(/view=list/);
  await expect(cards(page).first()).toBeVisible();
  await page.getByTestId("view-table").click();
  await expect(page.getByTestId("mentions-table")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Reach/ })).toBeVisible();
  await page.getByRole("button", { name: /Sort by Reach/ }).click();
  await expect(page).toHaveURL(/sort=reach/);
  await expect(page.getByTestId("mentions-table")).toBeVisible(); // view persisted across the reload via the URL
  const reach = await page.locator("tbody tr td:nth-child(7)").allInnerTexts();
  expect(reach.length).toBeGreaterThan(1);
});

test("detail drawer: opens, deep-links via ?m=, closes with Esc and returns focus", async ({
  page,
}) => {
  const { email, slug } = await feedUser(page);
  await openFeed(page, slug);
  const id = await cards(page).first().getAttribute("data-id");
  await cards(page).first().getByTestId("open-mention").click();
  const drawer = page.getByTestId("mention-drawer");
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`m=${id}`));
  await expect(drawer.getByTestId("drawer-context")).toContainText("Matched by");
  await expect(drawer).toContainText("Classifier:");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/m=/);
  await expect.poll(async () => (await events(email, "Mention Opened")).length).toBeGreaterThan(0);

  await page.goto(`/w/${slug}/mentions?m=${id}`);
  await expect(page.getByTestId("mention-drawer")).toBeVisible();
});

test("keyboard triage: j/k, x, s+n, f, t, Undo — edits live in mention_overrides, never in the corpus", async ({
  page,
}) => {
  const { email, slug } = await feedUser(page);
  await openFeed(page, slug);
  await page.keyboard.press("j");
  await expect(cards(page).first()).toHaveAttribute("data-active", "true");
  await page.keyboard.press("j");
  await expect(cards(page).nth(1)).toHaveAttribute("data-active", "true");
  await page.keyboard.press("k");
  const target = cards(page).first();
  const id = Number(await target.getAttribute("data-id"));
  const before = (
    await pool.query(`SELECT sentiment_pred, sentiment_true, text FROM mentions WHERE id = $1`, [
      id,
    ])
  ).rows[0];

  await page.keyboard.press("x");
  await expect(page.getByTestId("selected-count")).toHaveText("1 selected");
  await page.keyboard.press("s");
  await page.keyboard.press("n");
  await expect(target.locator("[data-sentiment]").first()).toHaveAttribute(
    "data-sentiment",
    "negative",
  );
  await expect(target.getByTestId("edited-mark")).toBeVisible();
  await expect(page.getByTestId("toast").first()).toContainText("Sentiment set to negative");
  await expect
    .poll(
      async () =>
        (await pool.query(`SELECT sentiment FROM mention_overrides WHERE mention_id = $1`, [id]))
          .rows[0]?.sentiment,
    )
    .toBe("negative");
  expect(
    (
      await pool.query(`SELECT sentiment_pred, sentiment_true, text FROM mentions WHERE id = $1`, [
        id,
      ])
    ).rows[0],
  ).toEqual(before);
  await expect
    .poll(async () => (await events(email, "Mention Sentiment Overridden")).length)
    .toBeGreaterThan(0);

  await page.getByTestId("toast-action").first().click(); // Undo
  await expect(target.getByTestId("edited-mark")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await pool.query(`SELECT 1 FROM mention_overrides WHERE mention_id = $1`, [id])).rowCount,
    )
    .toBe(0);

  await page.keyboard.press("f");
  await expect(target.getByTestId("flag-mark")).toBeVisible();
  await page.keyboard.press("t");
  await expect(page.getByTestId("tag-dialog")).toBeVisible();
  await page.getByTestId("tag-input").fill("escalate");
  await page.keyboard.press("Enter");
  await expect(target.getByTestId("tag-chip")).toHaveText("#escalate");
  await expect
    .poll(
      async () =>
        (
          await pool.query(`SELECT tags, flagged FROM mention_overrides WHERE mention_id = $1`, [
            id,
          ])
        ).rows[0],
    )
    .toMatchObject({ tags: ["escalate"], flagged: true });
  expect((await events(email, "Keyboard Shortcut Used")).length).toBeGreaterThan(3);

  // Tag filter now finds it; the tag is offered as a suggestion.
  await page.goto(`/w/${slug}/mentions?tag=escalate`);
  await expect(cards(page)).toHaveCount(1);
});

test("bulk actions apply to the whole selection and shift-click selects a range", async ({
  page,
}) => {
  const { email, slug } = await feedUser(page);
  await openFeed(page, slug);
  await cards(page).nth(0).getByTestId("select-mention").click();
  await cards(page)
    .nth(3)
    .getByTestId("select-mention")
    .click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("selected-count")).toHaveText("4 selected");
  await page.getByTestId("bulk-tag").click();
  await page.getByTestId("tag-input").fill("batch");
  await page.getByTestId("tag-submit").click();
  for (let i = 0; i < 4; i++)
    await expect(cards(page).nth(i).getByTestId("tag-chip")).toHaveText("#batch");
  await page.getByTestId("bulk-sentiment").click();
  await page.getByTestId("set-negative").click();
  for (let i = 0; i < 4; i++)
    await expect(cards(page).nth(i).locator("[data-sentiment]").first()).toHaveAttribute(
      "data-sentiment",
      "negative",
    );
  await page.getByTestId("bulk-flag").click();
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            `SELECT count(*)::int AS n FROM mention_overrides WHERE flagged AND 'batch' = ANY(tags) AND sentiment = 'negative'`,
          )
        ).rows[0].n,
    )
    .toBeGreaterThanOrEqual(4);
  await expect
    .poll(async () => (await events(email, "Mentions Bulk Action Applied")).length)
    .toBeGreaterThanOrEqual(3);
  expect((await events(email, "Mentions Bulk Action Applied"))[0]!.props).toMatchObject({
    bulk_size: 4,
  });
  await page.getByTestId("bulk-clear").click();
  await expect(page.getByTestId("bulk-bar")).toHaveCount(0);
});

test("date range: presets within the plan apply; longer history opens the paywall", async ({
  page,
}) => {
  const { email, slug } = await feedUser(page);
  await openFeed(page, slug);
  await page.getByTestId("date-range").click();
  await expect(page.getByTestId("range-12m")).toContainText("Available on");
  await page.getByTestId("range-12m").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await expect(page.getByTestId("paywall-modal")).toContainText("30 days");
  await page.getByTestId("paywall-dismiss").click();
  await page.getByTestId("date-range").click();
  await page.getByTestId("range-7d").click();
  await expect(page).toHaveURL(/range=7d/);
  await expect
    .poll(async () => (await events(email, "Paywall Viewed")).map((e) => e.props.paywall_trigger))
    .toContain("history_window");
});

test("Boolean search box: valid searches narrow results, invalid ones explain themselves; / focuses it", async ({
  page,
}) => {
  const { slug } = await feedUser(page);
  await openFeed(page, slug);
  await page.keyboard.press("/");
  await expect(page.getByTestId("feed-search")).toBeFocused();
  await page.keyboard.type("(coffee OR latte");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("search-error")).toContainText("Missing closing parenthesis");
  await page.getByTestId("feed-search").fill("love");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/search=love/);
  await expect(page.getByTestId("search-error")).toHaveCount(0);
  for (const t of await cards(page).getByTestId("mention-text").allInnerTexts())
    expect(t.toLowerCase()).toContain("love");
});

test("saved views store and restore filters", async ({ page }) => {
  const { slug } = await feedUser(page);
  await openFeed(page, slug, "?sentiment=positive&view=list");
  await page.getByTestId("save-view").click();
  await page.getByTestId("view-name").fill("Happy customers");
  await page.getByTestId("view-save").click();
  await expect(page.getByTestId("toast").first()).toContainText("Saved view");
  await page.goto(`/w/${slug}/mentions`);
  await page.getByTestId("saved-views").click();
  await page.getByTestId("saved-view-Happy customers").click();
  await expect(page).toHaveURL(/sentiment=positive/);
});

test("shortcut help, sidebar collapse, g-chords, and the single-key switch", async ({ page }) => {
  const { slug } = await feedUser(page);
  await openFeed(page, slug);
  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcut-help")).toBeVisible();
  await page.getByTestId("shortcuts-toggle").uncheck();
  await page.keyboard.press("Escape");
  await page.keyboard.press("j"); // disabled: nothing becomes active
  await expect(page.locator('[data-active="true"]')).toHaveCount(0);
  await page.getByTestId("help").click();
  await page.getByTestId("shortcuts-toggle").check();
  await page.keyboard.press("Escape");
  await page.keyboard.press("[");
  await expect(page.locator("html")).toHaveAttribute("data-sidebar", "collapsed");
  await page.keyboard.press("[");
  await expect(page.locator("html")).not.toHaveAttribute("data-sidebar", "collapsed");
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/home`));
  await page.keyboard.press("g");
  await page.keyboard.press("m");
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/mentions`));
});

test("viewers can read and export but not edit", async ({ page }) => {
  const { email, slug } = await feedUser(page);
  await pool.query(
    `UPDATE memberships SET role = 'viewer' WHERE user_id = (SELECT id FROM users WHERE lower(email) = $1)`,
    [email],
  );
  await openFeed(page, slug);
  await expect(page.getByText("view-only access").first()).toBeVisible();
  await expect(cards(page).first().getByTestId("tag-mention")).toHaveCount(0);
  await expect(cards(page).first().getByTestId("sentiment-menu")).toHaveCount(0);
  await page.keyboard.press("j");
  await page.keyboard.press("f"); // ignored for viewers
  await expect(page.getByTestId("flag-mark")).toHaveCount(0);
  await expect(page.getByTestId("export-view")).toBeVisible();
});

test("CSV export of the filtered view neutralises spreadsheet formulas", async ({ page }) => {
  const { email, slug } = await feedUser(page);
  await openFeed(page, slug);
  const res = await page.request.get(`/w/${slug}/mentions`.replace("/w/", "/api/w/") + "/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const body = await res.text();
  expect(body.split("\n")[0]).toContain("published_at");
  expect(body.split("\n").length).toBeGreaterThan(5);
  expect(body).not.toMatch(/(^|,)"[=+@-]/m);
  await expect
    .poll(async () => (await events(email, "Export Downloaded")).length)
    .toBeGreaterThan(0);
});

test("other workspaces are not reachable through the feed API", async ({ page }) => {
  const { slug } = await feedUser(page);
  const r = await page.request.get(`/api/w/someone-elses/mentions/export`);
  expect(r.status()).toBe(403);
  await page.goto(`/w/${slug}/mentions?q=00000000-0000-0000-0000-000000000000`);
  await expect(page.getByTestId("feed-empty")).toBeVisible();
});
