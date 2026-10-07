import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { createUser, pool } from "./helpers";

const setPlan = (email: string, tier: string) =>
  pool.query(
    `UPDATE accounts SET plan_tier = $2 WHERE id IN (SELECT m.account_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1)`,
    [email.toLowerCase(), tier],
  );

/** A campaign with `n` creators from a list, built through the UI. */
async function campaignWith(page: Page, slug: string, n: number, name = "Outreach test") {
  await page.goto(`/w/${slug}/creators`);
  for (let i = 0; i < n; i++) {
    await page.getByTestId("add-to-list").nth(i).click();
    if (i === 0) await page.getByTestId("new-list-name").fill("Outreach picks");
    else await page.getByLabel("Outreach picks").check();
    await page.getByTestId("add-to-list-confirm").click();
    await expect(page.getByTestId("add-to-list-status").nth(i)).toContainText("Added");
  }
  await page.goto(`/w/${slug}/creators/campaigns`);
  await page.getByTestId("campaign-name").fill(name);
  await page.getByTestId("campaign-budget").fill("5000");
  await page.getByTestId("campaign-create").click();
  await page.waitForURL(/campaigns\/[0-9a-f-]{36}/);
  await page.getByTestId("add-from-list-submit").click();
  await expect(page.getByTestId("roster-row")).toHaveCount(n);
  return new URL(page.url()).pathname;
}

async function sendInvite(row: Locator, offer?: string) {
  await row.getByTestId("invite-open").click();
  if (offer) await row.getByTestId("invite-offer").fill(offer);
  await row.getByTestId("invite-send").click();
  await expect(row.getByTestId("roster-status")).toHaveText("Invited");
  return row.getByTestId("invite-link").inputValue();
}

/** The creator opens their link in their own browser, signed in as nobody. */
async function asCreator(browser: Browser, link: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(link);
  await expect(page.getByTestId("portal")).toBeVisible();
  return { ctx, page };
}

test("invite, accept, submit content, request changes, resubmit, approve, pay: both sides stay in step", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const { slug, email } = await createUser(page, { prefix: "out" });
  await setPlan(email, "growth");
  const campaign = await campaignWith(page, slug, 1);
  const row = page.getByTestId("roster-row").first();
  const link = await sendInvite(row, "800");
  expect(link).toMatch(/\/creator\/[0-9a-f]{48}$/);
  await expect(row.getByTestId("invite-status")).toHaveText("Invitation sent");

  // The creator got an email too, addressed to them rather than to a user.
  const mail = await pool.query(
    `SELECT subject, body_text FROM emails WHERE type = 'outreach' AND to_address LIKE '%@creators.example.test' AND body_text LIKE $1`,
    [`%${link}%`],
  );
  expect(mail.rows).toHaveLength(1);
  expect(mail.rows[0].body_text).toContain("$800");

  const { ctx, page: cp } = await asCreator(browser, link);
  await expect(cp.getByTestId("portal-heading")).toContainText("invited you");
  await expect(cp.getByTestId("portal-fee")).toHaveText("$800");
  // The creator never sees the brand's budget or other creators.
  await expect(cp.locator("body")).not.toContainText("5,000");
  await cp.getByTestId("portal-accept").click();
  await expect(cp.getByTestId("portal-heading")).toHaveText("You're confirmed");

  // The brand's page follows after a reload (and by email).
  await page.reload();
  const r1 = page.getByTestId("roster-row").first();
  await expect(r1.getByTestId("roster-status")).toHaveText("Confirmed");
  await expect(r1.getByTestId("invite-status")).toHaveText("Offer accepted");
  await expect(page.getByTestId("budget-committed")).toHaveText("$800");
  const note = await pool.query(
    `SELECT subject FROM emails WHERE type = 'outreach' AND to_user_id IS NOT NULL AND subject LIKE '%accepted%'`,
  );
  expect(note.rows.length).toBeGreaterThanOrEqual(1);

  // Content: a bad link is refused, a good one goes for review.
  await cp.getByTestId("content-url").fill("not a link");
  await cp.getByTestId("content-submit").click();
  await expect(cp.getByTestId("portal-error")).toContainText("full link");
  await cp.getByTestId("content-url").fill("https://social.example.test/p/launch-1");
  await cp.getByTestId("content-caption").fill("Loving this #ad");
  await cp.getByTestId("content-submit").click();
  await expect(cp.getByTestId("portal-heading")).toContainText("is with");

  await page.reload();
  const r2 = page.getByTestId("roster-row").first();
  await expect(r2.getByTestId("review-url")).toHaveText("https://social.example.test/p/launch-1");
  await r2.getByTestId("review-changes").click();
  await r2.getByTestId("review-changes-send").click(); // no feedback yet
  await expect(r2.getByTestId("outreach-error")).toContainText("what needs to change");
  await r2.getByTestId("review-feedback").fill("Please show the product in the first seconds");
  await r2.getByTestId("review-changes-send").click();
  await expect(r2.getByTestId("roster-status")).toHaveText("Confirmed");
  await expect(r2.getByTestId("awaiting-resubmission")).toBeVisible();

  await cp.reload();
  await expect(cp.getByTestId("portal-feedback")).toContainText("first seconds");
  await cp.getByTestId("content-url").fill("https://social.example.test/p/launch-2");
  await cp.getByTestId("content-submit").click();
  await expect(cp.getByTestId("portal-versions").getByRole("listitem")).toHaveCount(2);

  await page.reload();
  const r3 = page.getByTestId("roster-row").first();
  await expect(r3.getByTestId("review-url")).toHaveText("https://social.example.test/p/launch-2");
  await r3.getByTestId("review-approve").click();
  await expect(r3.getByTestId("roster-status")).toHaveText("Content approved");
  await cp.reload();
  await expect(cp.getByTestId("portal-approved")).toBeVisible();

  await r3.getByTestId("move-paid").click();
  await expect(r3.getByTestId("roster-status")).toHaveText("Paid");
  await cp.reload();
  await expect(cp.getByTestId("portal-paid")).toContainText("$800");
  const paid = await pool.query(
    `SELECT 1 FROM emails WHERE type = 'outreach' AND to_address LIKE '%@creators.example.test' AND subject LIKE 'Payment sent%'`,
  );
  expect(paid.rows.length).toBeGreaterThanOrEqual(1);
  await ctx.close();
  expect(campaign).toMatch(/campaigns\//);
});

test("a counter-offer can be accepted, or answered with a revised offer that replaces the old link", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const { slug, email } = await createUser(page, { prefix: "ctr" });
  await setPlan(email, "growth");
  await campaignWith(page, slug, 2);
  const a = page.getByTestId("roster-row").nth(0);
  const b = page.getByTestId("roster-row").nth(1);
  const linkA = await sendInvite(a, "500");
  const linkB = await sendInvite(b, "500");

  // A counters; the brand accepts the counter.
  const ca = await asCreator(browser, linkA);
  await ca.page.getByTestId("portal-counter-toggle").click();
  await ca.page.getByTestId("counter-amount").fill("500");
  await ca.page.getByTestId("counter-submit").click();
  await expect(ca.page.getByTestId("portal-error")).toContainText("already offered");
  await ca.page.getByTestId("counter-amount").fill("650");
  await ca.page.getByTestId("counter-note").fill("My rate for video is higher");
  await ca.page.getByTestId("counter-submit").click();
  await expect(ca.page.getByTestId("portal-countered")).toContainText("$650");

  // B counters; the brand sends a revised offer.
  const cb = await asCreator(browser, linkB);
  await cb.page.getByTestId("portal-counter-toggle").click();
  await cb.page.getByTestId("counter-amount").fill("900");
  await cb.page.getByTestId("counter-submit").click();
  await expect(cb.page.getByTestId("portal-countered")).toBeVisible();

  await page.reload();
  const ra = page.getByTestId("roster-row").nth(0);
  const rb = page.getByTestId("roster-row").nth(1);
  await expect(ra.getByTestId("counter-amount-shown")).toHaveText("$650");
  await expect(ra.getByTestId("counter-panel")).toContainText("My rate for video is higher");
  await ra.getByTestId("counter-accept").click();
  await expect(ra.getByTestId("roster-status")).toHaveText("Confirmed");
  await expect(ra.getByTestId("counter-panel")).toHaveCount(0);
  await ca.page.reload();
  await expect(ca.page.getByTestId("portal-heading")).toHaveText("You're confirmed");
  await expect(ca.page.getByTestId("portal-fee")).toHaveText("$650");

  await rb.getByTestId("counter-revise").click();
  await rb.getByTestId("invite-offer").fill("750");
  await rb.getByTestId("invite-send").click();
  await expect(rb.getByTestId("invite-status")).toHaveText("Invitation sent");
  const newLink = await rb.getByTestId("invite-link").inputValue();
  expect(newLink).not.toBe(linkB);
  await cb.page.reload();
  await expect(cb.page.getByTestId("portal-heading")).toHaveText("There's a newer offer for you");
  await cb.page.goto(newLink);
  await cb.page.getByTestId("portal-accept").click();
  await expect(cb.page.getByTestId("portal-fee")).toHaveText("$750");
  await page.reload();
  await expect(page.getByTestId("budget-committed")).toHaveText("$1,400");
  await ca.ctx.close();
  await cb.ctx.close();
});

test("declining, expiry, withdrawal and a bad link all end somewhere sensible", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const { slug, email } = await createUser(page, { prefix: "dec" });
  await setPlan(email, "growth");
  await campaignWith(page, slug, 3);
  const rows = [0, 1, 2].map((i) => page.getByTestId("roster-row").nth(i));
  const links = [
    await sendInvite(rows[0]!),
    await sendInvite(rows[1]!),
    await sendInvite(rows[2]!),
  ];

  // Decline needs a second, deliberate step.
  const d = await asCreator(browser, links[0]!);
  await d.page.getByTestId("portal-decline").click();
  await expect(d.page.getByRole("group", { name: "Confirm decline" })).toBeVisible();
  await d.page.getByTestId("decline-confirm").click();
  await expect(d.page.getByTestId("portal-heading")).toHaveText("This invitation was declined");
  await page.reload();
  await expect(page.getByTestId("roster-row").nth(0).getByTestId("roster-status")).toHaveText(
    "Declined",
  );

  // Expired: the creator can't answer; the brand can send a new invitation.
  await pool.query(
    `UPDATE campaign_invites SET expires_at = now() - interval '1 day' WHERE token = $1`,
    [links[1]!.split("/").pop()],
  );
  const e = await asCreator(browser, links[1]!);
  await expect(e.page.getByTestId("portal-heading")).toHaveText("This invitation has expired");
  await expect(e.page.getByTestId("portal-accept")).toHaveCount(0);
  await page.reload();
  const r1 = page.getByTestId("roster-row").nth(1);
  await expect(r1.getByTestId("invite-status")).toHaveText("Invitation expired");
  await r1.getByTestId("invite-revise").click();
  await r1.getByTestId("invite-send").click();
  await expect(r1.getByTestId("invite-link")).not.toHaveValue(links[1]!);

  // Withdrawn.
  const r2 = page.getByTestId("roster-row").nth(2);
  await r2.getByTestId("invite-withdraw").click();
  await expect(r2.getByTestId("roster-status")).toHaveText("Shortlisted");
  const w = await asCreator(browser, links[2]!);
  await expect(w.page.getByTestId("portal-heading")).toHaveText("This invitation was withdrawn");

  // A made-up link tells the visitor nothing about who or what exists.
  const x = await browser.newContext();
  const xp = await x.newPage();
  await xp.goto(`${new URL(links[0]!).origin}/creator/${"0".repeat(48)}`);
  await expect(xp.getByTestId("portal-missing")).toBeVisible();
  await xp.goto(`${new URL(links[0]!).origin}/creator/nonsense`);
  await expect(xp.getByTestId("portal-missing")).toBeVisible();
  await Promise.all([d.ctx.close(), e.ctx.close(), w.ctx.close(), x.close()]);
});

test("the monthly invitation allowance is a paywall, and viewers can't invite", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const { slug, email } = await createUser(page, { prefix: "quota" });
  await campaignWith(page, slug, 1);
  const acct = (
    await pool.query(
      `SELECT m.account_id AS id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1`,
      [email.toLowerCase()],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO usage_counters (account_id, period, metric, value) VALUES ($1, to_char(now(), 'YYYY-MM'), 'creator_invites', 5) ON CONFLICT (account_id, period, metric) DO UPDATE SET value = 5`,
    [acct],
  );
  await page.reload();
  const row = page.getByTestId("roster-row").first();
  await row.getByTestId("invite-open").click();
  await expect(row.getByTestId("invite-quota")).toContainText("5 of 5");
  await row.getByTestId("invite-send").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row.getByTestId("roster-status")).toHaveText("Shortlisted");

  await pool.query(
    `UPDATE memberships SET role = 'viewer' WHERE user_id IN (SELECT id FROM users WHERE lower(email) = $1)`,
    [email.toLowerCase()],
  );
  await page.reload();
  await expect(page.getByTestId("invite-open")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`the creator's page and the outreach controls have no serious a11y violations (${theme})`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const { slug, email } = await createUser(page, { prefix: `outa11y${theme}` });
    await setPlan(email, "growth");
    const campaign = await campaignWith(page, slug, 1);
    const row = page.getByTestId("roster-row").first();
    await row.getByTestId("invite-open").click();
    await page.addInitScript((t) => localStorage.setItem("rw-theme", t), theme);
    await row.getByTestId("invite-send").click();
    const link = await row.getByTestId("invite-link").inputValue();
    const scan = async (p: Page, label: string) => {
      const { violations } = await new AxeBuilder({ page: p })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, `${label}: ${JSON.stringify(serious, null, 1)}`).toEqual([]);
    };
    await page.goto(campaign);
    await expect(page.getByTestId("invite-link")).toBeVisible();
    await scan(page, "campaign with invitation");

    const ctx = await browser.newContext();
    await ctx.addInitScript((t) => localStorage.setItem("rw-theme", t), theme);
    const cp = await ctx.newPage();
    await cp.goto(link);
    await expect(cp.getByTestId("portal")).toBeVisible();
    await scan(cp, "portal: open");
    await cp.getByTestId("portal-counter-toggle").click();
    await expect(cp.getByTestId("counter-amount")).toBeVisible();
    await scan(cp, "portal: counter form");
    await cp.getByTestId("counter-amount").fill("1200");
    await cp.getByTestId("counter-submit").click();
    await expect(cp.getByTestId("portal-countered")).toBeVisible();
    await scan(cp, "portal: countered");
    await ctx.close();
  });
}
