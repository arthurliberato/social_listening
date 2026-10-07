import { describe, expect, it } from "vitest";
import { PLANS, canCreateCreatorList, planUnlocking, type PlanTier } from "./plans";

const TIERS: PlanTier[] = ["trial", "starter", "growth", "agency", "enterprise"];

describe("creator entitlements", () => {
  it("never shrink as plans go up", () => {
    for (const k of ["creatorProfilesPerMonth", "creatorLists"] as const)
      for (let i = 1; i < TIERS.length; i++)
        expect(PLANS[TIERS[i]!][k]).toBeGreaterThanOrEqual(PLANS[TIERS[i - 1]!][k]);
  });
  it("gates audience insights and export to Growth and above", () => {
    expect(planUnlocking("creatorAudience")).toBe("growth");
    expect(planUnlocking("creatorExport")).toBe("growth");
    expect(PLANS.starter.features.creatorAudience).toBe(false);
  });
  it("blocks a new list at the limit and names the plan that raises it", () => {
    expect(canCreateCreatorList("trial", 1)).toEqual({ ok: true });
    const r = canCreateCreatorList("trial", 2);
    expect(r).toMatchObject({ ok: false, upgradeTo: "growth" });
  });
});
