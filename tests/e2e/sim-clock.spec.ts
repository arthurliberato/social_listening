import { expect, test } from "@playwright/test";
import { PASSWORD, pool } from "./helpers";

// An agent harness can give each agent its own simulated clock through the `rw_sim` cookie. It stamps that agent's
// analytics events (the dataset), and labels the account; it changes nothing the user sees.
test("an agent's simulated clock stamps its events and labels its account", async ({
  page,
  context,
}) => {
  const clock = "2026-02-10T14:05:00.000Z";
  const sim = Buffer.from(
    JSON.stringify({ persona: "analyst_mid", run: `run-${Date.now()}`, model: "m-test", clock }),
  ).toString("base64");
  await context.addCookies([{ name: "rw_sim", value: sim, url: "http://localhost:3000" }]);

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
    await pool.query(`SELECT id, is_synthetic, persona_archetype FROM users WHERE email = $1`, [
      email,
    ])
  ).rows[0];
  expect(user.is_synthetic).toBe(true);
  expect(user.persona_archetype).toBe("analyst_mid");

  await expect
    .poll(
      async () =>
        (await pool.query(`SELECT ts FROM analytics_events WHERE user_id = $1`, [user.id])).rows
          .length,
    )
    .toBeGreaterThan(0);
  const { rows } = await pool.query(`SELECT name, ts FROM analytics_events WHERE user_id = $1`, [
    user.id,
  ]);
  for (const r of rows) expect(new Date(r.ts).toISOString(), r.name).toBe(clock);
});
