import { describe, expect, it } from "vitest";
import { AGE_BANDS, generateCreator, generateCreators, tierOf } from "./creators";

describe("creator datagen", () => {
  it("is reproducible and order independent", () => {
    expect(generateCreator(42, 7)).toEqual(generateCreators(42, 20)[6]);
    expect(generateCreator(42, 7)).not.toEqual(generateCreator(43, 7));
  });
  it("produces coherent audiences", () => {
    for (const c of generateCreators(42, 400)) {
      const ages = AGE_BANDS.reduce((a, b) => a + c.audience.age[b], 0);
      expect(ages).toBe(100);
      const g = c.audience.gender;
      expect(g.female + g.male + g.other).toBe(100);
      expect(c.audience.countries.reduce((a, x) => a + x.pct, 0)).toBe(100);
      expect(c.audience.countries.every((x) => x.pct >= 0)).toBe(true);
      expect(c.authenticityScore).toBeGreaterThanOrEqual(5);
      expect(c.authenticityScore).toBeLessThanOrEqual(99);
    }
  });
  it("seeds a realistic share of suspicious accounts", () => {
    const all = generateCreators(42, 5000);
    const sus = all.filter((c) => c.fakeFollowerPct >= 28).length / all.length;
    expect(sus).toBeGreaterThan(0.05);
    expect(sus).toBeLessThan(0.14);
    expect(new Set(all.map((c) => tierOf(c.followers))).size).toBeGreaterThanOrEqual(4);
  });
});
