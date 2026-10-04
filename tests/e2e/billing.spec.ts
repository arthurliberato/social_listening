import { expect, test, type Page } from "@playwright/test";
import { runBillingLifecycle } from "../../lib/billing/lifecycle";
import { createUser, pool } from "./helpers";

test.setTimeout(150_000);

const GOOD = "4242 4242 4242 4242";
const FAILS_LATER = "4000 0000 0000 0341";
const DECLINED = "4000 0000 0000 0002";

const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows;
const polled = (email: string, name: string) =>
  expect.poll(async () => (await events(email, name)).length);
const accountOf = async (email: string) =>
  (
    await pool.query(
      `SELECT a.* FROM accounts a JOIN memberships m ON m.account_id = a.id JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1`,
      [email],
    )
  ).rows[0];
async function setRole(email: string, role: string) {
  await pool.query(
    `UPDATE memberships SET role = $2 WHERE user_id = (SELECT id FROM users WHERE lower(email) = $1)`,
    [email, role],
  );
}
async function fillCard(
  page: Page,
  number: string,
  opts: { expiry?: string; cvc?: string; name?: string } = {},
) {
  await page.getByTestId("card-name").fill(opts.name ?? "Pat Owner");
  await page.getByTestId("card-number").fill(number);
  await page.getByTestId("card-expiry").fill(opts.expiry ?? "12/30");
  await page.getByTestId("card-cvc").fill(opts.cvc ?? "123");
  await page.getByTestId("card-submit").click();
}
/** Walk the real UI: plans → choose → card → pay. */
async function subscribe(
  page: Page,
  plan: "starter" | "growth" | "agency",
  number = GOOD,
  interval: "monthly" | "yearly" = "monthly",
) {
  await page.goto("/upgrade");
  if (interval === "yearly") await page.getByTestId("interval-yearly").check({ force: true });
  await page.getByTestId(`cta-${plan}`).click();
  await page.waitForURL(/checkout/);
  await fillCard(page, number);
  await page.waitForURL(/settings\/billing\?welcome=/);
}
async function lifecycle(email: string, now: Date) {
  const a = await accountOf(email);
  return runBillingLifecycle(now, [a.id]);
}

test("pricing page: public, four plans, the yearly toggle changes the price", async ({ page }) => {
  await page.goto("/pricing");
  for (const t of ["starter", "growth", "agency", "enterprise"])
    await expect(page.getByTestId(`plan-${t}`)).toBeVisible();
  await expect(page.getByTestId("price-growth")).toContainText("$249");
  await page.getByTestId("interval-yearly").check({ force: true });
  await expect(page.getByTestId("price-growth")).toContainText("$207.50");
  await expect(page.getByTestId("plan-growth")).toContainText("$2,490 billed yearly");
  await expect(page.getByTestId("price-enterprise")).toContainText("Custom");
  await expect(page.getByTestId("cta-enterprise")).toHaveAttribute("href", /mailto:/);
  await page.getByTestId("cta-growth").click();
  await page.waitForURL(/signup/);
});

test("trial → checkout: field errors, a declined card, then a plan that works at once", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  await page.goto(`/w/${slug}/home`);
  await expect(page.getByTestId("billing-banner")).toContainText("free trial ends in 14 days");

  // Trial: the crisis room is locked.
  await page.goto(`/w/${slug}/crisis`);
  await expect(page.getByTestId("crisis-locked")).toBeVisible();

  await page.goto("/settings/billing");
  await expect(page.getByTestId("plan-name")).toHaveText("Free trial");
  await expect(page.getByTestId("no-card")).toBeVisible();
  await expect(page.getByTestId("invoices-empty")).toBeVisible();

  await page.goto("/upgrade");
  await page.getByTestId("cta-growth").click();
  await page.waitForURL(/checkout\?plan=growth&interval=monthly/);
  await expect(page.getByTestId("due-today")).toHaveText("$249");
  await polled(email, "Upgrade Started").toBe(1);
  expect((await events(email, "Upgrade Started"))[0]!.props).toMatchObject({
    to_plan: "growth",
    billing_interval: "monthly",
  });

  // Empty form: every field says what's missing.
  await page.getByTestId("card-submit").click();
  for (const f of ["name", "number", "expiry", "cvc"])
    await expect(page.getByTestId(`card-error-${f}`)).toBeVisible();
  // Bad number, expired card, declined card: each says exactly what's wrong.
  await fillCard(page, "4242 4242 4242 4241");
  await expect(page.getByTestId("card-error-number")).toContainText("doesn't look right");
  await fillCard(page, GOOD, { expiry: "01/20" });
  await expect(page.getByTestId("card-error-expiry")).toContainText("expired");
  await fillCard(page, DECLINED);
  await expect(page.getByTestId("card-error-number")).toContainText("declined");
  expect((await accountOf(email)).plan_tier).toBe("trial"); // nothing happened yet

  await fillCard(page, GOOD);
  await page.waitForURL(/settings\/billing\?welcome=growth/);
  await expect(page.getByTestId("billing-notice")).toContainText("Growth plan");
  await expect(page.getByTestId("plan-name")).toHaveText("Growth plan");
  await expect(page.getByTestId("plan-status")).toHaveText("Active");
  await expect(page.getByTestId("plan-price")).toContainText("$249 / month");
  await expect(page.getByTestId("card-on-file")).toContainText("Visa ending in 4242");
  await expect(page.getByTestId("invoice-row")).toHaveCount(1);
  await expect(page.getByTestId("invoice-row")).toContainText("Paid");
  await expect(page.getByTestId("invoice-row")).toContainText("$249");

  // The plan took effect instantly: the crisis room is open, and the trial banner is gone.
  await page.goto(`/w/${slug}/crisis`);
  await expect(page.getByTestId("crisis-locked")).toHaveCount(0);
  await expect(page.getByTestId("billing-banner")).toHaveCount(0);
  // The receipt is in the inbox and never contains the card number.
  await page.goto("/inbox");
  const receipt = page.getByTestId("inbox-message").filter({ hasText: "Receipt RW-" }).first();
  await expect(receipt).toBeVisible();
  await expect(receipt).not.toContainText("4242");
  await polled(email, "Subscription Started").toBe(1);
  expect((await events(email, "Subscription Started"))[0]!.props).toMatchObject({
    plan_tier: "growth",
    billing_interval: "monthly",
    mrr: 249,
  });
  await polled(email, "Trial Ended").toBe(1);
  expect((await events(email, "Trial Ended"))[0]!.props).toMatchObject({ converted: true });
});

test("a paywall sends you to the plan that fixes it, and says why", async ({ page }) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  const r = (
    await pool.query(
      `SELECT w.id AS ws, q.id AS q, u.id AS u FROM workspaces w JOIN queries q ON q.workspace_id = w.id JOIN users u ON u.id = q.created_by WHERE w.slug = $1 LIMIT 1`,
      [slug],
    )
  ).rows[0];
  const rule = (
    await pool.query(
      `INSERT INTO alert_rules (workspace_id, query_id, name, type, created_by) VALUES ($1,$2,'Spike','volume_spike',$3) RETURNING id`,
      [r.ws, r.q, r.u],
    )
  ).rows[0].id;
  const ev = (
    await pool.query(
      `INSERT INTO alert_events (rule_id, workspace_id, fired_at, severity, summary) VALUES ($1,$2, now(), 'warning', 'x') RETURNING id`,
      [rule, r.ws],
    )
  ).rows[0].id;
  await page.goto(`/w/${slug}/alerts/events/${ev}`);
  await page.getByTestId("start-crisis").click();
  await expect(page.getByTestId("paywall-modal")).toBeVisible();
  await page.getByTestId("paywall-upgrade").click();
  await page.waitForURL(/upgrade\?from=crisis_room&plan=growth/);
  await expect(page.getByTestId("upgrade-why")).toContainText("Crisis Rooms aren't on your plan");
  await expect(page.getByTestId("plan-growth")).toHaveAttribute("data-recommended", "true");
  await polled(email, "Upgrade Started").toBe(1);
  expect((await events(email, "Upgrade Started"))[0]!.props).toMatchObject({
    paywall_trigger: "crisis_room",
    to_plan: "growth",
  });
});

test("change plan: upgrades are prorated and instant, downgrades wait and can be taken back", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  await subscribe(page, "starter");
  await expect(page.getByTestId("plan-name")).toHaveText("Starter plan");

  await page.goto("/upgrade");
  await page.getByTestId("cta-growth").click();
  await page.waitForURL(/checkout\?plan=growth/);
  await expect(page.getByTestId("order-summary")).toContainText("Credit for the unused part");
  const due = await page.getByTestId("due-today").innerText();
  expect(due).toMatch(/^\$\d/);
  expect(Number(due.replace(/[^0-9.]/g, ""))).toBeLessThan(249);
  expect(Number(due.replace(/[^0-9.]/g, ""))).toBeGreaterThan(165);
  await page.getByTestId("confirm-change").click();
  await page.waitForURL(/settings\/billing\?changed=now/);
  await expect(page.getByTestId("plan-name")).toHaveText("Growth plan");
  await expect(page.getByTestId("invoice-row")).toHaveCount(2);
  await polled(email, "Plan Upgraded").toBe(1);

  // Downgrade waits for the renewal; the plan page says so and offers to undo it.
  await page.goto("/upgrade");
  await page.getByTestId("cta-starter").click();
  await page.waitForURL(/checkout\?plan=starter/);
  await expect(page.getByTestId("order-summary")).toContainText("Takes effect");
  await page.getByTestId("confirm-change").click();
  await page.waitForURL(/changed=scheduled/);
  await expect(page.getByTestId("plan-name")).toHaveText("Growth plan");
  await expect(page.getByTestId("pending-change")).toContainText("Starter");
  await page.getByTestId("keep-plan").click();
  await expect(page.getByTestId("pending-change")).toHaveCount(0);

  // A downgrade that doesn't fit names exactly what to fix, and nothing is scheduled.
  const a = await accountOf(email);
  const q = (
    await pool.query(
      `SELECT workspace_id, created_by FROM queries WHERE workspace_id = (SELECT id FROM workspaces WHERE slug = $1) LIMIT 1`,
      [slug],
    )
  ).rows[0];
  for (let i = 0; i < 4; i++)
    await pool.query(
      `INSERT INTO queries (workspace_id, name, boolean_text, status, backfill_status, released_through, created_by) VALUES ($1,$2,'zzqqxx','live','done',now(),$3)`,
      [q.workspace_id, `Extra ${i}`, q.created_by],
    );
  await page.goto("/settings/billing/checkout?plan=starter&interval=monthly");
  await expect(page.getByTestId("blockers")).toContainText("Pause 2 active queries");
  await expect(page.getByTestId("confirm-change")).toHaveCount(0);
  void a;
});

test("cancelling takes three steps from Billing, offers a discount once, and can be undone", async ({
  page,
}) => {
  const { email } = await createUser(page, { brand: "Latte Lane" });
  await subscribe(page, "growth");

  await page.getByTestId("cancel-plan").click(); // step 1: Cancel plan
  await page.waitForURL(/billing\/cancel/);
  await polled(email, "Cancellation Started").toBe(1);
  await page.getByTestId("reason-continue").click(); // step 2 needs a reason
  await expect(page.getByTestId("reason-error")).toBeVisible();
  await page.getByTestId("reason-too_expensive").check();
  await page.getByTestId("reason-continue").click();
  await expect(page.getByTestId("cancel-confirm")).toBeVisible(); // step 3: confirm
  await expect(page.getByTestId("save-offer")).toContainText("25%");
  await polled(email, "Cancellation Reason Submitted").toBe(1);
  await page.getByTestId("confirm-cancel").click();
  await expect(page.getByTestId("cancel-done")).toBeVisible();
  await polled(email, "Subscription Canceled").toBe(1);
  expect((await events(email, "Subscription Canceled"))[0]!.props).toMatchObject({
    reason: "too_expensive",
  });

  await page.getByTestId("back-to-billing").click();
  await expect(page.getByTestId("cancel-pending")).toContainText("full access until");
  await expect(page.getByTestId("plan-next-charge")).toHaveText("None");
  await expect(page.getByTestId("cancel-plan")).toHaveCount(0);
  await page.getByTestId("resume-plan").click();
  await expect(page.getByTestId("cancel-pending")).toHaveCount(0);
  await expect(page.getByTestId("plan-next-charge")).toHaveText("$249");

  // Second time round: no second offer.
  await page.getByTestId("cancel-plan").click();
  await page.getByTestId("reason-not_using").check();
  await page.getByTestId("reason-continue").click();
  await expect(page.getByTestId("cancel-confirm")).toBeVisible();
  await expect(page.getByTestId("save-offer")).toHaveCount(0);
  // And "Keep my plan" is as easy to reach as "Cancel my plan".
  await expect(page.getByTestId("keep-plan-link")).toBeVisible();
});

test("accepting the save offer discounts the next renewals", async ({ page }) => {
  await createUser(page, { brand: "Latte Lane" });
  await subscribe(page, "growth");
  await page.goto("/settings/billing/cancel");
  await page.getByTestId("reason-too_expensive").check();
  await page.getByTestId("reason-continue").click();
  await page.getByTestId("accept-offer").click();
  await expect(page.getByTestId("offer-accepted")).toBeVisible();
  await page.goto("/settings/billing");
  await expect(page.getByTestId("plan-next-charge")).toContainText("$186.75");
  await expect(page.getByTestId("plan-next-charge")).toContainText("25% off, 2 renewals left");
  await expect(page.getByTestId("cancel-pending")).toHaveCount(0);
});

test("a failed renewal: warning, retries, and fixing the card brings everything back", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  await subscribe(page, "growth", FAILS_LATER);
  const a = await accountOf(email);
  const due = new Date(a.current_period_end).getTime();

  expect((await runBillingLifecycle(new Date(due + 60_000), [a.id])).map((x) => x.action)).toEqual([
    "renewal_failed",
  ]);
  await page.goto(`/w/${slug}/home`);
  await expect(page.getByTestId("billing-banner")).toContainText("couldn't charge your card");
  await expect(page.getByTestId("billing-banner")).toHaveAttribute("data-status", "past_due");
  await polled(email, "Payment Failed").toBe(1);
  // Access continues while we retry.
  await page.goto(`/w/${slug}/alerts/new`);
  await expect(page.getByTestId("save-alert")).toBeVisible();

  await page.getByTestId("nav-billing").click();
  await expect(page.getByTestId("plan-status")).toHaveText("Payment failed");
  await expect(page.getByTestId("invoice-row").filter({ hasText: "Failed" })).toBeVisible();
  await expect(page.getByTestId("invoice-row").filter({ hasText: "declined" })).toBeVisible();
  // The card form is already open; fix it with a card that works.
  await page.getByTestId("card-name").fill("Pat Owner");
  await page.getByTestId("card-number").fill(DECLINED);
  await page.getByTestId("card-expiry").fill("12/30");
  await page.getByTestId("card-cvc").fill("123");
  await page.getByTestId("card-submit").click();
  await expect(page.getByTestId("card-error-number")).toContainText("declined");
  await page.getByTestId("card-number").fill(GOOD);
  await page.getByTestId("card-submit").click();
  await expect(page.getByTestId("plan-status")).toHaveText("Active");
  await expect(page.getByTestId("card-on-file")).toContainText("4242");
  await page.goto(`/w/${slug}/home`);
  await expect(page.getByTestId("billing-banner")).toHaveCount(0);
});

test("the clock runs a trial to its end: grace, then read-only, then a plan brings it back", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  const a = await accountOf(email);
  const T = new Date(a.trial_end_at).getTime();

  expect(
    (await runBillingLifecycle(new Date(T - 2 * 86_400_000), [a.id])).map((x) => x.action),
  ).toEqual(["trial_reminder_3d"]);
  await pool.query(`SELECT 1`);
  expect((await runBillingLifecycle(new Date(T + 60_000), [a.id])).map((x) => x.action)).toEqual([
    "trial_ended",
  ]);
  await page.goto(`/w/${slug}/home`);
  await expect(page.getByTestId("billing-banner")).toContainText("Your trial has ended");
  await page.goto(`/w/${slug}/queries`);
  await expect(page.getByTestId("new-query")).toBeVisible(); // grace: still fully usable

  expect(
    (await runBillingLifecycle(new Date(T + 4 * 86_400_000), [a.id])).map((x) => x.action),
  ).toEqual(["locked_trial"]);
  await page.goto(`/w/${slug}/queries`);
  await expect(page.getByTestId("billing-banner")).toContainText("read-only");
  await expect(page.getByTestId("billing-banner")).toHaveAttribute("data-status", "locked");
  await expect(page.getByTestId("new-query")).toHaveCount(0); // writes are off...
  await page.goto(`/w/${slug}/mentions`);
  await expect(page.getByTestId("mention-card").first()).toBeVisible({ timeout: 45_000 }); // ...reading still works
  await page.goto(`/w/${slug}/exports`);
  await expect(page.getByTestId("export-form")).toBeVisible(); // ...and so does taking your data with you

  await page.goto(`/w/${slug}/queries`);
  await page.getByTestId("billing-banner-link").click();
  await page.waitForURL(/upgrade\?from=locked/);
  await page.getByTestId("cta-starter").click();
  await fillCard(page, GOOD);
  await page.waitForURL(/welcome=starter/);
  await page.goto(`/w/${slug}/queries`);
  await expect(page.getByTestId("billing-banner")).toHaveCount(0);
  await expect(page.getByTestId("new-query")).toBeVisible();
});

test("usage meters show every limit; billing is for owners and admins only", async ({ page }) => {
  const { email } = await createUser(page, { brand: "Latte Lane" });
  await page.goto("/settings/usage");
  await expect(page.getByTestId("meters").getByRole("listitem")).toHaveCount(6);
  await expect(page.getByTestId("meter-queries")).toContainText("of 3");
  await expect(page.getByTestId("meter-alerts")).toContainText("of 2");
  await expect(page.getByTestId("meter-seats")).toContainText("of 2");
  await expect(page.getByTestId("meter-mentions").getByRole("progressbar")).toBeVisible();
  // Push mentions over 80%: the meter says so and offers plans.
  const a = await accountOf(email);
  await pool.query(
    `INSERT INTO usage_counters (account_id, period, metric, value) VALUES ($1, to_char(now(), 'YYYY-MM'), 'mentions', 4500) ON CONFLICT (account_id, period, metric) DO UPDATE SET value = 4500`,
    [a.id],
  );
  await page.reload();
  await expect(page.getByTestId("meter-mentions")).toContainText("Almost full");
  await page.getByTestId("meter-mentions").getByTestId("meter-upgrade").click();
  await page.waitForURL(/upgrade\?from=mention_quota/);
  await expect(page.getByTestId("upgrade-why")).toContainText("mentions");

  await setRole(email, "viewer");
  await page.goto("/settings/billing");
  await expect(page.getByTestId("billing-forbidden")).toBeVisible();
  await page.goto("/settings/billing/checkout?plan=growth&interval=monthly");
  await expect(page.getByTestId("billing-forbidden")).toBeVisible();
  await page.goto("/settings/usage");
  await expect(page.getByTestId("meters")).toBeVisible(); // everyone can see usage
  await page.goto("/upgrade");
  await expect(page.getByTestId("cta-growth")).toContainText("Ask a workspace owner");
});
