import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_CATEGORIES, AUDIT_LABEL, auditDetail } from "./audit";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f === ".next" || f.startsWith(".")) return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("audit log vocabulary", () => {
  it("every action the code records has a readable label", () => {
    // Only strings near an audit call count (other modules use dotted names too, e.g. permission capabilities).
    const name =
      /["'`]((?:member|workspace|branding|plan|card|dashboard|contract|query|report|alert|crisis)\.[a-z_]+)["'`]/g;
    const used = new Set<string>();
    for (const f of ["app", "lib", "jobs"].flatMap((d) => files(d))) {
      if (f.endsWith("lib/audit.ts") || /\.test\.tsx?$/.test(f)) continue;
      const src = readFileSync(f, "utf8");
      for (const call of src.matchAll(/\baudit(?:In)?\(/g))
        for (const m of src.slice(call.index, call.index! + 450).matchAll(name)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(15);
    expect([...used].filter((a) => !(a in AUDIT_LABEL))).toEqual([]);
  });

  it("every label belongs to exactly one filter category", () => {
    for (const action of Object.keys(AUDIT_LABEL)) {
      const homes = Object.entries(AUDIT_CATEGORIES).filter(([, c]) =>
        c.prefixes.some((p) => action.startsWith(p)),
      );
      expect(
        homes.map(([k]) => k),
        action,
      ).toHaveLength(1);
    }
  });

  it("details read from what was recorded, and never show an empty line for a known action", () => {
    expect(auditDetail("query.updated", { name: "Brand", search_changed: true }, null)).toBe(
      "Brand (search terms changed)",
    );
    expect(
      auditDetail(
        "report.scheduled",
        { name: "Weekly", frequency: "weekly", members: 3, external: 2 },
        null,
      ),
    ).toBe("Weekly: weekly, 3 teammates and 2 outside addresses");
    expect(auditDetail("crisis.update_sent", { title: "Room", recipients: 4 }, null)).toBe(
      "Room: sent to 4 people",
    );
    for (const action of Object.keys(AUDIT_LABEL).filter((a) =>
      /^(query|dashboard|report|alert|crisis)\./.test(a),
    )) {
      expect(
        auditDetail(action, { name: "X", title: "X", widgets: 1, type: "volume_spike" }, null),
        action,
      ).not.toBe("");
    }
  });
});
