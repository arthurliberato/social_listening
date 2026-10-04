import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createUser, pool } from "./helpers";

test.setTimeout(120_000);

const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows.map((r) => r.props as Record<string, unknown>);
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
async function setUsed(slug: string, n: number) {
  await pool.query(
    `INSERT INTO usage_counters (account_id, period, metric, value)
     SELECT w.account_id, to_char(now(), 'YYYY-MM'), 'ai_questions', $2 FROM workspaces w WHERE w.slug = $1
     ON CONFLICT (account_id, period, metric) DO UPDATE SET value = $2`,
    [slug, n],
  );
}
const goAsk = async (page: Page, slug: string) => {
  await page.goto(`/w/${slug}/ask`);
  await expect(page.getByTestId("ask-input")).toBeVisible({ timeout: 30_000 });
  // The form is server-rendered; typing before hydration would be lost.
  await page.waitForLoadState("networkidle");
};
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

test("ask a question: a cited answer, a quota that goes down, a history that stays", async ({
  page,
  context,
}) => {
  const { email, slug } = await createUser(page, { brand: "Orbit Lace", prefix: "ai" });
  await queryReady(slug);
  await goAsk(page, slug);
  await expect(page.getByTestId("ai-history-empty")).toBeVisible();
  await expect(page.getByTestId("ai-quota")).toHaveAttribute("data-remaining", "10");
  await expect(page.getByTestId("ask-submit")).toBeDisabled();

  await page.getByTestId("ask-input").fill("What are people saying lately?");
  await page.getByTestId("ask-submit").click();
  const answer = page.getByTestId("ask-result").getByTestId("ai-answer");
  await expect(answer).toBeVisible({ timeout: 30_000 });
  expect(await answer.getByTestId("ai-citations").locator("li").count()).toBeGreaterThanOrEqual(3);
  await expect(answer.getByTestId("ai-simulated-note")).toBeVisible();
  await expect(page.getByTestId("ai-quota")).toHaveAttribute("data-remaining", "9");
  await expect(page.getByTestId("ai-quota-text")).toContainText("9 of 10 left");

  await expect.poll(async () => (await events(email, "Ask AI Question Submitted")).length).toBe(1);
  expect((await events(email, "Ask AI Question Submitted"))[0]).toMatchObject({
    question_length: 30,
    ai_quota_remaining: 9,
  });

  // A citation opens the actual mention, in a new tab so the answer stays put.
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    answer.getByTestId("ai-inline-cite").first().click(),
  ]);
  expect(popup.url()).toMatch(/\/mentions\?m=\d+/);
  await popup.close();
  await expect.poll(async () => (await events(email, "Ask AI Citation Opened")).length).toBe(1);

  await scan(page);

  // It's in the workspace history after a reload, with the same citations.
  await goAsk(page, slug);
  await expect(page.getByTestId("ai-history").locator(":scope > li")).toHaveCount(1);
  await expect(page.getByTestId("ai-quota")).toHaveAttribute("data-remaining", "9");
});

test("at the limit: a paywall that can be dismissed, and nothing is counted past it", async ({
  page,
}) => {
  const { slug } = await createUser(page, { brand: "Orbit Lace", prefix: "aiq" });
  await queryReady(slug);
  await setUsed(slug, 10);
  await goAsk(page, slug);
  await expect(page.getByTestId("ai-quota")).toHaveAttribute("data-remaining", "0");
  await page.getByTestId("ask-input").fill("What are people saying?");
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("paywall-modal")).toContainText("AI questions");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("paywall-modal")).toBeHidden();
  await expect(page.getByTestId("ai-error")).toContainText("used this month");
  const { rows } = await pool.query(
    `SELECT value FROM usage_counters u JOIN workspaces w ON w.account_id = u.account_id WHERE w.slug = $1 AND metric = 'ai_questions'`,
    [slug],
  );
  expect(Number(rows[0].value)).toBe(10);
  // The Usage page agrees.
  await page.goto("/settings/usage");
  await expect(page.getByTestId("meter-ai")).toHaveAttribute("data-pct", "100");
});

test("a workspace with no queries explains what to do first", async ({ page }) => {
  const { slug } = await createUser(page, { brand: "Orbit Lace", prefix: "aie" });
  await pool.query(
    `DELETE FROM queries WHERE workspace_id = (SELECT id FROM workspaces WHERE slug = $1)`,
    [slug],
  );
  await page.goto(`/w/${slug}/ask`);
  await expect(page.getByTestId("ask-empty")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("ai-blocked")).toContainText("Create a query first");
  await expect(page.getByTestId("ask-submit")).toBeDisabled();
});

test("the query writer drafts Boolean you can review, and the crisis room explains its peak", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane", prefix: "aiw" });
  await queryReady(slug);
  await setPlan(email, "growth");

  // Query writer inside the builder.
  await page.goto(`/w/${slug}/queries/new`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("qw-input").fill('"battery life" and charging, but not refunds');
  await page.getByTestId("qw-submit").click();
  await expect(page.getByTestId("qw-note")).toContainText("Review it in the Advanced editor", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("advanced-editor-content")).toContainText("battery life");
  await expect(page.getByTestId("advanced-editor-content")).toContainText("NOT");
  await expect.poll(async () => (await events(email, "AI Query Generated")).length).toBe(1);

  // Crisis room: seed the room directly over a week of the query's data (the alert flow is covered elsewhere).
  await pool.query(
    `INSERT INTO crises (workspace_id, query_id, title, window_start, opened_by)
     SELECT q.workspace_id, q.id, 'Latte Lane: test room', q.released_through - interval '6 days', q.created_by
     FROM queries q JOIN workspaces w ON w.id = q.workspace_id WHERE w.slug = $1 LIMIT 1`,
    [slug],
  );
  const id = (
    await pool.query(
      `SELECT c.id FROM crises c JOIN workspaces w ON w.id = c.workspace_id WHERE w.slug = $1`,
      [slug],
    )
  ).rows[0].id;
  await page.goto(`/w/${slug}/crisis/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("ai-peak").click();
  const result = page.getByTestId("crisis-ai").getByTestId("ai-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toHaveAttribute("data-kind", "peak");
  expect(await result.getByTestId("ai-citations").locator("li").count()).toBeGreaterThanOrEqual(3);
  await page.getByTestId("ai-summarize").click();
  await expect(result).toHaveAttribute("data-kind", "summary", { timeout: 30_000 });
  // Query writer (1) + peak (1) + summary (1) = 3 used of 100 on Growth.
  await expect(page.getByTestId("ai-left")).toContainText("97 AI questions left");
  await expect.poll(async () => (await events(email, "AI Summary Generated")).length).toBe(2);
  expect((await events(email, "AI Summary Generated")).map((e) => e.surface)).toEqual([
    "peak_explanation",
    "crisis_room",
  ]);
  await scan(page);
});
