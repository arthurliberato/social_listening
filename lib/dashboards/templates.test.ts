import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/entitlements/plans";
import { widgetAllowed } from "./catalog";
import { TEMPLATES, layoutTemplate } from "./templates";

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("templates", () => {
  it("lay out without overlap inside the 12-column grid", () => {
    for (const t of TEMPLATES) {
      const { placed } = layoutTemplate(t.widgets, () => true);
      expect(placed.length, t.id).toBe(t.widgets.length);
      for (const [i, a] of placed.entries()) {
        expect(a.x >= 0 && a.x + a.w <= 12, t.id).toBe(true);
        for (const b of placed.slice(i + 1)) expect(overlaps(a, b), t.id).toBe(false);
      }
    }
  });
  it("skip widgets the plan doesn't include and say which", () => {
    const trial = layoutTemplate(
      TEMPLATES.find((t) => t.id === "executive_summary")!.widgets,
      (t) => widgetAllowed(t, PLANS.trial.features),
    );
    expect(trial.skipped).toEqual(["share_of_voice"]);
    expect(trial.placed.some((w) => w.type === "share_of_voice")).toBe(false);
    const growth = layoutTemplate(
      TEMPLATES.find((t) => t.id === "executive_summary")!.widgets,
      (t) => widgetAllowed(t, PLANS.growth.features),
    );
    expect(growth.skipped).toEqual([]);
  });
  it("has five templates, each with a hero set of widgets", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([
      "brand_health",
      "competitor_benchmark",
      "campaign_tracker",
      "crisis_monitor",
      "executive_summary",
    ]);
  });
});
