import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Read lazily: the setup project writes this file after specs are collected.
const slugOf = () =>
  (JSON.parse(readFileSync("tests/.auth/meta.json", "utf8")) as { slug: string }).slug;

for (const theme of ["light", "dark"] as const) {
  test(`shell has no serious a11y violations (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("rw-theme", t), theme);
    await page.goto(`/w/${slugOf()}/home`);
    await expect(page.getByTestId("sidebar")).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious, null, 1)).toEqual([]);
  });
}

test("theme toggle switches and persists", async ({ page }) => {
  await page.goto(`/w/${slugOf()}/home`);
  await page.getByTestId("theme-toggle").click();
  const first = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(first);
});

test("a workspace you don't belong to is forbidden", async ({ page }) => {
  await page.goto("/w/not-my-workspace/home");
  await expect(page).toHaveURL(/\/403/);
});

test("log out ends the session", async ({ page }) => {
  await page.goto(`/w/${slugOf()}/home`);
  await page.getByTestId("logout").click();
  await page.waitForURL("**/login");
  await page.goto(`/w/${slugOf()}/home`);
  await expect(page).toHaveURL(/\/login/);
});

// M3 screens: query list, guided builder, advanced (CodeMirror) editor.
for (const theme of ["light", "dark"] as const) {
  for (const screen of ["list", "guided", "advanced"] as const) {
    test(`queries ${screen} has no serious a11y violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("rw-theme", t), theme);
      await page.goto(`/w/${slugOf()}/queries${screen === "list" ? "" : "/new"}`);
      if (screen === "advanced") {
        await page.getByTestId("mode-advanced").click();
        await page.getByTestId("advanced-editor-content").click();
        await page.keyboard.type('("Orbit Lace" OR #orbitlace) NOT job');
        await expect(page.getByTestId("preview-count")).toBeVisible({ timeout: 15_000 });
      } else if (screen === "guided") {
        await page.getByTestId("guided-any").fill("Orbit Lace");
        await page.getByTestId("guided-any").press("Enter");
        await expect(page.getByTestId("preview-count")).toBeVisible({ timeout: 15_000 });
      } else {
        await expect(page.getByTestId("queries-table")).toBeVisible();
      }
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        serious,
        JSON.stringify(
          serious.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html.slice(0, 120)) })),
          null,
          1,
        ),
      ).toEqual([]);
    });
  }
}

// M4 screens: feed views, drawer, filter dialog, shortcut help.
for (const theme of ["light", "dark"] as const) {
  for (const screen of ["cards", "list", "table", "drawer", "filters", "shortcuts"] as const) {
    test(`mentions ${screen} has no serious a11y violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("rw-theme", t), theme);
      await page.goto(
        `/w/${slugOf()}/mentions${screen === "list" ? "?view=list" : screen === "table" ? "?view=table" : ""}`,
      );
      await page.waitForSelector('[data-testid="mentions-feed"][data-hydrated="true"]', {
        timeout: 30_000,
      });
      await expect(page.getByTestId("mention-card").first()).toBeVisible({ timeout: 45_000 });
      if (screen === "drawer") {
        await page.getByTestId("open-mention").first().click();
        await expect(page.getByTestId("mention-drawer")).toBeVisible();
        await expect(page.getByTestId("drawer-context")).toContainText("Matched by");
      } else if (screen === "filters") {
        await page.getByTestId("open-filters").click();
        await expect(page.getByTestId("filter-panel")).toBeVisible();
      } else if (screen === "shortcuts") {
        await page.getByTestId("help").click();
        await expect(page.getByTestId("shortcut-help")).toBeVisible();
      }
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        serious,
        JSON.stringify(
          serious.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html.slice(0, 140)) })),
          null,
          1,
        ),
      ).toEqual([]);
    });
  }
}
