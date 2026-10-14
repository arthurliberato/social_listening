import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The simulation's hidden ground truth must never reach the product, its analytics, or the warehouse export.
const FORBIDDEN_IN = [
  "app",
  "components",
  "lib/analytics",
  "lib/entitlements",
  "lib/billing",
  "jobs",
];
const NEEDLE = /sim[-_]truth/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx|mjs|json)$/.test(f) ? [p] : [];
  });
}

describe("sim_truth is sealed", () => {
  it("is not mentioned anywhere the product or the export can see it", () => {
    const hits = FORBIDDEN_IN.flatMap((d) => files(d)).filter((f) =>
      NEEDLE.test(readFileSync(f, "utf8")),
    );
    expect(hits).toEqual([]);
  });
  it("is not re-exported through the app's database client", () => {
    expect(readFileSync("db/client.ts", "utf8")).not.toMatch(NEEDLE);
  });
});
