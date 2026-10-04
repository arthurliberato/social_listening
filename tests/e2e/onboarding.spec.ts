import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://ripplewise:ripplewise@localhost:5432/ripplewise",
});
test.afterAll(() => pool.end());

const PASSWORD = "correct horse battery staple";

async function signUp(page: Page, email: string) {
  await page.goto("/signup?utm_source=e2e&utm_campaign=m2");
  await page.getByTestId("signup-name").fill("Priya Analyst");
  await page.getByTestId("signup-email").fill(email);
  await page.getByTestId("signup-company").fill(`E2E Co ${Date.now()}`);
  await page.getByTestId("signup-password").fill(PASSWORD);
  await page.getByTestId("signup-submit").click();
  await page.waitForURL("**/verify");
}

async function verifyViaInbox(page: Page) {
  await page.goto("/inbox");
  const msg = page.getByTestId("inbox-message").filter({ hasText: "Verify your email" }).first();
  await expect(msg).toBeVisible();
  const link = await msg.locator("a").first().getAttribute("href");
  expect(link).toContain("/verify?token=");
  await page.goto(link!);
  await page.waitForURL("**/onboarding");
}

async function eventsFor(email: string, deviceId: string) {
  const { rows } = await pool.query(
    `SELECT e.name FROM analytics_events e LEFT JOIN users u ON u.id = e.user_id
     WHERE lower(u.email) = $1 OR e.device_id = $2 ORDER BY e.id`,
    [email, deviceId],
  );
  return rows.map((r) => r.name as string);
}

test("signup → verify → wizard → home, with events in order", async ({ page, context }) => {
  const email = `e2e-${Date.now()}@example.test`;
  await signUp(page, email);
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  await verifyViaInbox(page);

  // Step 1 role (required)
  await expect(page.getByTestId("onboarding-progress")).toHaveText("Step 1 of 5");
  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("onboarding-error")).toBeVisible();
  await page.getByTestId("role-analyst").check();
  await page.getByTestId("onboarding-next").click();
  // Step 2 goals (optional)
  await page.getByTestId("goal-brand_monitoring").check();
  await page.getByTestId("onboarding-next").click();
  // Step 3 brand
  await page.getByTestId("brand-name").fill("Juniper Roast");
  await page.getByTestId("brand-handles").fill("@juniperroast");
  await page.getByTestId("competitor-input").fill("Brewline");
  await page.getByTestId("competitor-input").press("Enter");
  await page.getByTestId("onboarding-next").click();
  // Step 4 generated query + live estimate
  await expect(page.getByTestId("generated-query")).toContainText('"Juniper Roast"');
  await expect(page.getByTestId("generated-query")).toContainText("NOT (job OR hiring)");
  await expect(page.getByTestId("query-estimate")).toBeVisible();
  const est = Number(
    (await page.getByTestId("query-estimate").locator("strong").innerText()).replace(/,/g, ""),
  );
  expect(est).toBeGreaterThan(0);
  await page.getByTestId("onboarding-next").click();
  // Step 5 invite (skip)
  await page.getByTestId("onboarding-skip").click();

  await page.waitForURL("**/home");
  await expect(page.getByTestId("checklist-progress")).toHaveText("2 of 5"); // query + exclusion
  await expect(page.getByTestId("home-query")).toContainText("Juniper Roast");
  await expect(page.getByTestId("trial-banner")).toContainText("14 days");

  // Attribution captured at sign-up.
  const { rows } = await pool.query(
    `SELECT attribution, role_selected FROM users WHERE lower(email) = $1`,
    [email],
  );
  expect(rows[0].attribution).toMatchObject({ utm_source: "e2e", utm_campaign: "m2" });
  expect(rows[0].role_selected).toBe("analyst");

  // Events: ordered subsequence (client beacons are async, so poll briefly).
  const did = (await context.cookies()).find((c) => c.name === "rw_did")?.value ?? "";
  const expected = [
    "Sign Up Started",
    "Sign Up Completed",
    "Email Verified",
    "Onboarding Step Completed",
    "Query Saved",
    "Checklist Item Completed",
    "Onboarding Completed",
    "Dashboard Viewed",
  ];
  await expect
    .poll(
      async () => {
        const names = await eventsFor(email, did);
        let i = 0;
        for (const n of names) if (n === expected[i]) i++;
        return i;
      },
      { timeout: 10_000 },
    )
    .toBe(expected.length);
  const names = await eventsFor(email, did);
  expect(names.filter((n) => n === "Onboarding Step Viewed").length).toBeGreaterThanOrEqual(5);
});

test("bad credentials show an error and record Login Failed; no account enumeration", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill("nobody@example.test");
  await page.getByTestId("login-password").fill("wrong-password-123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toContainText("don't match");
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            `SELECT 1 FROM analytics_events WHERE name = 'Login Failed' AND props->>'error_type' = 'unknown_email' AND ts > now() - interval '1 minute'`,
          )
        ).rowCount,
    )
    .toBeGreaterThan(0);
});

test("protected routes redirect to login; invalid verify token explains itself", async ({
  page,
}) => {
  await page.goto("/w/anything/home");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/verify?token=nope");
  await expect(page.getByRole("alert").filter({ hasText: "expired" })).toBeVisible();
});

test("duplicate email is rejected with a path to log in", async ({ page }) => {
  const email = `dup-${Date.now()}@example.test`;
  await signUp(page, email);
  await page.context().clearCookies();
  await page.goto("/signup");
  await page.getByTestId("signup-name").fill("Again");
  await page.getByTestId("signup-email").fill(email);
  await page.getByTestId("signup-company").fill("Dup Co");
  await page.getByTestId("signup-password").fill(PASSWORD);
  await page.getByTestId("signup-submit").click();
  await expect(page.getByText("already exists")).toBeVisible();
});

test("invites respect the trial seat limit and can be accepted", async ({ page, browser }) => {
  const owner = `owner-${Date.now()}@example.test`;
  const invitee = `invitee-${Date.now()}@example.test`;
  await signUp(page, owner);
  await verifyViaInbox(page);
  await page.getByTestId("role-admin").check();
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-skip").click();
  await page.getByTestId("brand-name").fill("Brewline");
  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("query-estimate")).toBeVisible();
  await page.getByTestId("onboarding-next").click();

  // Trial = 2 seats (owner + 1). Two invites exceed it: the first goes out, the second hits the paywall.
  await page.getByTestId("invite-email").fill(`${invitee}, extra-${Date.now()}@example.test`);
  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("onboarding-error")).toContainText("2 seats");
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            `SELECT 1 FROM analytics_events WHERE name = 'Paywall Viewed' AND props->>'paywall_trigger' = 'seat_limit' AND ts > now() - interval '1 minute'`,
          )
        ).rowCount,
    )
    .toBeGreaterThan(0);

  // The invitee follows the emailed link, joins the owner's workspace and skips onboarding.
  const { rows } = await pool.query(
    `SELECT body_text FROM emails WHERE to_address = $1 AND type = 'invite'`,
    [invitee],
  );
  const link = /(http:\/\/\S+\/invite\/\S+)/.exec(rows[0].body_text)![1]!;
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(link);
  await p2.getByTestId("invite-signup").click(); // the invitation page: new address, so create an account
  await expect(p2.getByTestId("signup-email")).toHaveValue(invitee);
  await p2.getByTestId("signup-name").fill("Invited Teammate");
  await p2.getByTestId("signup-password").fill(PASSWORD);
  await p2.getByTestId("signup-submit").click();
  await p2.waitForURL("**/w/*/home");
  await ctx.close();
  const m = await pool.query(
    `SELECT count(*)::int AS n FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1 AND m.role = 'editor'`,
    [invitee],
  );
  expect(m.rows[0].n).toBe(1);
});
