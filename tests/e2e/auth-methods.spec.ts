import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createUser, PASSWORD, pool } from "./helpers";

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
const mail = async (email: string, like: string) =>
  (
    await pool.query(
      `SELECT body_text FROM emails WHERE lower(to_address) = $1 AND subject LIKE $2 ORDER BY created_at DESC`,
      [email, like],
    )
  ).rows.map((r) => r.body_text as string);
const link = (body: string) =>
  /(https?:\/\/[^\s]+)/.exec(body)![1]!.replace(/^https?:\/\/[^/]+/, "");
const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows.map((r) => r.props as Record<string, unknown>);
async function openLogin(page: Page, qs = "") {
  await page.goto(`/login${qs}`);
  await expect(page.getByTestId("login-email")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

test("forgot password: one answer for everyone, a single-use link, and old sessions are signed out", async ({
  page,
  browser,
}) => {
  const { email, slug } = await createUser(page, { prefix: "rst" });
  const ctx = await browser.newContext();
  const p = await ctx.newPage();

  await p.goto("/forgot");
  await expect(p.getByTestId("forgot-email")).toBeVisible({ timeout: 30_000 });
  await p.waitForLoadState("networkidle");
  await scan(p);
  // An address with no account gets the very same page.
  await p.getByTestId("forgot-email").fill(`ghost-${Date.now()}@example.test`);
  await p.getByTestId("forgot-submit").click();
  await expect(p.getByTestId("forgot-sent")).toBeVisible({ timeout: 20_000 });
  await p.goto("/forgot");
  await p.waitForLoadState("networkidle");
  await p.getByTestId("forgot-email").fill(email.toUpperCase());
  await p.getByTestId("forgot-submit").click();
  await expect(p.getByTestId("forgot-sent")).toContainText("we've sent a link");
  await expect.poll(async () => (await mail(email, "Reset your%")).length).toBe(1);
  await expect.poll(async () => (await events(email, "Password Reset Requested")).length).toBe(0); // anonymous: no user to attribute

  const url = link((await mail(email, "Reset your%"))[0]!);
  await p.goto(url);
  await p.waitForLoadState("networkidle");
  await scan(p);
  await p.getByTestId("reset-password").fill("short");
  await p.getByTestId("reset-submit").click();
  // The browser stops a too-short password before it is sent (the server enforces the same rule).
  await expect(p.getByTestId("reset-password")).toHaveJSProperty("validity.tooShort", true);
  await expect(p.getByTestId("reset-form")).toBeVisible();
  await p.getByTestId("reset-password").fill("a brand new passphrase");
  await p.getByTestId("reset-submit").click();
  await p.waitForURL(/login\?reset=1/);
  await expect(p.getByTestId("reset-done")).toBeVisible();

  // The link can't be used again.
  await p.goto(url);
  await expect(p.getByTestId("reset-expired")).toBeVisible();

  // Old password fails; new password works.
  await openLogin(p);
  await p.getByTestId("login-email").fill(email);
  await p.getByTestId("login-password").fill(PASSWORD);
  await p.getByTestId("login-submit").click();
  await expect(p.getByTestId("login-error")).toBeVisible({ timeout: 20_000 });
  await p.getByTestId("login-password").fill("a brand new passphrase");
  await p.getByTestId("login-submit").click();
  await p.waitForURL(/\/w\/.+\/home/, { timeout: 30_000 });
  await ctx.close();

  // The session that was open before the change is signed out.
  await page.goto(`/w/${slug}/home`);
  await page.waitForURL(/\/login/, { timeout: 30_000 });
  expect(await mail(email, "Your Ripplewise password was changed")).toHaveLength(1);
});

test("magic link: emailed once, confirmed with a click, and used up", async ({ page, browser }) => {
  const { email } = await createUser(page, { prefix: "mag" });
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await openLogin(p, "?next=%2Fsettings%2Fusage");
  await p.getByTestId("magic-details").locator("summary").click();
  await p.getByTestId("magic-email").fill(email);
  await p.getByTestId("magic-submit").click();
  await expect(p.getByTestId("magic-sent")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await mail(email, "Your Ripplewise login link")).length).toBe(1);
  const url = link((await mail(email, "Your Ripplewise login link"))[0]!);
  expect(url).toContain("next=%2Fsettings%2Fusage");

  // Opening the link (what a mail scanner does) logs nobody in; only the click does.
  await p.goto(url);
  await p.waitForLoadState("networkidle");
  await scan(p);
  expect(p.url()).toContain("/login/magic");
  await p.getByTestId("magic-login").click();
  await p.waitForURL(/settings\/usage/, { timeout: 30_000 });
  await expect
    .poll(async () =>
      (await events(email, "Login Completed")).some((e) => e.method === "magic_link"),
    )
    .toBe(true);

  const ctx2 = await browser.newContext();
  const q = await ctx2.newPage();
  await q.goto(url);
  await expect(q.getByTestId("magic-expired")).toBeVisible();
  await ctx.close();
  await ctx2.close();
});

test("Northstar ID (simulated): sign up, sign back in, and the boundaries hold", async ({
  page,
  browser,
}) => {
  const name = `star${Date.now().toString(36)}`;
  const email = `${name}@northstar-id.test`;
  await openLogin(page);
  await scan(page);
  await page.getByTestId("oauth-northstar").click();
  await page.waitForURL(/oauth\/northstar\/authorize/);
  await expect(page.getByTestId("ns-banner")).toContainText("Simulated identity provider");
  await page.waitForLoadState("networkidle");
  await scan(page);
  await page.getByTestId("ns-username").fill("ab");
  await page.getByTestId("ns-allow").click();
  await expect(page.getByTestId("ns-error")).toBeVisible();
  await page.getByTestId("ns-username").fill(name);
  await page.getByTestId("ns-name").fill("Star Person");
  await page.getByTestId("ns-allow").click();
  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
  const u = (
    await pool.query(`SELECT oauth_provider, email_verified_at FROM users WHERE email = $1`, [
      email,
    ])
  ).rows[0];
  expect(u.oauth_provider).toBe("northstar");
  expect(u.email_verified_at).not.toBeNull();
  await expect
    .poll(async () =>
      (await events(email, "Sign Up Completed")).some((e) => e.method === "oauth_northstar"),
    )
    .toBe(true);

  // A fresh browser signs back in to the same account.
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto("/oauth/northstar/start");
  await p.getByTestId("ns-username").fill(name);
  await p.getByTestId("ns-allow").click();
  await p.waitForURL((u) => !/oauth|login/.test(u.pathname), { timeout: 30_000 });
  expect(
    (await pool.query(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [email])).rows[0].n,
  ).toBe(1);
  await expect
    .poll(async () =>
      (await events(email, "Login Completed")).some((e) => e.method === "oauth_northstar"),
    )
    .toBe(true);

  // Cancel returns to login with a message.
  await p.context().clearCookies();
  await p.goto("/oauth/northstar/start");
  await p.getByTestId("ns-cancel").click();
  await expect(p.getByTestId("oauth-error")).toContainText("cancelled");

  // It can't take over an existing password account, even one on its own domain.
  const taken = `taken${Date.now().toString(36)}`;
  await pool.query(`INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', 'Real')`, [
    `${taken}@northstar-id.test`,
  ]);
  await p.goto("/oauth/northstar/start");
  await p.getByTestId("ns-username").fill(taken);
  await p.getByTestId("ns-allow").click();
  await p.waitForURL(/login\?oauth=exists/, { timeout: 30_000 });
  await expect(p.getByTestId("oauth-error")).toContainText("already exists");

  // A callback without the browser's own state is refused.
  const ctx3 = await browser.newContext();
  const r = await ctx3.newPage();
  await r.goto("/oauth/northstar/callback?code=whatever&state=abc");
  await r.waitForURL(/login\?oauth=bad_state/);
  await ctx.close();
  await ctx3.close();
});
