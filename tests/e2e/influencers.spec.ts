import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createUser, pool } from "./helpers";

const setPlan = (email: string, tier: string) =>
  pool.query(
    `UPDATE accounts SET plan_tier = $2 WHERE id IN (SELECT m.account_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1)`,
    [email.toLowerCase(), tier],
  );

async function firstCreatorId(page: Page, slug: string, qs = "") {
  await page.goto(`/w/${slug}/creators${qs}`);
  const href = await page.getByTestId("creator-link").first().getAttribute("href");
  return /creators\/(\d+)/.exec(href!)![1]!;
}

test("after login a split screen leads to either product, and remembers the last one", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { slug } = await createUser(page, { prefix: "hub" });
  await page.goto("/");
  await page.waitForURL("**/hub");
  await expect(page.getByTestId("hub-listening")).toBeVisible();
  await expect(page.getByTestId("hub-influencers")).toBeVisible();
  await expect(page.getByTestId("hub-last")).toHaveCount(0);

  await page.getByTestId("hub-influencers").click();
  await page.waitForURL(`**/w/${slug}/creators`);
  await expect(page.getByRole("heading", { name: "Discover creators" })).toBeVisible();
  await expect(page.getByTestId("switch-influencers")).toHaveAttribute("aria-current", "page");
  // The sidebar shows the Influencers product, not the listening one.
  await expect(page.getByTestId("nav-creators")).toBeVisible();
  await expect(page.getByTestId("nav-mentions")).toHaveCount(0);

  await page.getByTestId("switch-listening").click();
  await page.waitForURL(`**/w/${slug}/home`);
  await expect(page.getByTestId("nav-mentions")).toBeVisible();

  await page.getByTestId("all-products").click();
  await page.waitForURL("**/hub");
  await expect(page.getByTestId("hub-last")).toHaveCount(1);
  await expect(page.getByTestId("hub-listening").getByTestId("hub-last")).toBeVisible();
});

test("discovery filters live in the URL and survive a reload", async ({ page }) => {
  test.setTimeout(180_000);
  const { slug } = await createUser(page, { prefix: "disc" });
  await page.goto(`/w/${slug}/creators`);
  await expect(page.getByTestId("creator-row")).toHaveCount(25);
  const all = await page.getByTestId("creator-count").innerText();

  await page.getByText("More filters").click();
  await page.getByLabel("TikTok").check();
  await page.getByLabel("Beauty").check();
  await page.getByLabel("Min. authenticity").fill("85");
  await page.getByTestId("creator-apply").click();
  await page.waitForURL(/platform=tiktok/);
  expect(page.url()).toMatch(/niche=beauty/);
  expect(page.url()).toMatch(/auth=85/);
  await expect(page.getByTestId("creator-count")).not.toHaveText(all);
  for (const t of await page.getByTestId("creator-auth").allInnerTexts())
    expect(parseInt(t, 10)).toBeGreaterThanOrEqual(85);

  await page.reload();
  await expect(page.getByLabel("TikTok")).toBeChecked();
  await expect(page.getByLabel("Min. authenticity")).toHaveValue("85");

  // Nothing matches: a helpful empty state, with a way out.
  await page.goto(`/w/${slug}/creators?q=zzzzqqqq`);
  await expect(page.getByTestId("creators-empty")).toBeVisible();
  const clear = page.getByTestId("creators-empty").getByRole("link", { name: "Clear all filters" });
  await expect(clear).toHaveAttribute("href", `/w/${slug}/creators`);
  await page.goto(`/w/${slug}/creators`);
  await expect(page.getByTestId("creator-row").first()).toBeVisible();

  // Paging keeps the filters and doesn't repeat creators.
  await page.goto(`/w/${slug}/creators?niche=food`);
  const first = await page.getByTestId("creator-link").allInnerTexts();
  await page.getByTestId("creator-next").click();
  await page.waitForURL(/page=2/);
  expect(page.url()).toMatch(/niche=food/);
  const second = await page.getByTestId("creator-link").allInnerTexts();
  expect(second.filter((n) => first.includes(n))).toEqual([]);
});

test("trial plan: audience insights are locked behind a dismissible paywall; Growth unlocks them", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { slug, email } = await createUser(page, { prefix: "aud" });
  const id = await firstCreatorId(page, slug);
  await page.goto(`/w/${slug}/creators/${id}`);
  await expect(page.getByTestId("auth-score")).toBeVisible();
  await expect(page.getByTestId("audience-locked")).toBeVisible();
  await expect(page.getByTestId("fake-pct")).toHaveCount(0);

  await page.getByTestId("audience-locked-unlock").click();
  const modal = page.getByTestId("paywall-modal");
  await expect(modal).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();

  await setPlan(email, "growth");
  await page.reload();
  await expect(page.getByTestId("audience")).toBeVisible();
  await expect(page.getByTestId("fake-pct")).toBeVisible();
  // Chart twin: the same numbers as a table.
  await page.getByTestId("aud-age-toggle").click();
  await expect(page.getByTestId("aud-age").getByRole("table")).toBeVisible();
  await expect(page.getByTestId("aud-age").getByRole("row")).toHaveCount(6); // header + 5 age bands
});

test("lists: create, add, remove, plan limit, and export is a paid feature", async ({ page }) => {
  test.setTimeout(240_000);
  const { slug, email } = await createUser(page, { prefix: "lists" });
  await page.goto(`/w/${slug}/creators/lists`);
  await expect(page.getByTestId("lists-empty")).toBeVisible();

  // Add from discovery, creating the list in the same step.
  await page.goto(`/w/${slug}/creators`);
  const name = await page.getByTestId("creator-link").first().innerText();
  await page.getByTestId("add-to-list").first().click();
  await page.getByTestId("new-list-name").fill("Summer launch");
  await page.getByTestId("add-to-list-confirm").click();
  await expect(page.getByTestId("add-to-list-status").first()).toContainText(
    `Added ${name} to Summer launch`,
  );
  await expect(page.getByTestId("add-to-list").first()).toContainText("In 1 list");

  await page.goto(`/w/${slug}/creators/lists`);
  await expect(page.getByTestId("list-row")).toHaveCount(1);
  await page.getByRole("link", { name: "Summer launch" }).click();
  await expect(page.getByTestId("list-item")).toHaveCount(1);

  // Trial: export locked (paywall, not a download).
  await page.getByTestId("export-list").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  const denied = await page.request.get(
    page
      .url()
      .replace(/\/w\//, "/api/w/")
      .replace(/creators\/lists/, "creators/lists") + "/export",
  );
  expect(denied.status()).toBe(402);

  // Trial: two lists, then the paywall on the third.
  await page.goto(`/w/${slug}/creators/lists`);
  await page.getByTestId("new-list-input").fill("Second");
  await page.getByTestId("new-list-submit").click();
  await page.waitForURL(/creators\/lists\/[0-9a-f-]{36}/);
  await page.goto(`/w/${slug}/creators/lists`);
  await page.getByTestId("new-list-input").fill("Third");
  await page.getByTestId("new-list-submit").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("list-row")).toHaveCount(2);

  // Growth: export works and returns the creator.
  await setPlan(email, "growth");
  await page.getByRole("link", { name: "Summer launch" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-list").click(),
  ]);
  expect(download.suggestedFilename()).toBe("creators-summer-launch.csv");
  const csv = await (await import("node:fs/promises")).readFile((await download.path())!, "utf8");
  expect(csv.split("\n")[0]).toContain('"handle"');
  expect(csv).toContain(name);

  // Remove from the list.
  await page.getByTestId("remove-from-list").click();
  await expect(page.getByTestId("list-empty")).toBeVisible();
});

test("the monthly profile allowance: re-opening is free, a new profile past the limit is blocked", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { slug, email } = await createUser(page, { prefix: "quota" });
  const id = await firstCreatorId(page, slug);
  await page.goto(`/w/${slug}/creators/${id}`);
  await expect(page.getByTestId("creator-name")).toBeVisible();

  // Use up the rest of the trial allowance (15), the way real browsing would.
  const acct = (
    await pool.query(
      `SELECT m.account_id AS id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1`,
      [email.toLowerCase()],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO creator_profile_views (account_id, creator_id, period)
     SELECT $1, g, to_char(now(), 'YYYY-MM') FROM generate_series(40000, 40013) g ON CONFLICT DO NOTHING`,
    [acct],
  );
  // The profile already opened stays available...
  await page.goto(`/w/${slug}/creators/${id}`);
  await expect(page.getByTestId("creator-name")).toBeVisible();
  // ...a new one is blocked, with the way forward.
  await page.goto(`/w/${slug}/creators/${Number(id) + 100}`);
  await expect(page.getByTestId("profile-quota-reached")).toBeVisible();
  await page.getByTestId("profile-quota-upgrade").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`/w/${slug}/creators`);
  await expect(page.getByTestId("profile-quota")).toContainText("15 of 15");
});

test("a viewer can browse creators but not change lists", async ({ page }) => {
  test.setTimeout(180_000);
  const { slug, email } = await createUser(page, { prefix: "viewer" });
  await pool.query(
    `UPDATE memberships SET role = 'viewer' WHERE user_id IN (SELECT id FROM users WHERE lower(email) = $1)`,
    [email.toLowerCase()],
  );
  await page.goto(`/w/${slug}/creators`);
  await expect(page.getByTestId("add-to-list").first()).toBeDisabled();
  await page.goto(`/w/${slug}/creators/lists`);
  await expect(page.getByTestId("new-list-submit")).toBeDisabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`influencer screens have no serious a11y violations (${theme})`, async ({ page }) => {
    test.setTimeout(180_000);
    const { slug, email } = await createUser(page, { prefix: `a11y${theme}` });
    await setPlan(email, "growth");
    await page.addInitScript((t) => localStorage.setItem("rw-theme", t), theme);
    const id = await firstCreatorId(page, slug);
    await page.goto(`/w/${slug}/creators/lists`);
    await page.getByTestId("new-list-input").fill("A11y list");
    await page.getByTestId("new-list-submit").click();
    await page.waitForURL(/creators\/lists\/[0-9a-f-]{36}/);
    const listUrl = new URL(page.url()).pathname;
    for (const path of [
      "/hub",
      `/w/${slug}/creators`,
      `/w/${slug}/creators/${id}`,
      `/w/${slug}/creators/lists`,
      listUrl,
    ]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, `${path}: ${JSON.stringify(serious, null, 1)}`).toEqual([]);
    }
  });
}
