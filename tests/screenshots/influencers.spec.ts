// Builds a demo Influencers workspace through the real UI, then photographs each screen in light and dark.
// Run with `npm run screenshots -- influencers` against a running app. Output: docs/screenshots/NN-name-{light,dark}.jpg
import { expect, test, type Page } from "@playwright/test";
import { createUser, pool } from "../e2e/helpers";

const OUT = "docs/screenshots";
const BROWSER_UA = (n: number) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/12${n} Safari/537.36`;
// A small, plain-colour PNG, so the review panel has a real file to show.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const consoleErrors: string[] = [];

const settled = async (p: Page) => {
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(500);
};

async function shoot(
  page: Page,
  n: string,
  name: string,
  url: string,
  ready: (p: Page) => Promise<void>,
  full?: number,
) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => localStorage.setItem("rw-theme", t), theme).catch(() => {});
    await page.goto(url);
    await page.evaluate((t) => localStorage.setItem("rw-theme", t), theme);
    await page.reload();
    await ready(page);
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    const base = page.viewportSize()!;
    if (full) {
      await page.setViewportSize({ width: base.width, height: full });
      await page.waitForTimeout(900);
    }
    await page.screenshot({
      path: `${OUT}/${n}-${name}-${theme}.jpg`,
      type: "jpeg",
      quality: 82,
    });
    if (full) await page.setViewportSize(base);
  }
}

test("influencers tour", async ({ page, browser }) => {
  test.setTimeout(900_000);
  const watch = (p: Page) => {
    p.on("pageerror", (e) => consoleErrors.push(`pageerror ${p.url()} ${e.message}`));
    p.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console ${p.url()} ${m.text().slice(0, 200)}`);
    });
  };
  watch(page);

  const { email, slug } = await createUser(page, { brand: "Latte Lane", prefix: "infdemo" });
  await pool.query(`UPDATE users SET name = 'Maya Okafor' WHERE lower(email) = $1`, [email]);
  await pool.query(
    `UPDATE accounts SET name = 'Latte Lane', plan_tier = 'enterprise', motion = 'sales_assisted', billing_status = 'active', current_period_start = now(), current_period_end = now() + interval '1 year', trial_end_at = NULL WHERE id IN (SELECT m.account_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1)`,
    [email],
  );
  await pool.query(`UPDATE workspaces SET name = 'Latte Lane' WHERE slug = $1`, [slug]);

  // Discovery, with a saved search and two creators ticked for comparison.
  await page.goto(`/w/${slug}/creators?niche=food&platform=instagram`);
  await expect(page.getByTestId("creator-row").first()).toBeVisible();
  await page.getByTestId("save-name").fill("Instagram food creators");
  await page.getByTestId("save-submit").click();
  await expect(page.getByTestId("saved-item")).toHaveCount(1);
  const hrefs = await page
    .getByTestId("creator-link")
    .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!));
  const ids = hrefs.slice(0, 3).map((h) => h.split("/").pop()!);

  // A list of three, then a campaign built from it.
  for (let i = 0; i < 3; i++) {
    await page.getByTestId("add-to-list").nth(i).click();
    if (i === 0) await page.getByTestId("new-list-name").fill("Spring launch picks");
    else await page.getByLabel("Spring launch picks").check();
    await page.getByTestId("add-to-list-confirm").click();
    await expect(page.getByTestId("add-to-list-status").nth(i)).toContainText("Added");
  }
  await page.getByTestId("compare-check").nth(0).check();
  await page.getByTestId("compare-check").nth(1).check();
  await expect(page.getByTestId("compare-bar")).toBeVisible();
  await settled(page);

  await page.goto(`/w/${slug}/creators/campaigns`);
  await page.getByTestId("campaign-name").fill("Spring latte launch");
  await page.getByTestId("campaign-budget").fill("6000");
  await page.getByTestId("campaign-create").click();
  await page.waitForURL(/campaigns\/[0-9a-f-]{36}/);
  const campaign = new URL(page.url()).pathname;
  await page.getByTestId("add-from-list-submit").click();
  await expect(page.getByTestId("roster-row")).toHaveCount(3);

  // Creator one accepts and uploads their content; creator two has been invited and hasn't answered.
  const invite = async (i: number, offer: string) => {
    const row = page.getByTestId("roster-row").nth(i);
    await row.getByTestId("invite-open").click();
    await row.getByTestId("invite-offer").fill(offer);
    await row.getByTestId("invite-send").click();
    await expect(row.getByTestId("roster-status")).toHaveText("Invited");
    return row.getByTestId("invite-link").inputValue();
  };
  const link1 = await invite(0, "800");
  await invite(1, "600");
  const ctx = await browser.newContext({
    viewport: { width: 1100, height: 900 },
    reducedMotion: "reduce",
  });
  const cp = await ctx.newPage();
  watch(cp);
  await cp.goto(link1);
  await cp.getByTestId("portal-accept").click();
  await expect(cp.getByTestId("portal-heading")).toHaveText("You're confirmed");

  // A landing page, so the creator has a tracking link, and some visits and sales to report.
  await page.goto(`${campaign}/results`);
  await page.getByTestId("destination-input").fill("https://latte-lane.example.test/spring");
  await page.getByTestId("destination-save").click();
  await expect(page.getByTestId("destination-status")).toContainText("Saved");
  const key = (await page.getByTestId("postback-url").inputValue()).match(
    /key=([0-9a-f]{48})/,
  )![1]!;
  await cp.reload();
  const trackLink = await cp.getByTestId("portal-tracking-link").inputValue();
  for (let v = 0; v < 14; v++) {
    const hit = await page.request.get(trackLink, {
      maxRedirects: 0,
      headers: { "user-agent": BROWSER_UA(v) },
    });
    const cid = new URL(hit.headers()["location"]!).searchParams.get("rw_cid")!;
    if (v % 4 === 0)
      await page.request.get(
        `/api/t/conversion?cid=${cid}&key=${key}&value=${42 + v * 3}&ref=order-${v}`,
      );
  }

  await cp.getByTestId("content-mode-file").check();
  await cp
    .getByTestId("content-file")
    .setInputFiles({ name: "latte-reel-cover.png", mimeType: "image/png", buffer: PNG });
  await cp.getByTestId("content-caption").fill("Morning ritual, spring menu #ad");
  await cp.getByTestId("content-submit").click();
  await expect(cp.getByTestId("portal-heading")).toContainText("is with");

  await shoot(page, "14", "product-hub", "/hub", async (p) => {
    await expect(p.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    await settled(p);
  });
  await shoot(
    page,
    "15",
    "creator-discovery",
    `/w/${slug}/creators?niche=food&platform=instagram`,
    async (p) => {
      await expect(p.getByTestId("saved-item")).toHaveCount(1);
      await p.getByTestId("compare-check").nth(0).check();
      await p.getByTestId("compare-check").nth(1).check();
      await expect(p.getByTestId("compare-bar")).toBeVisible();
      await settled(p);
    },
    1200,
  );
  await shoot(
    page,
    "16",
    "creator-profile",
    hrefs[0]!,
    async (p) => {
      await expect(p.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
      await settled(p);
    },
    1500,
  );
  await shoot(
    page,
    "17",
    "creator-compare",
    `/w/${slug}/creators/compare?ids=${ids.join(",")}`,
    async (p) => {
      await expect(p.getByTestId("compare-table")).toBeVisible({ timeout: 30_000 });
      await settled(p);
    },
    1100,
  );
  await shoot(
    page,
    "18",
    "campaign-roster",
    campaign,
    async (p) => {
      await expect(p.getByTestId("review-panel")).toBeVisible({ timeout: 30_000 });
      await settled(p);
    },
    1500,
  );
  await shoot(
    page,
    "19",
    "campaign-results",
    `${campaign}/results`,
    async (p) => {
      await expect(p.getByTestId("results-table").or(p.getByRole("table").first())).toBeVisible({
        timeout: 30_000,
      });
      await settled(p);
    },
    1500,
  );
  await shoot(
    cp,
    "20",
    "creator-page",
    link1,
    async (p) => {
      await expect(p.getByTestId("portal")).toBeVisible({ timeout: 30_000 });
      await settled(p);
    },
    1500,
  );

  await ctx.close();
  console.log(
    `CONSOLE ERRORS (${consoleErrors.length})\n${[...new Set(consoleErrors)].join("\n")}`,
  );
});
