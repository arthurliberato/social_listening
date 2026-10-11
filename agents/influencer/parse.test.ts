import { describe, expect, it } from "vitest";
import {
  offerFor,
  parseCompact,
  parseRow,
  parseUsd,
  pickBest,
  planFromBrief,
  type RawRow,
} from "./parse";
import type { Candidate } from "./types";

const c = (o: Partial<Candidate>): Candidate => ({
  id: 1,
  name: "A",
  handle: "a",
  platform: "instagram",
  niche: "food",
  followers: 100_000,
  engagement: 3,
  avgViews: 30_000,
  authenticity: 80,
  brandSafe: true,
  rateUsd: 1000,
  ...o,
});

describe("reading the table", () => {
  it("understands compact numbers and dollars", () => {
    expect(parseCompact("2.1M")).toBe(2_100_000);
    expect(parseCompact("592K")).toBe(592_000);
    expect(parseCompact("980")).toBe(980);
    expect(parseUsd("$9,450")).toBe(9450);
  });
  it("turns a row into a candidate, hiding authenticity from an agent that doesn't look", () => {
    const raw: RawRow = {
      href: "/w/x/creators/24899",
      name: "Ana Iverson",
      handleLine: "@anaiverson · Instagram · United Kingdom",
      cells: ["Food", "2.1M", "2.20%", "710K", "94 Strong", "Safe", "$9,450", "", ""],
    };
    expect(parseRow(raw, true)).toMatchObject({
      id: 24899,
      handle: "anaiverson",
      platform: "instagram",
      niche: "food",
      followers: 2_100_000,
      engagement: 2.2,
      authenticity: 94,
      brandSafe: true,
      rateUsd: 9450,
    });
    expect(parseRow(raw, false)!.authenticity).toBeNull();
    expect(parseRow({ ...raw, cells: ["Food"] }, true)).toBeNull();
    expect(
      parseRow(
        { ...raw, cells: [...raw.cells.slice(0, 5), "Review", ...raw.cells.slice(6)] },
        true,
      )!.brandSafe,
    ).toBe(false);
  });
});

describe("working out what a brief means", () => {
  const platforms = ["Instagram", "TikTok", "YouTube", "X"];
  const niches = ["Beauty", "Food", "Travel"];
  it("finds the platform and niche, with coffee meaning food", () => {
    expect(
      planFromBrief("Find Instagram creators for our spring latte launch", platforms, niches),
    ).toMatchObject({
      platform: "Instagram",
      niche: "food",
    });
    expect(planFromBrief("Looking for travel people on TikTok", platforms, niches)).toMatchObject({
      platform: "TikTok",
      niche: "Travel",
    });
    expect(planFromBrief("Find us someone good", platforms, niches)).toMatchObject({
      platform: null,
      niche: null,
    });
  });
});

describe("choosing creators", () => {
  const pool = [
    c({ id: 1, followers: 2_000_000, authenticity: 40, rateUsd: 9000, engagement: 1 }),
    c({ id: 2, followers: 300_000, authenticity: 90, rateUsd: 900, engagement: 4 }),
    c({ id: 3, followers: 200_000, authenticity: 85, rateUsd: 700, engagement: 3.5 }),
    c({
      id: 4,
      followers: 150_000,
      authenticity: 95,
      rateUsd: 600,
      engagement: 5,
      brandSafe: false,
    }),
    c({ id: 5, followers: 120_000, authenticity: 88, rateUsd: 800, engagement: 3 }),
  ];
  it("a careful pick prefers real engagement and trust, skips the unsafe, and stays in budget", () => {
    const got = pickBest(pool, 3, { sizeBias: false, budgetUsd: 3000 });
    expect(got).toHaveLength(3);
    const ids = got.map((x) => x.id);
    expect(ids).not.toContain(4);
    expect(ids).not.toContain(1);
    expect(got.reduce((a, x) => a + x.rateUsd, 0)).toBeLessThanOrEqual(3000);
  });
  it("leaves room in the budget for the picks still to come", () => {
    // The best account alone would eat the whole budget; taking it would leave nothing for the other two.
    const two = [
      c({ id: 10, avgViews: 900_000, engagement: 5, rateUsd: 2800 }),
      c({ id: 11, avgViews: 40_000, engagement: 3, rateUsd: 500 }),
      c({ id: 12, avgViews: 30_000, engagement: 3, rateUsd: 400 }),
      c({ id: 13, avgViews: 20_000, engagement: 3, rateUsd: 300 }),
    ];
    const got = pickBest(two, 3, { sizeBias: false, budgetUsd: 3000 });
    expect(got).toHaveLength(3);
    expect(got.map((x) => x.id)).not.toContain(10);
    expect(got.reduce((a, x) => a + x.rateUsd, 0)).toBeLessThanOrEqual(3000);
  });
  it("a size-chaser takes the biggest accounts and ignores the budget", () => {
    const got = pickBest(pool, 3, { sizeBias: true, budgetUsd: 3000 }).map((x) => x.id);
    expect(got[0]).toBe(1);
  });
  it("offers the asking rate unless the agent is tracking the budget", () => {
    const x = c({ rateUsd: 2500 });
    expect(offerFor(x, { tracksBudget: false, remainingUsd: 1000, slotsLeft: 2 })).toBe(2500);
    expect(offerFor(x, { tracksBudget: true, remainingUsd: 1000, slotsLeft: 2 })).toBe(500);
    expect(
      offerFor(c({ rateUsd: 300 }), { tracksBudget: true, remainingUsd: 1000, slotsLeft: 2 }),
    ).toBe(300);
  });
});
