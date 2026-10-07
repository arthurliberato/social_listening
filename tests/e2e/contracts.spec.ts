import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { createUser, pool } from "./helpers";

const setPlan = (email: string, tier: string) =>
  pool.query(
    `UPDATE accounts SET plan_tier = $2 WHERE id IN (SELECT m.account_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1)`,
    [email.toLowerCase(), tier],
  );

/** A campaign with one creator who has been invited and has accepted through their own page. */
async function confirmedCampaign(page: Page, browser: Browser, slug: string) {
  await page.goto(`/w/${slug}/creators`);
  await page.getByTestId("add-to-list").first().click();
  await page.getByTestId("new-list-name").fill("Contract picks");
  await page.getByTestId("add-to-list-confirm").click();
  await expect(page.getByTestId("add-to-list-status").first()).toContainText("Added");
  await page.goto(`/w/${slug}/creators/campaigns`);
  await page.getByTestId("campaign-name").fill("Agreement launch");
  await page.getByTestId("campaign-budget").fill("5000");
  await page.getByTestId("campaign-create").click();
  await page.waitForURL(/campaigns\/[0-9a-f-]{36}/);
  const campaign = new URL(page.url()).pathname;
  await page.getByTestId("add-from-list-submit").click();
  const row = page.getByTestId("roster-row").first();
  await expect(row).toBeVisible();
  await row.getByTestId("invite-open").click();
  await row.getByTestId("invite-offer").fill("800");
  await row.getByTestId("invite-send").click();
  await expect(row.getByTestId("roster-status")).toHaveText("Invited");
  const ctx = await browser.newContext();
  const cp = await ctx.newPage();
  await cp.goto(await row.getByTestId("invite-link").inputValue());
  await cp.getByTestId("portal-accept").click();
  await expect(cp.getByTestId("portal-heading")).toHaveText("You're confirmed");
  await page.reload();
  return { campaign, ctx, cp, row: () => page.getByTestId("roster-row").first() };
}

async function eventsOf(slug: string, name: string) {
  return (
    await pool.query(
      `SELECT user_id, props FROM analytics_events WHERE name = $1 AND workspace_id = (SELECT id FROM workspaces WHERE slug = $2) ORDER BY ts`,
      [name, slug],
    )
  ).rows as { user_id: string | null; props: Record<string, unknown> }[];
}

async function sendAgreement(row: Locator, deliverables: string, usage = "90") {
  await row.getByTestId("contract-open").click();
  await row.getByTestId("contract-deliverables").fill(deliverables);
  await row.getByTestId("contract-usage").selectOption(usage);
  await row.getByTestId("contract-send").click();
}

test("agreement to signature to approval to payout: both sides stay in step", async ({
  page,
  browser,
}) => {
  test.setTimeout(360_000);
  const { slug, email } = await createUser(page, { prefix: "ctr" });
  await setPlan(email, "agency");
  const { campaign, ctx, cp, row } = await confirmedCampaign(page, browser, slug);

  // The brand sends an agreement; the creator can read it, and can't submit content until it's dealt with.
  await sendAgreement(row(), "One Reel and three stories", "90");
  await expect(row().getByTestId("contract-state")).toHaveText("Agreement sent");
  await cp.reload();
  await expect(cp.getByTestId("contract-text")).toContainText("One Reel and three stories");
  await expect(cp.getByTestId("contract-text")).toContainText("$800");
  await expect(cp.getByTestId("contract-text")).toContainText("for 90 days after it is approved");
  await expect(cp.getByTestId("content-blocked")).toBeVisible();
  await expect(cp.getByTestId("content-submit")).toBeDisabled();

  // They ask for changes instead of signing; the brand sees why and sends a revised one.
  await cp.getByTestId("contract-ask-toggle").click();
  await cp.getByTestId("contract-note-send").click();
  await expect(cp.getByTestId("contract-error")).toContainText("what you'd like changed");
  await cp.getByTestId("contract-note").fill("Please shorten the usage period to 30 days");
  await cp.getByTestId("contract-note-send").click();
  await expect(cp.getByTestId("contract-status")).toContainText("You asked for changes");
  await page.reload();
  await expect(row().getByTestId("contract-state")).toHaveText("Creator asked for changes");
  await expect(row().getByTestId("contract-request-note")).toContainText(
    "shorten the usage period",
  );
  await row().getByTestId("contract-open").click();
  await row().getByTestId("contract-usage").selectOption("30");
  await row().getByTestId("contract-send").click();
  await expect(row().getByTestId("contract-state")).toHaveText("Agreement sent");
  await expect(row().getByTestId("contract-summary")).toContainText("version 2");

  // Signing needs a name and an explicit yes; it happens once.
  await cp.reload();
  await expect(cp.getByTestId("contract-text")).toContainText("for 30 days after it is approved");
  await cp.getByTestId("sign-submit").click();
  await expect(cp.getByTestId("contract-error")).toContainText("full name");
  await cp.getByTestId("sign-name").fill("Ana Alder");
  await cp.getByTestId("sign-submit").click();
  await expect(cp.getByTestId("contract-error")).toContainText("Tick the box");
  await cp.getByTestId("sign-agree").check();
  await cp.getByTestId("sign-submit").click();
  await expect(cp.getByTestId("contract-status")).toContainText("Signed by Ana Alder");
  await expect(cp.getByTestId("content-blocked")).toHaveCount(0);
  await page.reload();
  await expect(row().getByTestId("contract-state")).toHaveText("Agreement signed");

  // Content, approval.
  await cp.getByTestId("content-url").fill("https://social.example.test/p/launch");
  await cp.getByTestId("content-submit").click();
  await expect(cp.getByTestId("portal-heading")).toContainText("is with");
  await page.reload();
  await row().getByTestId("review-approve").click();
  await expect(row().getByTestId("roster-status")).toHaveText("Content approved");

  // The brand can't pay until the creator says where.
  await expect(row().getByTestId("payout-send")).toBeDisabled();
  await expect(row().getByTestId("payout-blocker")).toContainText("payout details");
  await cp.reload();
  await expect(cp.getByTestId("portal-payout")).toBeVisible();
  await cp.getByTestId("payout-holder").fill("Ana Alder");
  await cp.getByTestId("payout-account").fill("123");
  await cp.getByTestId("payout-save").click();
  await expect(cp.getByTestId("payout-error")).toContainText("8 to 17 digits");
  await cp.getByTestId("payout-account").fill("000999999992"); // a test account that can't be verified
  await cp.getByTestId("payout-save").click();
  await expect(cp.getByTestId("payout-error")).toContainText("couldn't verify");
  await cp.getByTestId("payout-account").fill("0001 2345 6789");
  await cp.getByTestId("payout-save").click();
  await expect(cp.getByTestId("payout-details-saved")).toContainText("ending 6789");
  // The number itself is nowhere in the database.
  const stored = await pool.query(`SELECT * FROM creator_payout_details`);
  expect(JSON.stringify(stored.rows)).not.toContain("012345");

  await page.reload();
  await expect(row().getByTestId("payout-details-line")).toContainText("ending 6789");
  await expect(row().getByTestId("payout-send")).toBeEnabled();
  await row().getByTestId("payout-send").click();
  await expect(row().getByTestId("payout-state")).toContainText("Payout on its way");
  await expect(row().getByTestId("move-paid")).toHaveCount(0); // a manual "mark paid" would pay twice
  await cp.reload();
  await expect(cp.getByTestId("payout-status")).toContainText("is on its way");

  // The simulated clock passes: the payout settles and everyone sees it.
  await pool.query(
    `UPDATE creator_payouts SET settle_at = now() - interval '1 minute' WHERE status = 'processing'`,
  );
  await page.reload();
  await expect(row().getByTestId("roster-status")).toHaveText("Paid");
  await expect(row().getByTestId("payout-state")).toContainText("Payout sent");
  await expect(page.getByTestId("budget")).toContainText("$800 paid");
  await cp.reload();
  await expect(cp.getByTestId("portal-paid")).toBeVisible();
  await expect(cp.getByTestId("payout-status")).toContainText(
    "was sent to the account ending 6789",
  );

  // Emails and analytics: who did what.
  const mail = (
    await pool.query(
      `SELECT subject FROM emails WHERE type = 'outreach' AND to_address LIKE '%@creators.example.test'`,
    )
  ).rows.map((r) => r.subject as string);
  expect(mail.some((s) => s.includes("sent you an agreement"))).toBe(true);
  expect(mail.some((s) => s.includes("on its way"))).toBe(true);
  expect(mail.some((s) => s.startsWith("Payment sent"))).toBe(true);
  expect((await eventsOf(slug, "Creator Contract Sent")).map((e) => e.props.version)).toEqual([
    1, 2,
  ]);
  for (const name of [
    "Creator Contract Signed",
    "Creator Contract Changes Requested",
    "Creator Payout Details Saved",
  ]) {
    const rows = await eventsOf(slug, name);
    expect(rows.length, name).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      expect(r.user_id, name).toBeNull();
      expect(r.props, name).toMatchObject({ product: "creator_portal", actor_type: "creator" });
    }
  }
  const settled = (await eventsOf(slug, "Creator Payout Settled"))[0]!;
  expect(settled.user_id).toBeNull();
  expect(settled.props).toMatchObject({
    actor_type: "system",
    outcome: "paid",
    amount_usd: 800,
    product: "influencers",
  });
  expect((await eventsOf(slug, "Creator Payout Initiated"))[0]!.props).toMatchObject({
    actor_type: "member",
    attempt: 1,
  });
  void campaign;
  await ctx.close();
});

test("a failed payout can be retried once the creator fixes their account", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const { slug, email } = await createUser(page, { prefix: "ctrfail" });
  await setPlan(email, "agency");
  const { ctx, cp, row } = await confirmedCampaign(page, browser, slug);
  await cp.getByTestId("content-url").fill("https://social.example.test/p/1");
  await cp.getByTestId("content-submit").click();
  await expect(cp.getByTestId("portal-heading")).toContainText("is with");
  await page.reload();
  await row().getByTestId("review-approve").click();
  await expect(row().getByTestId("roster-status")).toHaveText("Content approved");

  await cp.reload();
  await cp.getByTestId("payout-holder").fill("Ana Alder");
  await cp.getByTestId("payout-account").fill("000999999991"); // saves fine, then every transfer is rejected
  await cp.getByTestId("payout-save").click();
  await expect(cp.getByTestId("payout-details-saved")).toBeVisible();
  await page.reload();
  await row().getByTestId("payout-send").click();
  await expect(row().getByTestId("payout-state")).toContainText("Payout on its way");
  await pool.query(
    `UPDATE creator_payouts SET settle_at = now() - interval '1 minute' WHERE status = 'processing'`,
  );
  await page.reload();
  await expect(row().getByTestId("payout-state")).toContainText("Payout failed");
  await expect(row().getByTestId("payout-state")).toContainText("account closed");
  await expect(row().getByTestId("roster-status")).toHaveText("Content approved"); // not paid
  await cp.reload();
  await expect(cp.getByTestId("payout-status")).toContainText("didn't go through");

  // The creator corrects the account; the brand retries.
  await cp.getByTestId("payout-edit").click();
  await cp.getByTestId("payout-holder").fill("Ana Alder");
  await cp.getByTestId("payout-account").fill("0001 2345 6789");
  await cp.getByTestId("payout-save").click();
  await expect(cp.getByTestId("payout-details-saved")).toContainText("ending 6789");
  await page.reload();
  await expect(row().getByTestId("payout-send")).toContainText("Retry payout");
  await row().getByTestId("payout-send").click();
  await expect(row().getByTestId("payout-state")).toContainText("attempt 2");
  await pool.query(
    `UPDATE creator_payouts SET settle_at = now() - interval '1 minute' WHERE status = 'processing'`,
  );
  await page.reload();
  await expect(row().getByTestId("roster-status")).toHaveText("Paid");
  const failed = (await eventsOf(slug, "Creator Payout Settled")).map((e) => e.props.outcome);
  expect(failed).toEqual(["failed", "paid"]);
  await ctx.close();
});

test("agreements and payouts are plan features, and viewers can't act on them", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const { slug, email } = await createUser(page, { prefix: "ctrplan" });
  const { cp, row } = await confirmedCampaign(page, browser, slug);

  // Trial: sending an agreement shows what Growth adds.
  await row().getByTestId("contract-open").click();
  await row().getByTestId("contract-deliverables").fill("One video");
  await row().getByTestId("contract-send").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row().getByTestId("contract-summary")).toHaveCount(0);
  await expect(cp.locator("body")).not.toContainText("Your agreement");

  // Growth has agreements but not payouts: the creator isn't asked for payout details, and the brand sees the lock.
  await setPlan(email, "growth");
  await page.reload();
  await sendAgreement(row(), "One video");
  await expect(row().getByTestId("contract-state")).toHaveText("Agreement sent");
  await cp.reload();
  await cp.getByTestId("sign-name").fill("Ana Alder");
  await cp.getByTestId("sign-agree").check();
  await cp.getByTestId("sign-submit").click();
  await expect(cp.getByTestId("contract-status")).toContainText("Signed by Ana Alder");
  await expect(cp.getByTestId("portal-payout")).toHaveCount(0);
  await cp.getByTestId("content-url").fill("https://social.example.test/p/1");
  await cp.getByTestId("content-submit").click();
  await expect(cp.getByTestId("portal-heading")).toContainText("is with");
  await page.reload();
  await row().getByTestId("review-approve").click();
  await expect(row().getByTestId("roster-status")).toHaveText("Content approved");
  await row().getByTestId("payout-locked").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");

  await pool.query(
    `UPDATE memberships SET role = 'viewer' WHERE user_id IN (SELECT id FROM users WHERE lower(email) = $1)`,
    [email.toLowerCase()],
  );
  await page.reload();
  await expect(page.getByTestId("contract-open")).toHaveCount(0);
  await expect(page.getByTestId("contract-withdraw")).toHaveCount(0);
  await expect(page.getByTestId("payout-locked")).toHaveCount(0);
  await expect(row().getByTestId("contract-summary")).toContainText("Agreement signed"); // they can read it
});

for (const theme of ["light", "dark"] as const) {
  test(`agreement and payout screens have no serious a11y violations (${theme})`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(360_000);
    const { slug, email } = await createUser(page, { prefix: `ctra11y${theme}` });
    await setPlan(email, "agency");
    const { campaign, ctx, cp, row } = await confirmedCampaign(page, browser, slug);
    await page.addInitScript((t) => localStorage.setItem("rw-theme", t), theme);
    await row().getByTestId("contract-open").click();
    const scan = async (p: Page, label: string) => {
      const { violations } = await new AxeBuilder({ page: p })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, `${label}: ${JSON.stringify(serious, null, 1)}`).toEqual([]);
    };
    await scan(page, "campaign with the agreement form open");
    await row().getByTestId("contract-deliverables").fill("One Reel");
    await row().getByTestId("contract-send").click();
    await expect(row().getByTestId("contract-state")).toHaveText("Agreement sent");

    await ctx.close();
    const ctx2 = await browser.newContext();
    await ctx2.addInitScript((t) => localStorage.setItem("rw-theme", t), theme);
    const link = await row().getByTestId("invite-link").inputValue();
    const cp2 = await ctx2.newPage();
    await cp2.goto(link);
    await expect(cp2.getByTestId("portal-contract")).toBeVisible();
    await scan(cp2, "creator page with an agreement to sign");
    await cp2.getByTestId("contract-ask-toggle").click();
    await scan(cp2, "creator page with the change request open");
    await cp2.getByTestId("sign-name").fill("Ana Alder");
    await cp2.getByTestId("sign-agree").check();
    await cp2.getByTestId("sign-submit").click();
    await expect(cp2.getByTestId("contract-status")).toContainText("Signed by");
    await cp2.getByTestId("content-url").fill("https://social.example.test/p/1");
    await cp2.getByTestId("content-submit").click();
    // Wait for the submission to land before the brand looks for it.
    await expect(cp2.getByTestId("portal-heading")).toContainText("is with");
    await page.goto(campaign);
    await row().getByTestId("review-approve").click();
    await expect(row().getByTestId("roster-status")).toHaveText("Content approved");
    await cp2.reload();
    await expect(cp2.getByTestId("portal-payout")).toBeVisible();
    await scan(cp2, "creator page with the payout form");
    await page.reload();
    await scan(page, "campaign with a signed agreement and a payout panel");
    await ctx2.close();
  });
}
