import { afterAll, describe, expect, it } from "vitest";
import { accounts, creatorSavedSearches, db, pool, workspaces } from "@/db/client";
import { canSaveSearch, PLANS } from "@/lib/entitlements/plans";
import {
  canonicalSearch,
  checkSearchName,
  searchHref,
  workspaceSavedSearches,
} from "./saved-searches";
import { parseCreatorFilters } from "./filters";
import { whereFor } from "./service";

afterAll(() => pool.end());

describe("saved search queries", () => {
  it("are rebuilt from valid filters only, always starting on page one", () => {
    const { query, filterCount } = canonicalSearch({
      platform: "tiktok,myspace",
      niche: "beauty",
      auth: "85",
      page: "7",
      sort: "engagement",
      evil: "<script>",
    });
    expect(query).toBe("platform=tiktok&niche=beauty&auth=85&sort=engagement");
    expect(filterCount).toBe(3);
    expect(query).not.toMatch(/page|evil|myspace/);
  });
  it("round-trip: opening a saved search gives the same filters", () => {
    const first = canonicalSearch({ q: "glow", tier: "micro", safe: "1", eng: "3.5" });
    const again = canonicalSearch(Object.fromEntries(new URLSearchParams(first.query)));
    expect(again).toEqual(first);
    expect(searchHref("acme", first.query)).toBe(`/w/acme/creators?${first.query}`);
    expect(searchHref("acme", "")).toBe("/w/acme/creators");
  });
  it("count no filters when there are none (so there is nothing worth saving)", () => {
    expect(canonicalSearch({}).filterCount).toBe(0);
    expect(canonicalSearch({ sort: "rate", page: "3" }).filterCount).toBe(0);
  });
});

describe("saved search names", () => {
  it("are trimmed and tidied, and must exist and fit", () => {
    expect(checkSearchName("  Beauty   micro-creators ")).toEqual({
      ok: true,
      name: "Beauty micro-creators",
    });
    expect(checkSearchName("   ")).toMatchObject({ ok: false });
    expect(checkSearchName("x".repeat(81))).toMatchObject({ ok: false });
  });
});

describe("saved searches and the plan", () => {
  it("cap how many an account keeps, and name the plan that raises it", () => {
    expect(canSaveSearch("trial", 2)).toEqual({ ok: true });
    expect(canSaveSearch("trial", 3)).toMatchObject({ ok: false, upgradeTo: "growth" });
    expect(canSaveSearch("agency", 99)).toEqual({ ok: true });
    for (const t of ["starter", "growth", "agency"] as const)
      expect(PLANS[t].savedSearches).toBeGreaterThanOrEqual(PLANS.trial.savedSearches);
    expect(PLANS.trial.compareSize).toBeLessThan(PLANS.growth.compareSize);
  });
});

describe("a workspace's saved searches", () => {
  async function ws() {
    const [a] = await db
      .insert(accounts)
      .values({ name: "ss", planTier: "growth", billingStatus: "active" })
      .returning();
    const [w] = await db
      .insert(workspaces)
      .values({
        accountId: a!.id,
        name: "ss",
        slug: `ss-${Math.random().toString(36).slice(2, 9)}`,
      })
      .returning();
    return w!;
  }

  it("come back with how many creators match each today", async () => {
    const w = await ws();
    const a = canonicalSearch({ niche: "beauty", platform: "tiktok" });
    const b = canonicalSearch({ niche: "food", tier: "mega" });
    await db.insert(creatorSavedSearches).values([
      { workspaceId: w.id, name: "Beauty on TikTok", query: a.query },
      { workspaceId: w.id, name: "Mega food", query: b.query },
    ]);
    const list = await workspaceSavedSearches(w.id);
    expect(list.map((s) => s.name)).toEqual(["Beauty on TikTok", "Mega food"]);
    // The count is the same as the discovery page would show for those filters.
    const expected = await db.$count(
      (await import("@/db/client")).creators,
      whereFor(parseCreatorFilters(Object.fromEntries(new URLSearchParams(a.query)))),
    );
    expect(list[0]!.matches).toBe(expected);
    expect(list[0]!.matches).toBeGreaterThan(0);
    expect(list[0]!.filterCount).toBe(2);
  });

  it("can't repeat a name within a workspace, but another workspace may reuse it", async () => {
    const w1 = await ws();
    const w2 = await ws();
    const q = canonicalSearch({ niche: "pets" }).query;
    const insert = (workspaceId: string) =>
      db
        .insert(creatorSavedSearches)
        .values({ workspaceId, name: "Pet people", query: q })
        .onConflictDoNothing()
        .returning();
    expect(await insert(w1.id)).toHaveLength(1);
    expect(await insert(w1.id)).toHaveLength(0);
    expect(await insert(w2.id)).toHaveLength(1);
  });
});
