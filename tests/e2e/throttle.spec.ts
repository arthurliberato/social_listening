import { expect, test, type Page } from "@playwright/test";
import { createUser, PASSWORD, pool } from "./helpers";

test.setTimeout(120_000);

async function tryLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await expect(page.getByTestId("login-email")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("five wrong passwords lock the account for a while; resetting the password unlocks it", async ({
  page,
  browser,
}) => {
  const { email } = await createUser(page, { prefix: "thr" });
  const ctx = await browser.newContext();
  const p = await ctx.newPage();

  for (let i = 0; i < 5; i++) {
    await tryLogin(p, email, `wrong password ${i}`);
    await expect(p.getByTestId("login-error")).toContainText("don't match", { timeout: 20_000 });
  }
  // Now even the right password is refused, with a message that says how long and how to get in sooner.
  await tryLogin(p, email, PASSWORD);
  await expect(p.getByTestId("login-error")).toContainText("Too many failed attempts", {
    timeout: 20_000,
  });
  await expect(p.getByTestId("login-error")).toContainText("15 minutes");
  expect(p.url()).toContain("/login");

  // An address with no account is throttled the same way, so the lock doesn't reveal who is registered.
  const ghost = `ghost-${Date.now()}@example.test`;
  for (let i = 0; i < 5; i++) {
    await tryLogin(p, ghost, "whatever password");
    await expect(p.getByTestId("login-error")).toBeVisible({ timeout: 20_000 });
  }
  await tryLogin(p, ghost, "whatever password");
  await expect(p.getByTestId("login-error")).toContainText("Too many failed attempts", {
    timeout: 20_000,
  });

  // Resetting the password proves inbox ownership and clears the lock.
  await p.goto("/forgot");
  await p.waitForLoadState("networkidle");
  await p.getByTestId("forgot-email").fill(email);
  await p.getByTestId("forgot-submit").click();
  await expect(p.getByTestId("forgot-sent")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            `SELECT 1 FROM emails WHERE lower(to_address) = $1 AND subject LIKE 'Reset your%'`,
            [email],
          )
        ).rowCount,
    )
    .toBe(1);
  const body = (
    await pool.query(
      `SELECT body_text FROM emails WHERE lower(to_address) = $1 AND subject LIKE 'Reset your%'`,
      [email],
    )
  ).rows[0].body_text as string;
  await p.goto(/(https?:\/\/[^\s]+)/.exec(body)![1]!.replace(/^https?:\/\/[^/]+/, ""));
  await p.waitForLoadState("networkidle");
  await p.getByTestId("reset-password").fill("a brand new passphrase");
  await p.getByTestId("reset-submit").click();
  await p.waitForURL(/login\?reset=1/);
  await tryLogin(p, email, "a brand new passphrase");
  await p.waitForURL(/\/w\/.+\/home/, { timeout: 30_000 });
  await ctx.close();
});

test("a successful login resets the count", async ({ page, browser }) => {
  const { email } = await createUser(page, { prefix: "thr2" });
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  for (let i = 0; i < 3; i++) {
    await tryLogin(p, email, `nope ${i}`);
    await expect(p.getByTestId("login-error")).toBeVisible({ timeout: 20_000 });
  }
  await tryLogin(p, email, PASSWORD);
  await p.waitForURL(/\/w\/.+\/home/, { timeout: 30_000 });
  const row = await pool.query(
    `SELECT count(*)::int AS n FROM login_throttle l WHERE l.failures > 0 AND l.key_hash = encode(sha256($1::bytea), 'hex')`,
    [email],
  );
  expect(row.rows[0].n).toBe(0);
  await ctx.close();
});
