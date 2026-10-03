import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runDueReports } from "../../jobs/reports";
import { createUser, pool } from "./helpers";

test.setTimeout(120_000);

const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows;
const polled = (email: string, name: string) =>
  expect.poll(async () => (await events(email, name)).length);
async function setPlan(email: string, plan: string) {
  await pool.query(
    `UPDATE accounts SET plan_tier = $2 WHERE id IN (SELECT m.account_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1)`,
    [email, plan],
  );
}
async function setRole(email: string, role: string) {
  await pool.query(
    `UPDATE memberships SET role = $2 WHERE user_id = (SELECT id FROM users WHERE lower(email) = $1)`,
    [email, role],
  );
}
async function queryReady(slug: string) {
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            `SELECT q.backfill_status AS s FROM queries q JOIN workspaces w ON w.id = q.workspace_id WHERE w.slug = $1`,
            [slug],
          )
        ).rows[0]?.s,
      { timeout: 45_000 },
    )
    .toMatch(/done|quota_exhausted/);
}
async function fromTemplate(page: Page, slug: string, template = "weekly_brand_summary") {
  await page.goto(`/w/${slug}/reports/new`);
  await page.getByTestId(`template-${template}`).click();
  await page.waitForURL(/reports\/[0-9a-f-]{36}\?edit=1/);
  return new URL(page.url()).pathname.split("/").pop()!;
}
const loaded = async (page: Page) => {
  await expect(page.getByTestId("report-section").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("section-loading")).toHaveCount(0, { timeout: 45_000 });
};
async function download(page: Page, item: "export-pdf" | "export-csv") {
  await page.getByTestId("export-menu").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId(item).click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), body: readFileSync(path!) };
}

test("empty state → template → every section loads, with a table twin → edit, reorder, save", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  await queryReady(slug);
  await page.goto(`/w/${slug}/reports`);
  await expect(page.getByTestId("reports-empty")).toBeVisible();
  await page.getByTestId("empty-new-report").click();
  await page.getByTestId("template-weekly_brand_summary").click();
  await page.waitForURL(/reports\/[0-9a-f-]{36}\?edit=1/);
  await loaded(page);
  await expect(page.getByTestId("report-section")).toHaveCount(6);
  await polled(email, "Report Created").toBe(1);
  expect((await events(email, "Report Created"))[0]!.props).toMatchObject({
    template_id: "weekly_brand_summary",
  });

  // Edit: rename the report, move a section, remove one, add one.
  const titles = () => page.getByTestId("section-title").allInnerTexts();
  expect((await titles())[0]).toBe("Mentions");
  await page.getByTestId("report-name").fill("Monday brief");
  await page.getByRole("button", { name: "Move Mentions down" }).click();
  expect((await titles()).slice(0, 2)).toEqual(["Net sentiment", "Mentions"]);
  await page.getByRole("button", { name: "Remove Top sources" }).click();
  await expect(page.getByTestId("report-section")).toHaveCount(5);
  await page.getByTestId("add-section").click();
  await page.getByTestId("add-topic_cloud").click();
  await expect(page.getByTestId("report-section")).toHaveCount(6);
  await page.getByRole("button", { name: "Settings for Topics" }).click();
  await page.getByTestId("cfg-title").fill("What people talk about");
  await page.getByTestId("cfg-apply").click();
  await page.getByTestId("save-report").click();
  await expect(page.getByTestId("report-title")).toHaveText("Monday brief");
  await expect(page).not.toHaveURL(/edit=1/);

  // It persists, and a section's chart has a table twin.
  await page.reload();
  await loaded(page);
  expect(await titles()).toContain("What people talk about");
  expect(await titles()).not.toContain("Top sources");
  const volume = page.getByTestId("report-section").filter({ hasText: "Mentions over time" });
  await volume.getByTestId("section-table-toggle").click();
  await expect(volume.getByRole("table")).toBeVisible();
  await expect(
    page.getByTestId("report-section").first().getByTestId("section-summary"),
  ).toBeVisible();

  // Cancelling an edit throws the changes away.
  await page.getByTestId("edit-report").click();
  await page.getByTestId("report-name").fill("Discarded");
  await page.getByTestId("cancel-edit").click();
  await expect(page.getByTestId("report-title")).toHaveText("Monday brief");
});

test("exports: PDF and CSV download, are logged on Exports, and fire the events", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  await queryReady(slug);
  const id = await fromTemplate(page, slug, "executive_overview");
  await page.goto(`/w/${slug}/reports/${id}`);
  await loaded(page);

  const csv = await download(page, "export-csv");
  expect(csv.name).toBe("executive-overview.csv");
  const text = csv.body.toString("utf8");
  expect(text).toContain('"Report","Executive overview"');
  expect(text).toContain('"Section","Mentions over time"');
  const pdf = await download(page, "export-pdf");
  expect(pdf.name).toBe("executive-overview.pdf");
  expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.body.length).toBeGreaterThan(5_000);

  await polled(email, "Report Exported").toBe(2);
  expect((await events(email, "Report Exported")).map((e) => e.props.format).sort()).toEqual([
    "csv",
    "pdf",
  ]);
  await polled(email, "Export Downloaded").toBe(2);

  await page.goto(`/w/${slug}/exports`);
  await expect(page.getByTestId("export-row")).toHaveCount(2);
  await expect(page.getByTestId("export-history")).toContainText("Executive overview");
});

test("exports page: empty history, then a mentions CSV appears in it", async ({ page }) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  await queryReady(slug);
  await page.goto(`/w/${slug}/exports`);
  await expect(page.getByTestId("exports-empty")).toBeVisible();
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-download").click(),
  ]);
  const body = readFileSync((await dl.path())!, "utf8");
  expect(body.split("\n")[0]).toContain("published_at");
  expect(body.split("\n").length).toBeGreaterThan(5);
  await page.goto(`/w/${slug}/exports`);
  await expect(page.getByTestId("export-row")).toHaveCount(1);
  await expect(page.getByTestId("export-row")).toContainText("Mentions");
  await polled(email, "Export Downloaded").toBe(1);
});

test("scheduling is a paywall on trial; on Growth it saves, and a copy lands in the inbox with tracked open and click", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  await queryReady(slug);
  const id = await fromTemplate(page, slug);
  await page.goto(`/w/${slug}/reports/${id}`);
  await loaded(page);

  await page.getByTestId("open-schedule").click();
  await page.getByTestId("sch-save").click();
  await expect(page.getByTestId("paywall-modal")).toContainText("Scheduled reports");
  await page.keyboard.press("Escape");

  await setPlan(email, "growth");
  await page.reload();
  await loaded(page);
  await page.getByTestId("open-schedule").click();
  await page.getByTestId("sch-frequency").selectOption("weekly");
  await page.getByTestId("sch-weekday").selectOption("1");
  await page.getByTestId("sch-hour").selectOption("9");
  await expect(page.getByTestId("sch-summary")).toContainText("Every Monday at 09:00 UTC");
  // The dialog starts with you ticked; with nobody ticked it refuses to save.
  await page.getByTestId("sch-recipient-E2E User").uncheck();
  await page.getByTestId("sch-save").click();
  await expect(page.getByTestId("sch-error")).toContainText("at least one recipient");
  await page.getByTestId("sch-recipient-E2E User").check();
  await page.getByTestId("sch-external").fill("client@example.com");
  await page.getByTestId("sch-save").click();
  await expect(page.getByTestId("sch-note")).toContainText("Scheduled");
  await polled(email, "Report Scheduled").toBe(1);
  expect((await events(email, "Report Scheduled"))[0]!.props).toMatchObject({
    schedule_frequency: "weekly",
    recipients_count: 2,
    has_external_recipient: true,
  });

  // "Email me a copy now": same message, same tracking.
  await page.getByTestId("sch-send-now").click();
  await expect(page.getByTestId("sch-note")).toContainText("Sent");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("schedule-badge")).toContainText("Every Monday at 09:00 UTC");

  await page.goto("/inbox");
  const msg = page.getByTestId("inbox-message").filter({ hasText: "Weekly brand summary" }).first();
  await expect(msg).toBeVisible();
  await expect(msg).toContainText("Open the full report");
  // Seeing the message loads its pixel, which is the open.
  await polled(email, "Email Opened").toBe(1);
  // (Report Opened also fires for in-app views; count only the email channel here.)
  const emailOpens = async () =>
    (await events(email, "Report Opened")).filter((e) => e.props.channel === "email");
  await expect.poll(async () => (await emailOpens()).length).toBe(1);
  expect((await emailOpens())[0]!.props).toMatchObject({ report_id: id });
  await page.reload();
  await page.waitForTimeout(600);
  expect((await events(email, "Email Opened")).length).toBe(1); // once per message

  // Clicking the tracked link records the click, then lands on the report.
  await msg.locator("a").first().click();
  await page.waitForURL(new RegExp(`/w/${slug}/reports/${id}`));
  await polled(email, "Email Link Clicked").toBe(1);
  await loaded(page);

  await page.goto(`/w/${slug}/reports`);
  await expect(page.getByTestId("report-card")).toContainText("Every Monday at 09:00 UTC");
  await expect(page.getByTestId("report-card")).toContainText("Last sent");
});

test("a scheduled run that is due sends to the inbox once", async ({ page }) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  await queryReady(slug);
  await setPlan(email, "growth");
  const id = await fromTemplate(page, slug);
  await page.goto(`/w/${slug}/reports/${id}`);
  await page.getByTestId("open-schedule").click();
  await page.getByTestId("sch-recipient-E2E User").check();
  await page.getByTestId("sch-save").click();
  await expect(page.getByTestId("sch-note")).toContainText("Scheduled");

  // Make it due and run the job exactly as the worker does.
  await pool.query(
    `UPDATE report_schedules SET next_run_at = now() - interval '1 minute' WHERE report_id = $1`,
    [id],
  );
  const sent = (await runDueReports()).filter((s) => s.sent > 0);
  expect(sent.length).toBeGreaterThanOrEqual(1);
  expect((await runDueReports()).filter((s) => s.sent > 0)).toEqual([]); // not again
  await polled(email, "Report Delivered").toBe(1);

  await page.goto("/inbox");
  await expect(
    page.getByTestId("inbox-message").filter({ hasText: "Weekly brand summary" }),
  ).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (await events(email, "Report Opened")).filter((e) => e.props.channel === "email").length,
    )
    .toBe(1);
});

test("a section whose query was deleted shows its own error; the rest still load", async ({
  page,
}) => {
  const { slug } = await createUser(page, { brand: "Latte Lane" });
  await queryReady(slug);
  const id = await fromTemplate(page, slug, "crisis_recap");
  await pool.query(
    `UPDATE reports SET sections = jsonb_set(sections, '{0,config}', '{"queryId":"00000000-0000-4000-8000-000000000000"}') WHERE id = $1`,
    [id],
  );
  await page.goto(`/w/${slug}/reports/${id}`);
  await expect(page.getByTestId("section-error").first()).toContainText("deleted", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("section-loading")).toHaveCount(0, { timeout: 45_000 });
  await expect(page.getByTestId("report-section")).toHaveCount(4);
  await expect(page.getByTestId("section-error")).toHaveCount(1);
});

test("viewers read and export but can't create, edit or schedule; client viewers can't export", async ({
  page,
}) => {
  const { email, slug } = await createUser(page, { brand: "Latte Lane" });
  await queryReady(slug);
  const id = await fromTemplate(page, slug);
  await page.goto(`/w/${slug}/reports/${id}`);
  await loaded(page);

  await setRole(email, "viewer");
  await page.reload();
  await loaded(page);
  await expect(page.getByTestId("export-menu")).toBeVisible();
  await expect(page.getByTestId("edit-report")).toHaveCount(0);
  await expect(page.getByTestId("open-schedule")).toHaveCount(0);
  await page.goto(`/w/${slug}/reports`);
  await expect(page.getByTestId("new-report")).toHaveCount(0);
  await page.goto(`/w/${slug}/reports/new`);
  await expect(page.getByTestId("report-permission")).toBeVisible();

  await setRole(email, "client_viewer");
  await page.goto(`/w/${slug}/reports/${id}`);
  await loaded(page);
  await expect(page.getByTestId("export-menu")).toHaveCount(0);
  const res = await page.request.get(`/api/w/${slug}/reports/${id}/export?format=pdf`);
  expect(res.status()).toBe(403);
  await page.goto(`/w/${slug}/exports`);
  await expect(page.getByTestId("export-permission")).toBeVisible();
});

test("reports are scoped to their workspace", async ({ page, browser }) => {
  const a = await createUser(page, { brand: "Latte Lane" });
  const id = await fromTemplate(page, a.slug);
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  const b = await createUser(p2, { brand: "Latte Lane" });
  await p2.goto(`/w/${b.slug}/reports/${id}`);
  await expect(p2.getByText("could not be found")).toBeVisible();
  expect((await p2.request.get(`/api/w/${b.slug}/reports/${id}/export?format=csv`)).status()).toBe(
    404,
  );
  await ctx2.close();
});
