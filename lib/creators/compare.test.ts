import { describe, expect, it } from "vitest";
import { bestOf, compareHref, costPer1kViews, parseCompareIds } from "./compare";

describe("which creators to compare", () => {
  it("reads a comma list, keeps order, drops repeats and junk", () => {
    expect(parseCompareIds("5, 3,5,abc,-2,0,1.5,7", 6)).toEqual({
      ids: [5, 3, 7],
      truncated: false,
    });
    expect(parseCompareIds(["2,3", "4"], 6).ids).toEqual([2, 3, 4]);
    expect(parseCompareIds(undefined, 6)).toEqual({ ids: [], truncated: false });
    expect(parseCompareIds("9999999999,1", 6).ids).toEqual([1]);
  });
  it("keeps the first few the plan allows and says so", () => {
    expect(parseCompareIds("1,2,3,4,5", 2)).toEqual({ ids: [1, 2], truncated: true });
    expect(parseCompareIds("1,2", 2).truncated).toBe(false);
  });
  it("never reads more than a dozen", () => {
    const many = Array.from({ length: 50 }, (_, i) => i + 1).join(",");
    expect(parseCompareIds(many, 100).ids).toHaveLength(12);
  });
  it("builds a link back", () =>
    expect(compareHref("acme", [3, 9])).toBe("/w/acme/creators/compare?ids=3,9"));
});

describe("comparing numbers", () => {
  it("works out what a thousand views cost", () => {
    expect(costPer1kViews(800, 40_000)).toBe(20);
    expect(costPer1kViews(525, 12_345)).toBe(42.53);
    expect(costPer1kViews(100, 0)).toBeNull();
  });
  it("marks the best, with ties sharing it", () => {
    expect(bestOf([3.2, 5.1, 4.0], "high")).toEqual([1]);
    expect(bestOf([30, 12, 12, 40], "low")).toEqual([1, 2]);
  });
  it("marks nothing when it would mislead", () => {
    expect(bestOf([5, 5, 5], "high")).toEqual([]); // all equal
    expect(bestOf([5, null], "high")).toEqual([]); // only one to compare
    expect(bestOf([null, null], "low")).toEqual([]);
    expect(bestOf([1, 2], null)).toEqual([]); // a fact, not a score
  });
  it("ignores missing values but keeps positions", () => {
    expect(bestOf([null, 10, 20], "high")).toEqual([2]);
  });
});
