import { describe, expect, it } from "vitest";
import { activeFilterCount, filtersToParams, parseCreatorFilters } from "./filters";

describe("creator filters", () => {
  it("round-trips through the URL", () => {
    const f = parseCreatorFilters({
      q: "glow",
      platform: "instagram,tiktok",
      niche: "beauty",
      tier: "micro",
      eng: "3.5",
      auth: "80",
      safe: "1",
      sort: "engagement",
      page: "3",
    });
    expect(parseCreatorFilters(Object.fromEntries(filtersToParams(f)))).toEqual(f);
    expect(activeFilterCount(f)).toBe(7);
  });
  it("drops unknown or hostile values", () => {
    const f = parseCreatorFilters({
      platform: "myspace,tiktok",
      niche: "'; drop table creators;--",
      sort: "password",
      page: "-4",
      eng: "abc",
      country: "us,GB,GBR",
    });
    expect(f.platforms).toEqual(["tiktok"]);
    expect(f.niches).toEqual([]);
    expect(f.sort).toBe("followers");
    expect(f.page).toBe(1);
    expect(f.minEngagement).toBeNull();
    expect(f.countries).toEqual(["GB"]);
  });
  it("clamps numeric ranges", () => {
    expect(parseCreatorFilters({ auth: "900" }).minAuthenticity).toBe(100);
  });
});
