import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createUser, pool } from "./helpers";

test.setTimeout(120_000);

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
const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows.map((r) => r.props as Record<string, unknown>);
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

test("authors: ranked list, profile, watchlist, and the drill-down to Mentions", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Orbit Lace", prefix: "auth" });
  await queryReady(slug);
  await page.goto(`/w/${slug}/authors?range=90d`);
  await expect(page.getByTestId("authors-table")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  expect(await page.getByTestId("author-row").count()).toBeGreaterThan(0);
  await scan(page);

  // Watch the first author from the list; it sticks across a reload and powers the filter.
  const first = page.getByTestId("author-row").first();
  const name = (await first.getByTestId("author-link").textContent())!;
  await first.getByTestId("watch-toggle").click();
  await expect(first.getByTestId("watch-toggle")).toHaveText(/Watching/);
  await expect.poll(async () => (await events(email, "Author Watchlisted")).length).toBe(1);
  await page.goto(`/w/${slug}/authors?range=90d&watch=1`);
  await expect(page.getByTestId("author-row")).toHaveCount(1);
  await expect(page.getByTestId("author-link")).toHaveText(name);

  // Profile.
  await page.getByTestId("author-link").click();
  await page.waitForURL(/\/authors\/\d+/);
  await expect(page.getByTestId("author-name")).toHaveText(name);
  await expect(page.getByTestId("watch-toggle")).toHaveText(/Watching/);
  await expect(page.getByTestId("author-kpis")).toBeVisible();
  await expect.poll(async () => (await events(email, "Author Profile Viewed")).length).toBe(1);
  expect((await events(email, "Author Profile Viewed"))[0]).toHaveProperty("author_type");
  await scan(page);

  // Unwatch, then the watchlist-only view explains itself.
  await page.getByTestId("watch-toggle").click();
  await expect(page.getByTestId("watch-toggle")).toHaveText(/^Watch/);
  await page.goto(`/w/${slug}/authors?range=90d&watch=1`);
  await expect(page.getByTestId("authors-empty")).toContainText("No watched authors");

  // Mentions count links into the feed filtered to that author.
  await page.goto(`/w/${slug}/authors?range=90d`);
  await page.getByTestId("author-row").first().locator('a[href*="author="]').click();
  await page.waitForURL(/mentions\?.*author=/);

  // An unknown author is a 404, not a crash.
  await page.goto(`/w/${slug}/authors/999999999`);
  await expect(page.getByText("This page could not be found")).toBeVisible();
});

test("topics: ranked with change vs the previous period, and a topic opens the feed", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Orbit Lace", prefix: "top" });
  await queryReady(slug);
  await page.goto(`/w/${slug}/topics?range=90d`);
  await expect(page.getByTestId("topics-table")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  expect(await page.getByTestId("topic-row").count()).toBeGreaterThan(0);
  await expect(page.getByTestId("topic-change").first()).toHaveText(/New|No change|up|down/);
  await scan(page);
  const topic = (await page.getByTestId("topic-link").first().textContent())!;
  await page.getByTestId("topic-link").first().click();
  await page.waitForURL(/mentions\?.*topic=/);
  expect(decodeURIComponent(page.url())).toContain(`topic=${topic}`);
  await expect.poll(async () => (await events(email, "Topic Opened")).length).toBe(1);
  expect((await events(email, "Topic Opened"))[0]).toHaveProperty("topic_growth_pct");
});

test("no queries: both pages point to creating one", async ({ page }) => {
  const { slug } = await createUser(page, { brand: "Orbit Lace", prefix: "none" });
  await pool.query(
    `DELETE FROM queries WHERE workspace_id = (SELECT id FROM workspaces WHERE slug = $1)`,
    [slug],
  );
  await page.goto(`/w/${slug}/authors`);
  await expect(page.getByTestId("authors-no-queries")).toBeVisible({ timeout: 30_000 });
  await page.goto(`/w/${slug}/topics`);
  await expect(page.getByTestId("topics-no-queries")).toBeVisible();
  await scan(page);
});
