import { expect, test } from "@playwright/test";
import { createUser, pool } from "./helpers";

const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows;

test("help: reach it from the same place everywhere, find a topic, ask a question and get a reference", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Orbit Lace" });
  await page.goto(`/w/${slug}/home`);
  await page.waitForLoadState("networkidle");

  // The Help button is in the top bar on every screen; its dialog links to the Help center.
  await page.getByTestId("help").click();
  await expect(page.getByTestId("shortcut-help")).toBeVisible();
  await page.getByTestId("open-help-center").click();
  await page.waitForURL(`**/w/${slug}/help`);
  await page.waitForLoadState("networkidle");

  // Topics filter, and opening one is tracked with its id.
  await expect(page.getByTestId("help-topic").first()).toBeVisible();
  const all = await page.getByTestId("help-topic").count();
  expect(all).toBeGreaterThan(5);
  await page.getByTestId("help-search").fill("replyto");
  await expect(page.getByTestId("help-topic")).toHaveCount(1);
  await page.getByTestId("help-topic").locator("summary").click();
  await expect(page.getByTestId("help-topic")).toContainText("replies to one post");
  await expect
    .poll(async () => (await events(email, "Help Opened")).map((e) => e.props.topic))
    .toContain("boolean");
  await page.getByTestId("help-search").fill("zzzqqq");
  await expect(page.getByTestId("help-empty")).toBeVisible();
  await page.getByTestId("help-search").fill("");
  await expect(page.getByTestId("help-topic")).toHaveCount(all);

  // Asking: validation first, then a reference, an email, and an event.
  await page.getByTestId("support-subject").fill("Hi");
  await page.getByTestId("support-message").fill("Too short");
  await page.getByTestId("support-submit").click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await page.getByTestId("support-category").selectOption("query");
  await page.getByTestId("support-subject").fill("My query misses replies");
  await page
    .getByTestId("support-message")
    .fill("The query does not find replies to our launch post. What am I missing?");
  await page.getByTestId("support-submit").click();
  const ref = (await page.getByTestId("support-ref").innerText()).trim();
  expect(ref).toMatch(/^RW-[0-9A-F]{8}$/);
  await expect.poll(async () => (await events(email, "Support Contacted")).length).toBe(1);
  expect((await events(email, "Support Contacted"))[0]!.props).toMatchObject({ category: "query" });

  await page.goto("/inbox");
  await expect(page.getByTestId("inbox-message").filter({ hasText: ref }).first()).toBeVisible();
});

test("a client viewer can open Help and ask for it too", async ({ page }) => {
  const { slug } = await createUser(page, { brand: "Orbit Lace" });
  await pool.query(
    `UPDATE memberships SET role = 'client_viewer' WHERE workspace_id = (SELECT id FROM workspaces WHERE slug = $1)`,
    [slug],
  );
  await page.goto(`/w/${slug}/help`);
  await expect(page.getByRole("heading", { name: "Help", exact: true })).toBeVisible();
  await expect(page.getByTestId("support-form")).toBeVisible();
});
