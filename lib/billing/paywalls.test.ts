import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAYWALL_TRIGGERS, PAYWALLS, isPaywallTrigger } from "./paywalls";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f === ".next" || f.startsWith(".")) return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("paywall placements", () => {
  it("there are at least ten, each with a sentence that says why", () => {
    expect(PAYWALL_TRIGGERS.length).toBeGreaterThanOrEqual(10);
    for (const t of PAYWALL_TRIGGERS) expect(PAYWALLS[t].length).toBeGreaterThan(10);
    expect(isPaywallTrigger("query_limit")).toBe(true);
    expect(isPaywallTrigger("made_up")).toBe(false);
  });

  it("every registered placement is actually used by the app", () => {
    const src = ["app", "components", "lib"]
      .flatMap((d) => files(d))
      .filter(
        (f) =>
          !f.endsWith("paywalls.ts") &&
          !f.endsWith(".test.ts") &&
          !f.includes("lib/analytics/events"),
      )
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const unused = PAYWALL_TRIGGERS.filter(
      (t) => !new RegExp(`["'\`]${t}["'\`]|from=${t}|=${t}\\b`).test(src),
    );
    expect(unused).toEqual([]);
  });
});
