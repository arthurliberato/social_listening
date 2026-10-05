import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

for (const path of ["/signup", "/login"]) {
  for (const theme of ["light", "dark"] as const) {
    test(`${path} has no serious a11y violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("rw-theme", t), theme);
      await page.goto(path);
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, JSON.stringify(serious, null, 1)).toEqual([]);
    });
  }
}
