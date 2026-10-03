// Creates one verified, onboarded user (via the real UI) and saves its session for other specs.
import { test as setup } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { createUser } from "./helpers";

setup("create onboarded user", async ({ page }) => {
  const { email, slug } = await createUser(page, { prefix: "setup", brand: "Latte Lane" });
  writeFileSync("tests/.auth/meta.json", JSON.stringify({ slug, email }));
  await page.context().storageState({ path: "tests/.auth/user.json" });
});
