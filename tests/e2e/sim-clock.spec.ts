import { expect, test } from "@playwright/test";
import { PASSWORD, pool } from "./helpers";

// An agent harness can give each agent its own simulated clock through the `rw_sim` cookie (honoured when
// ALLOW_SIM_CLOCK=true). The clock stamps what the agent does: its analytics events, the rows it creates, the trial it
// starts, and what the product reads as "now", such as when a verification link expires.
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

test("an agent's simulated clock stamps its events and rows, and drives the product's own time", async ({
  page,
  context,
}) => {
  const clock = new Date("2026-02-10T14:05:00.000Z");
  const later = new Date(clock.getTime() + 2 * 3_600_000);
  const labels = { persona: "analyst_mid", run: `run-${Date.now()}`, model: "m-test" };
  const setClock = (at: Date) =>
    context.addCookies([
      {
        name: "rw_sim",
        value: b64({ ...labels, clock: at.toISOString() }),
        url: "http://localhost:3000",
      },
    ]);
  await setClock(clock);

  const email = `sim-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("signup-name").fill("Sim Agent");
  await page.getByTestId("signup-email").fill(email);
  await page.getByTestId("signup-company").fill(`Sim Co ${Date.now()}`);
  await page.getByTestId("signup-password").fill(PASSWORD);
  await page.getByTestId("signup-submit").click();
  await page.waitForURL("**/verify");

  const user = (
    await pool.query(
      `SELECT id, is_synthetic, persona_archetype, created_at FROM users WHERE email = $1`,
      [email],
    )
  ).rows[0];
  expect(user.is_synthetic).toBe(true);
  expect(user.persona_archetype).toBe("analyst_mid");

  // Rows carry the agent's time, and the trial runs on it.
  expect(new Date(user.created_at).toISOString()).toBe(clock.toISOString());
  const acct = (
    await pool.query(
      `SELECT a.trial_start_at, a.trial_end_at FROM accounts a JOIN memberships m ON m.account_id = a.id WHERE m.user_id = $1`,
      [user.id],
    )
  ).rows[0];
  expect(new Date(acct.trial_start_at).toISOString()).toBe(clock.toISOString());
  expect(new Date(acct.trial_end_at).getTime() - clock.getTime()).toBe(14 * 86_400_000);
  const mail = (await pool.query(`SELECT created_at FROM emails WHERE to_user_id = $1`, [user.id]))
    .rows;
  expect(mail.length).toBeGreaterThan(0);
  for (const m of mail) expect(new Date(m.created_at).toISOString()).toBe(clock.toISOString());

  await expect
    .poll(
      async () =>
        (await pool.query(`SELECT ts FROM analytics_events WHERE user_id = $1`, [user.id])).rows
          .length,
    )
    .toBeGreaterThan(0);
  for (const r of (
    await pool.query(`SELECT name, ts FROM analytics_events WHERE user_id = $1`, [user.id])
  ).rows)
    expect(new Date(r.ts).toISOString(), r.name).toBe(clock.toISOString());

  // Two hours later on the agent's clock it follows the emailed link. The product measures the wait on that clock.
  await page.goto("/inbox");
  const link = await page
    .getByTestId("inbox-message")
    .first()
    .locator("a")
    .first()
    .getAttribute("href");
  await setClock(later);
  await page.goto(link!);
  await page.waitForURL("**/onboarding");
  const verified = (
    await pool.query(`SELECT email_verified_at FROM users WHERE id = $1`, [user.id])
  ).rows[0];
  expect(new Date(verified.email_verified_at).toISOString()).toBe(later.toISOString());
  const ev = (
    await pool.query(
      `SELECT ts, props FROM analytics_events WHERE user_id = $1 AND name = 'Email Verified'`,
      [user.id],
    )
  ).rows[0];
  expect(new Date(ev.ts).toISOString()).toBe(later.toISOString());
  expect(ev.props.time_to_verify_ms).toBe(2 * 3_600_000);
});
