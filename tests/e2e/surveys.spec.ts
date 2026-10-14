import { expect, test } from "@playwright/test";
import { createUser, pool } from "./helpers";

test.afterAll(() => pool.end());

const eventsFor = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id
       WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email.toLowerCase(), name],
    )
  ).rows.map((r) => r.props as Record<string, unknown>);

test("after setup the person is asked how easy it was; answering records one row per question, once", async ({
  page,
}) => {
  const { slug, email } = await createUser(page, { prefix: "seq" });
  await page.goto(`/w/${slug}/home`);
  const card = page.getByTestId("survey-prompt");
  await expect(card).toHaveAttribute("data-survey-id", "seq");
  await expect(card.getByTestId("survey-submit")).toBeDisabled();

  // It stays through the visit, and asking again does not log a second "shown".
  await page.goto(`/w/${slug}/mentions`);
  await expect(page.getByTestId("survey-prompt")).toBeVisible();

  await page.getByTestId("survey-seq-setup_ease-6").check({ force: true });
  await page.getByTestId("survey-submit").click();
  await expect(page.getByTestId("survey-thanks")).toBeVisible();

  await expect.poll(async () => (await eventsFor(email, "Survey Item Answered")).length).toBe(1);
  expect((await eventsFor(email, "Survey Item Answered"))[0]).toMatchObject({
    survey_id: "seq",
    item_id: "setup_ease",
    response: 6,
    scale_min: 1,
    scale_max: 7,
    item_index: 1,
  });
  expect(await eventsFor(email, "Survey Shown")).toHaveLength(1);
  expect(await eventsFor(email, "Survey Eligibility Evaluated")).toEqual([
    expect.objectContaining({ survey_id: "seq", eligible: true, reason: "eligible" }),
  ]);

  // Answered once, never asked again.
  await page.goto(`/w/${slug}/dashboards`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("survey-prompt")).toHaveCount(0);
});

test("Not now closes it and is recorded", async ({ page }) => {
  const { slug, email } = await createUser(page, { prefix: "seqd" });
  await page.goto(`/w/${slug}/home`);
  await expect(page.getByTestId("survey-prompt")).toBeVisible();
  await page.getByTestId("survey-dismiss").click();
  await expect(page.getByTestId("survey-prompt")).toHaveCount(0);
  await expect.poll(async () => (await eventsFor(email, "Survey Dismissed")).length).toBe(1);
  await page.goto(`/w/${slug}/mentions`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("survey-prompt")).toHaveCount(0);
});
