import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createUser, pool } from "./helpers";

const setPlan = (email: string, tier: string) =>
  pool.query(
    `UPDATE accounts SET plan_tier = $2 WHERE id IN (SELECT m.account_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1)`,
    [email.toLowerCase(), tier],
  );

async function eventsOf(slug: string, name: string) {
  return (
    await pool.query(
      `SELECT user_id, props FROM analytics_events WHERE name = $1 AND workspace_id = (SELECT id FROM workspaces WHERE slug = $2) ORDER BY ts`,
      [name, slug],
    )
  ).rows as { user_id: string | null; props: Record<string, unknown> }[];
}

const countOf = async (page: Page) =>
  Number((await page.getByTestId("creator-count").innerText()).replace(/,/g, "").match(/^\d+/)![0]);

async function save(page: Page, name: string) {
  await page.getByTestId("save-name").fill(name);
  await page.getByTestId("save-submit").click();
}

test("a search can be saved, reopened, and removed, within the plan's limit", async ({ page }) => {
  test.setTimeout(240_000);
  const { slug } = await createUser(page, { prefix: "saved" });
  await page.goto(`/w/${slug}/creators`);
  await expect(page.getByTestId("saved-empty")).toBeVisible();

  // Nothing to save without filters.
  await save(page, "Everything");
  await expect(page.getByTestId("saved-error")).toContainText("at least one filter");

  // Filters in, then save: the saved search shows how many creators match.
  await page.goto(`/w/${slug}/creators?platform=tiktok&niche=beauty&auth=70&page=2`);
  const matches = await countOf(page);
  expect(matches).toBeGreaterThan(0);
  await save(page, "TikTok beauty");
  await expect(page.getByTestId("saved-status")).toContainText("Saved “TikTok beauty”");
  await expect(page.getByTestId("saved-item")).toHaveCount(1);
  await expect(page.getByTestId("saved-matches")).toContainText(matches.toLocaleString("en-US"));
  // A second search with the same name is refused, whatever the case or spacing.
  await save(page, "TikTok beauty");
  await expect(page.getByTestId("saved-error")).toContainText("already have a saved search");

  // Opening it elsewhere restores the filters (and starts on page one).
  await page.goto(`/w/${slug}/creators`);
  await expect(page.getByTestId("saved-item")).toHaveCount(1);
  const href = await page.getByTestId("saved-link").getAttribute("href");
  expect(href).toContain("platform=tiktok");
  expect(href).not.toContain("page=");
  await page.goto(href!);
  await expect(page.getByLabel("Min. authenticity")).toHaveValue("70");
  expect(await countOf(page)).toBe(matches);

  // The plan (Trial) keeps three. The fourth meets a paywall, and deleting one makes room.
  await page.goto(`/w/${slug}/creators?niche=food`);
  await save(page, "Food");
  await expect(page.getByTestId("saved-item")).toHaveCount(2);
  await page.goto(`/w/${slug}/creators?niche=travel`);
  await save(page, "Travel");
  await expect(page.getByTestId("saved-item")).toHaveCount(3);
  await page.goto(`/w/${slug}/creators?niche=gaming`);
  await save(page, "Gaming");
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("saved-item")).toHaveCount(3);
  await page
    .getByTestId("saved-item")
    .filter({ hasText: "Travel" })
    .getByTestId("saved-delete")
    .click();
  await expect(page.getByTestId("saved-item")).toHaveCount(2);
  await save(page, "Gaming");
  await expect(page.getByTestId("saved-item")).toHaveCount(3);
  await page.reload();
  await expect(page.getByTestId("saved-item")).toHaveCount(3);

  const saved = await eventsOf(slug, "Creator Search Saved");
  expect(saved).toHaveLength(4);
  expect(saved[0]!.props).toMatchObject({
    filter_count: 3,
    product: "influencers",
    actor_type: "member",
  });
  expect(await eventsOf(slug, "Saved Search Deleted")).toHaveLength(1);
  expect(
    (await eventsOf(slug, "Paywall Viewed")).some(
      (e) => e.props.paywall_trigger === "saved_search_limit" && e.props.product === "influencers",
    ),
  ).toBe(true);
});

test("a viewer can open saved searches but not save or delete them", async ({ page }) => {
  test.setTimeout(240_000);
  const { slug, email } = await createUser(page, { prefix: "savedview" });
  await page.goto(`/w/${slug}/creators?niche=food`);
  await save(page, "Food");
  await expect(page.getByTestId("saved-item")).toHaveCount(1);
  await pool.query(
    `UPDATE memberships SET role = 'viewer' WHERE user_id IN (SELECT id FROM users WHERE lower(email) = $1)`,
    [email.toLowerCase()],
  );
  await page.reload();
  await expect(page.getByTestId("saved-link")).toBeVisible();
  await expect(page.getByTestId("save-name")).toHaveCount(0);
  await expect(page.getByTestId("saved-delete")).toHaveCount(0);
});

test("creators can be compared side by side, with the best marked, up to what the plan allows", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const { slug, email } = await createUser(page, { prefix: "cmp" });
  await page.goto(`/w/${slug}/creators`);
  const checks = page.getByTestId("compare-check");

  // Trial compares two. One is not enough; a third meets a paywall.
  await checks.nth(0).check();
  await expect(page.getByTestId("compare-count")).toContainText("1 creator selected. Pick 1 more");
  await expect(page.getByTestId("compare-go")).toHaveCount(0);
  await checks.nth(1).check();
  await expect(page.getByTestId("compare-go")).toBeVisible();
  await checks
    .nth(2)
    .check({ force: true })
    .catch(() => undefined);
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(checks.nth(2)).not.toBeChecked();
  await expect(page.getByTestId("compare-count")).toContainText("2 creators selected");

  // The selection follows you to the next page.
  const names = await page.getByTestId("creator-link").allInnerTexts();
  const next = await page.getByTestId("creator-next").getAttribute("href");
  await page.goto(next!);
  await expect(page.getByTestId("compare-count")).toContainText("2 creators selected");
  await page.goBack();
  await page.getByTestId("compare-go").click();
  await page.waitForURL(/creators\/compare\?ids=\d+,\d+/);
  await expect(page.getByTestId("compare-col")).toHaveCount(2);
  const headers = await page.getByTestId("compare-col").allInnerTexts();
  expect(headers[0]).toContain(names[0]);
  expect(headers[1]).toContain(names[1]);

  // "Best" is on the higher engagement, and on the lower cost per thousand views.
  const cells = async (key: string) => {
    const tds = page.getByTestId(`compare-row-${key}`).locator("td");
    return Promise.all(
      [0, 1].map(async (i) => ({
        text: await tds.nth(i).innerText(),
        best: (await tds.nth(i).getByTestId("best").count()) > 0,
      })),
    );
  };
  const eng = await cells("engagement");
  const [e0, e1] = eng.map((c) => parseFloat(c.text));
  if (e0 !== e1) expect(eng.map((c) => c.best)).toEqual(e0! > e1! ? [true, false] : [false, true]);
  else expect(eng.some((c) => c.best)).toBe(false);
  const cpm = await cells("cpm");
  const [c0, c1] = cpm.map((c) => parseFloat(c.text.replace("$", "")));
  if (c0 !== c1) expect(cpm.map((c) => c.best)).toEqual(c0! < c1! ? [true, false] : [false, true]);
  // Followers is a fact, not a score: nobody is "best" at it.
  expect(await page.getByTestId("compare-row-followers").getByTestId("best").count()).toBe(0);
  // Only two creators: nothing to remove down to.
  await expect(page.getByTestId("compare-remove")).toHaveCount(0);

  expect((await eventsOf(slug, "Creators Compared"))[0]!.props).toMatchObject({
    creator_count: 2,
    truncated: false,
    product: "influencers",
  });

  // Growth compares four: a link asking for more shows the first four and says so; one creator is not a comparison.
  await setPlan(email, "growth");
  const five = await page.evaluate(async () => [1, 2, 3, 4, 5].join(","));
  await page.goto(`/w/${slug}/creators/compare?ids=${five}`);
  await expect(page.getByTestId("compare-col")).toHaveCount(4);
  await expect(page.getByTestId("compare-truncated")).toContainText("up to 4");
  await expect(page.getByTestId("compare-remove")).toHaveCount(4);
  // A click that lands while the page is still taking over can be dropped, so retry it until it navigates.
  await expect(async () => {
    await page.getByTestId("compare-remove").first().click();
    await expect(page).toHaveURL(/ids=2,3,4$/, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId("compare-col")).toHaveCount(3);
  await page.goto(`/w/${slug}/creators/compare?ids=1`);
  await expect(page.getByTestId("compare-empty")).toBeVisible();
  await page.goto(`/w/${slug}/creators/compare?ids=999999999,1`);
  await expect(page.getByTestId("compare-empty")).toBeVisible();
  expect((await eventsOf(slug, "Creators Compared")).at(-1)!.props).toMatchObject({
    truncated: false,
    creator_count: 3,
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`saved searches and comparison have no serious a11y violations (${theme})`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const { slug, email } = await createUser(page, { prefix: `cmpa11y${theme}` });
    await setPlan(email, "growth");
    await page.addInitScript((t) => localStorage.setItem("rw-theme", t), theme);
    const scan = async (label: string) => {
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, `${label}: ${JSON.stringify(serious, null, 1)}`).toEqual([]);
    };
    await page.goto(`/w/${slug}/creators?niche=food`);
    await save(page, "Food");
    await expect(page.getByTestId("saved-item")).toHaveCount(1);
    await page.getByTestId("compare-check").nth(0).check();
    await page.getByTestId("compare-check").nth(1).check();
    await expect(page.getByTestId("compare-bar")).toBeVisible();
    await scan("discovery with a saved search and the compare bar");
    await page.getByTestId("compare-go").click();
    await expect(page.getByTestId("compare-table")).toBeVisible();
    await scan("comparison");
  });
}
