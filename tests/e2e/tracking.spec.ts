import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createUser, pool } from "./helpers";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const setPlan = (email: string, tier: string) =>
  pool.query(
    `UPDATE accounts SET plan_tier = $2 WHERE id IN (SELECT m.account_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1)`,
    [email.toLowerCase(), tier],
  );

/** A campaign with one creator who has been invited and has accepted through their own page. */
async function confirmedCampaign(page: Page, browser: Browser, slug: string, fee = "500") {
  await page.goto(`/w/${slug}/creators`);
  await page.getByTestId("add-to-list").first().click();
  await page.getByTestId("new-list-name").fill("Tracking picks");
  await page.getByTestId("add-to-list-confirm").click();
  await expect(page.getByTestId("add-to-list-status").first()).toContainText("Added");
  await page.goto(`/w/${slug}/creators/campaigns`);
  await page.getByTestId("campaign-name").fill("Tracked launch");
  await page.getByTestId("campaign-budget").fill("2000");
  await page.getByTestId("campaign-create").click();
  await page.waitForURL(/campaigns\/[0-9a-f-]{36}/);
  const campaign = new URL(page.url()).pathname;
  await page.getByTestId("add-from-list-submit").click();
  const row = page.getByTestId("roster-row").first();
  await expect(row).toBeVisible();
  await row.getByTestId("invite-open").click();
  await row.getByTestId("invite-offer").fill(fee);
  await row.getByTestId("invite-send").click();
  await expect(row.getByTestId("roster-status")).toHaveText("Invited");
  const ctx = await browser.newContext();
  const cp = await ctx.newPage();
  await cp.goto(await row.getByTestId("invite-link").inputValue());
  await cp.getByTestId("portal-accept").click();
  await expect(cp.getByTestId("portal-heading")).toHaveText("You're confirmed");
  return { campaign, ctx, cp };
}

async function eventsOf(slug: string, name: string) {
  return (
    await pool.query(
      `SELECT user_id, props FROM analytics_events WHERE name = $1 AND workspace_id = (SELECT id FROM workspaces WHERE slug = $2) ORDER BY ts`,
      [name, slug],
    )
  ).rows as { user_id: string | null; props: Record<string, unknown> }[];
}

test("a link goes from set-up to clicks, conversions and cost, and the numbers add up", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const { slug, email } = await createUser(page, { prefix: "trk" });
  await setPlan(email, "growth");
  const { campaign, ctx, cp } = await confirmedCampaign(page, browser, slug, "500");

  // Before a landing page is set, there is nothing to show the creator.
  await expect(cp.getByTestId("portal-tracking")).toHaveCount(0);
  await page.goto(`${campaign}/results`);
  await expect(page.getByTestId("results-no-destination")).toBeVisible();
  await page.getByTestId("destination-input").fill("not a link");
  await page.getByTestId("destination-save").click();
  await expect(page.getByTestId("destination-error")).toContainText("full link");
  await page
    .getByTestId("destination-input")
    .fill("https://shop.example.test/launch?utm_content=hero");
  await page.getByTestId("destination-save").click();
  await expect(page.getByTestId("destination-status")).toContainText("Saved");
  await expect(page.getByTestId("postback-url")).toHaveValue(
    /\/api\/t\/conversion\?cid=\{rw_cid\}&key=[0-9a-f]{48}&value=\{amount_usd\}&ref=\{order_id\}/,
  );

  // The creator's page now shows their link; the brand sees the same one.
  await cp.reload();
  const link = await cp.getByTestId("portal-tracking-link").inputValue();
  expect(link).toMatch(/\/r\/[a-hj-km-np-z2-9]{10}$/);
  await page.reload();
  await expect(page.getByTestId("creator-link-field")).toHaveValue(link);
  await expect(page.getByTestId("results-empty")).toBeVisible();

  // A visitor follows it: sent on to the landing page with the creator and click id added.
  const hit = await page.request.get(link, {
    maxRedirects: 0,
    headers: { "user-agent": BROWSER_UA },
  });
  expect(hit.status()).toBe(302);
  const to = new URL(hit.headers()["location"]!);
  expect(to.origin + to.pathname).toBe("https://shop.example.test/launch");
  expect(to.searchParams.get("utm_content")).toBe("hero"); // the brand's own tags are kept
  expect(to.searchParams.get("utm_medium")).toBe("influencer");
  const cid = to.searchParams.get("rw_cid")!;
  expect(cid).toMatch(/^[0-9a-f]{24}$/);
  // The same visitor again, and a link-preview robot: both are sent on, only the first visit counts as a person.
  expect(
    (
      await page.request.get(link, { maxRedirects: 0, headers: { "user-agent": BROWSER_UA } })
    ).status(),
  ).toBe(302);
  expect(
    (
      await page.request.get(link, {
        maxRedirects: 0,
        headers: { "user-agent": "Slackbot-LinkExpanding 1.0" },
      })
    ).status(),
  ).toBe(302);

  // The brand's site reports a sale. Wrong key, then the right one; the same order is only counted once.
  const key = (await page.getByTestId("postback-url").inputValue()).match(
    /key=([0-9a-f]{48})/,
  )![1]!;
  const bad = await page.request.get(
    `/api/t/conversion?cid=${cid}&key=${"0".repeat(48)}&value=120&ref=order-1`,
  );
  expect(bad.status()).toBe(401);
  const ok = await page.request.get(
    `/api/t/conversion?cid=${cid}&key=${key}&value=120&ref=order-1`,
  );
  expect(await ok.json()).toEqual({ ok: true, duplicate: false });
  const again = await page.request.post(`/api/t/conversion`, {
    data: { cid, key, value: 120, ref: "order-1" },
  });
  expect(await again.json()).toEqual({ ok: true, duplicate: true });
  await page.request.get(`/api/t/conversion?cid=${cid}&key=${key}&value=80&ref=order-2`);

  await page.reload();
  await expect(page.getByTestId("kpi-clicks")).toHaveText("2"); // the robot isn't counted
  await expect(page.getByTestId("kpi-visitors")).toHaveText("1");
  await expect(page.getByTestId("kpi-conversions")).toHaveText("2");
  await expect(page.getByTestId("kpi-revenue")).toHaveText("$200");
  await expect(page.getByTestId("kpi-spend")).toHaveText("$500");
  await expect(page.getByTestId("kpi-cpc")).toHaveText("$250");
  await expect(page.getByTestId("kpi-cpa")).toHaveText("$250");
  await expect(page.getByTestId("kpi-roas")).toHaveText("0.4×");
  await expect(page.getByTestId("row-clicks")).toHaveText("2");
  await expect(page.getByTestId("results-empty")).toHaveCount(0);
  // The chart has a table twin with the same numbers.
  await page.getByTestId("results-chart-toggle").click();
  await expect(page.getByTestId("results-chart").getByRole("table")).toBeVisible();

  // Analytics: the audience's click is anonymous, in Influencers; the conversion is too; the brand's view is a member.
  const clicks = await eventsOf(slug, "Tracking Link Clicked");
  expect(clicks).toHaveLength(3);
  for (const e of clicks) {
    expect(e.user_id).toBeNull();
    expect(e.props).toMatchObject({ product: "influencers", actor_type: "anonymous" });
  }
  expect(clicks.map((e) => [e.props.is_unique, e.props.is_bot])).toEqual([
    [true, false],
    [false, false],
    [false, true],
  ]);
  expect(
    (await eventsOf(slug, "Campaign Conversion Recorded")).map((e) => e.props.value_usd),
  ).toEqual([120, 80]);
  expect((await eventsOf(slug, "Tracking Link Created"))[0]!.props).toMatchObject({
    source: "destination_set",
  });
  expect((await eventsOf(slug, "Campaign Results Viewed")).at(-1)!.props).toMatchObject({
    clicks: 2,
    conversions: 2,
    product: "influencers",
    actor_type: "member",
  });
  await ctx.close();
});

test("links that aren't live say so, and old posts keep working after a campaign ends", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const { slug, email } = await createUser(page, { prefix: "trkoff" });
  await setPlan(email, "growth");
  const { campaign, ctx, cp } = await confirmedCampaign(page, browser, slug);
  await page.goto(`${campaign}/results`);
  await page.getByTestId("destination-input").fill("https://shop.example.test/");
  await page.getByTestId("destination-save").click();
  await expect(page.getByTestId("destination-status")).toContainText("Saved");
  await cp.reload();
  const link = await cp.getByTestId("portal-tracking-link").inputValue();
  const get = (u: string) =>
    page.request.get(u, { maxRedirects: 0, headers: { "user-agent": BROWSER_UA } });

  const gone = await get(new URL(link).origin + "/r/" + "z".repeat(10));
  expect(gone.status()).toBe(404);
  expect(await gone.text()).toContain("This link isn't active");
  expect((await get(new URL(link).origin + "/r/not-a-code")).status()).toBe(404);

  await page.goto(campaign);
  await page.getByTestId("campaign-to-active").click();
  await expect(page.getByTestId("campaign-status")).toHaveText("Active");
  await page.getByTestId("campaign-to-completed").click();
  await expect(page.getByTestId("campaign-status")).toHaveText("Completed");
  expect((await get(link)).status()).toBe(302); // a finished campaign's posts still lead somewhere
  await page.getByTestId("campaign-to-archived").click();
  await expect(page.getByTestId("campaign-status")).toHaveText("Archived");
  expect((await get(link)).status()).toBe(404);
  await ctx.close();
});

test("results are a paid feature, and only editors see the secret key", async ({ page }) => {
  test.setTimeout(240_000);
  const { slug, email } = await createUser(page, { prefix: "trkplan" });
  await page.goto(`/w/${slug}/creators/campaigns`);
  await page.getByTestId("campaign-name").fill("Plan check");
  await page.getByTestId("campaign-create").click();
  await page.waitForURL(/campaigns\/[0-9a-f-]{36}/);
  const campaign = new URL(page.url()).pathname;
  await page.goto(`${campaign}/results`);
  await expect(page.getByTestId("results-locked")).toBeVisible();
  await page.getByTestId("results-locked-unlock").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");

  await setPlan(email, "growth");
  await page.reload();
  await page.getByTestId("destination-input").fill("https://shop.example.test/");
  await page.getByTestId("destination-save").click();
  await expect(page.getByTestId("postback-url")).toBeVisible();

  await pool.query(
    `UPDATE memberships SET role = 'viewer' WHERE user_id IN (SELECT id FROM users WHERE lower(email) = $1)`,
    [email.toLowerCase()],
  );
  await page.reload();
  await expect(page.getByTestId("destination-input")).toBeDisabled();
  await expect(page.getByTestId("postback-url")).toHaveCount(0);
  await expect(page.getByTestId("postback-setup")).toContainText("An editor or admin can see");
});

for (const theme of ["light", "dark"] as const) {
  test(`the results page has no serious a11y violations (${theme})`, async ({ page, browser }) => {
    test.setTimeout(300_000);
    const { slug, email } = await createUser(page, { prefix: `trka11y${theme}` });
    await setPlan(email, "growth");
    const { campaign, ctx, cp } = await confirmedCampaign(page, browser, slug);
    await page.addInitScript((t) => localStorage.setItem("rw-theme", t), theme);
    await page.goto(`${campaign}/results`);
    await page.getByTestId("destination-input").fill("https://shop.example.test/");
    await page.getByTestId("destination-save").click();
    await expect(page.getByTestId("postback-url")).toBeVisible();
    await cp.reload();
    const link = await cp.getByTestId("portal-tracking-link").inputValue();
    await page.request.get(link, { maxRedirects: 0, headers: { "user-agent": BROWSER_UA } });
    await page.reload();
    await expect(page.getByTestId("results-chart")).toBeVisible();
    const scan = async (p: Page, label: string) => {
      const { violations } = await new AxeBuilder({ page: p })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, `${label}: ${JSON.stringify(serious, null, 1)}`).toEqual([]);
    };
    await scan(page, "results page");
    await page.getByTestId("results-chart-toggle").click();
    await scan(page, "results page (chart as table)");
    await scan(cp, "creator page with tracking link");
    await ctx.close();
  });
}
