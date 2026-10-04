import { expect, test, type Page } from "@playwright/test";
import { createUser, pool } from "./helpers";

const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows;

async function addChip(page: Page, testId: string, ...values: string[]) {
  for (const v of values) {
    await page.getByTestId(testId).fill(v);
    await page.getByTestId(testId).press("Enter");
  }
}

// The shared pool (helpers.ts) lives for the whole worker; Playwright tears the process down at the end.

test("guided builder: chips compile to Boolean, live preview shows results, ⌘S saves and backfills", async ({
  page,
}) => {
  test.setTimeout(90_000); // signup + onboarding + backfill wait
  const { email, slug } = await createUser(page);
  await page.goto(`/w/${slug}/queries/new?entry=list`);
  await expect(page.getByTestId("preview-panel")).toContainText("Add a term");

  await addChip(page, "guided-any", "Juniper Roast", "#juniperroast");
  await addChip(page, "guided-exclude", "job", "hiring");
  await expect(page.getByTestId("compiled-query")).toHaveText(
    '("Juniper Roast" OR #juniperroast) NOT (job OR hiring)',
  );

  // Debounced preview: count, quota share, noise and highlighted sample mentions.
  await expect(page.getByTestId("preview-count")).not.toHaveText("0", { timeout: 10_000 });
  const count = Number((await page.getByTestId("preview-count").innerText()).replace(/[,+]/g, ""));
  expect(count).toBeGreaterThan(0);
  await expect(page.getByTestId("preview-noise")).toContainText(/Low|Medium|High/);
  await expect(page.getByTestId("preview-mention").first().locator("mark").first()).toBeVisible();
  await page.getByTestId("preview-mention").first().getByText("Why did this match?").click();
  await expect(page.getByTestId("preview-mention").first()).toContainText("Contains");

  // NEAR groups accept words and phrases but not hashtags: drop the chip, then add `within`.
  await page.getByRole("button", { name: "Remove #juniperroast" }).click();
  await addChip(page, "guided-also", "price");
  await page.getByTestId("guided-within").fill("10");
  await expect(page.getByTestId("compiled-query")).toContainText("NEAR/10 price");

  await page.getByTestId("query-name").fill("Juniper pricing");
  await page.keyboard.press("Control+s");
  await page.waitForURL(/\/queries\?saved=/);
  await expect(page.getByTestId("saved-banner")).toBeVisible();
  const row = page.getByTestId("query-row").filter({ hasText: "Juniper pricing" });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("query-backfill")).toHaveText(
    /Up to date|Monthly mention limit reached/,
    { timeout: 30_000 },
  );

  const saved = await events(email, "Query Saved");
  expect(saved.at(-1)!.props).toMatchObject({
    builder_mode: "guided",
    has_near: true,
    exclusion_count: 1,
  });
  expect((await events(email, "Query Builder Opened")).length).toBeGreaterThan(0);
  await expect.poll(async () => (await events(email, "Query Previewed")).length).toBeGreaterThan(0);
  await expect
    .poll(async () => (await events(email, "Query Backfill Completed")).length)
    .toBeGreaterThan(0);
  expect((await events(email, "Keyboard Shortcut Used")).at(-1)!.props).toMatchObject({
    shortcut: "mod+s",
  });
});

test("advanced editor: inline errors, blocked save, mode switching keeps state", async ({
  page,
}) => {
  const { email, slug } = await createUser(page);
  await page.goto(`/w/${slug}/queries/new`);
  await page.getByTestId("mode-advanced").click();
  const editor = page.getByTestId("advanced-editor-content");
  await editor.click();
  await page.keyboard.type("(coffee OR tea");
  await page.keyboard.press("Delete"); // remove the auto-closed ")" so the group stays open
  await expect(page.getByTestId("query-issues")).toContainText(
    "Missing closing parenthesis after 'tea'.",
  );
  await expect(page.getByTestId("preview-panel")).toContainText("Fix the highlighted problems");
  await page.getByTestId("save-query").click();
  await expect(page.getByTestId("save-error")).toContainText("Missing closing parenthesis");
  await expect
    .poll(async () => (await events(email, "Query Validation Failed")).length, { timeout: 5000 })
    .toBeGreaterThan(0);
  expect((await events(email, "Query Validation Failed"))[0]!.props).toMatchObject({
    error_type: "unbalanced_paren",
    builder_mode: "advanced",
  });

  // Fix it: the preview recovers, and the warning explains operator precedence problems.
  await editor.click(); // focus moved to the Save button
  await page.keyboard.press("Control+End");
  await page.keyboard.type(")");
  await expect(page.getByTestId("query-issues")).toHaveCount(0);
  await expect(page.getByTestId("preview-count")).toBeVisible({ timeout: 10_000 });

  // Advanced -> guided: representable queries convert; others warn first.
  await page.getByTestId("mode-guided").click();
  await expect(page.getByTestId("compiled-query")).toHaveText("(coffee OR tea)");
  await page.getByTestId("mode-advanced").click();
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("coffee lang:en");
  await page.getByTestId("mode-guided").click();
  await expect(page.getByTestId("switch-warning")).toBeVisible();
  await page.getByTestId("switch-anyway").click();
  await expect(page.getByTestId("guided-form")).toBeVisible();
});

test("autocomplete suggests operators and fields", async ({ page }) => {
  const { slug } = await createUser(page);
  await page.goto(`/w/${slug}/queries/new`);
  await page.getByTestId("mode-advanced").click();
  await page.getByTestId("advanced-editor-content").click();
  await page.keyboard.type("coffee NE");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("NEAR/5");
});

test("plan limit: paywall at 3/3, pausing frees a slot, delete needs confirmation", async ({
  page,
}) => {
  const { email, slug } = await createUser(page);
  const create = async (name: string, term: string) => {
    await page.goto(`/w/${slug}/queries/new`);
    await page.getByTestId("query-name").fill(name);
    await addChip(page, "guided-any", term);
    await page.getByTestId("save-query").click();
    await page.waitForURL(/queries\?saved=/);
  };
  await create("Second", "Nordcell");
  await create("Third", "Tallyfy");
  await expect(page.getByTestId("query-usage")).toContainText("3 of 3 active queries");

  await page.getByTestId("new-query").click();
  const modal = page.getByTestId("paywall-modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("3 of 3");
  await page.getByTestId("paywall-dismiss").click();
  await expect(modal).toBeHidden();
  await expect.poll(async () => (await events(email, "Paywall Viewed")).length).toBeGreaterThan(0);
  expect((await events(email, "Paywall Viewed"))[0]!.props).toMatchObject({
    paywall_trigger: "query_limit",
  });
  await expect
    .poll(async () => (await events(email, "Paywall Dismissed")).length)
    .toBeGreaterThan(0);

  // Saving a 4th from the builder is also blocked server-side.
  await page.goto(`/w/${slug}/queries/new`);
  await addChip(page, "guided-any", "Rivenar");
  await page.getByTestId("save-query").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("paywall-modal")).toBeHidden();

  await page.goto(`/w/${slug}/queries`);
  const third = page.getByTestId("query-row").filter({ hasText: "Third" });
  await third.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByTestId("query-usage")).toContainText("2 of 3 active queries");
  await expect(third).toHaveAttribute("data-status", "paused");
  expect((await events(email, "Query Paused")).length).toBe(1);

  await third.getByRole("button", { name: /Delete Third/ }).click();
  await third.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("query-row").filter({ hasText: "Third" })).toHaveCount(0);
  expect((await events(email, "Query Deleted")).length).toBe(1);
});

test("viewers can read queries but not change them", async ({ page }) => {
  const { email, slug } = await createUser(page);
  await pool.query(
    `UPDATE memberships SET role = 'viewer' WHERE user_id = (SELECT id FROM users WHERE lower(email) = $1)`,
    [email],
  );
  await page.goto(`/w/${slug}/queries`);
  await expect(page.getByTestId("new-query")).toHaveCount(0);
  await expect(page.getByText("View only").first()).toBeVisible();
  await page.getByTestId("query-row").first().getByRole("link").first().click();
  await expect(page.getByText("view-only access")).toBeVisible({ timeout: 20_000 }); // first visit compiles the page
  await expect(page.getByTestId("save-query")).toBeDisabled();
  await expect(page.getByTestId("query-name")).toBeDisabled();
});

test("quota meter reflects collected mentions and warns near the limit", async ({ page }) => {
  const { email, slug } = await createUser(page);
  await page.goto(`/w/${slug}/home`);
  await expect(page.getByTestId("quota-meter")).toBeVisible();
  await pool.query(
    `INSERT INTO usage_counters (account_id, period, metric, value)
     SELECT m.account_id, to_char(now(), 'YYYY-MM'), 'mentions', 4200 FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1
     ON CONFLICT (account_id, period, metric) DO UPDATE SET value = 4200`,
    [email],
  );
  await page.reload();
  await expect(page.getByTestId("quota-text")).toContainText("4,200 / 5,000");
  await expect(page.getByTestId("quota-banner")).toContainText("84%");
});
