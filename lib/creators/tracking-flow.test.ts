import { describe, expect, it } from "vitest";
import {
  checkConversion,
  checkDestination,
  dailySeries,
  destinationFor,
  isBotAgent,
  isClickId,
  isLinkCode,
  newClickId,
  newLinkCode,
  resultsOf,
  withinWindow,
} from "./tracking-flow";

describe("tracking links", () => {
  it("makes short, unambiguous, unguessable codes", () => {
    const codes = new Set(Array.from({ length: 500 }, newLinkCode));
    expect(codes.size).toBe(500);
    for (const c of codes) expect(isLinkCode(c)).toBe(true);
    expect(isLinkCode("abcdefghij")).toBe(false); // contains i
    expect(isLinkCode("short")).toBe(false);
    expect(isLinkCode("ABCDEFGHJK")).toBe(false);
    expect(isClickId(newClickId())).toBe(true);
  });
  it("accepts a real page and refuses anything else as a destination", () => {
    expect(checkDestination(" https://shop.example.test/launch?a=1 ")).toEqual({
      ok: true,
      url: "https://shop.example.test/launch?a=1",
    });
    for (const bad of [
      "",
      "shop.example.test",
      "javascript:alert(1)",
      "ftp://x.test",
      "https://user:pw@x.test/",
      `https://x.test/${"a".repeat(600)}`,
    ])
      expect(checkDestination(bad)).toMatchObject({ ok: false });
  });
  it("tags the destination without overriding the brand's own tags", () => {
    const url = destinationFor("https://shop.example.test/launch?utm_source=newsletter&x=1#top", {
      creatorHandle: "Glow_Alder",
      campaignId: "0123456789abcdef",
      clickId: "a".repeat(24),
    });
    const u = new URL(url);
    expect(u.searchParams.get("utm_source")).toBe("newsletter"); // brand's wins
    expect(u.searchParams.get("utm_medium")).toBe("influencer");
    expect(u.searchParams.get("utm_campaign")).toBe("01234567");
    expect(u.searchParams.get("rw_cid")).toBe("a".repeat(24));
    expect(u.searchParams.get("x")).toBe("1");
    expect(u.hash).toBe("#top");
    expect(
      new URL(
        destinationFor("https://shop.example.test/", {
          creatorHandle: "Glow_Alder",
          campaignId: "0123456789",
          clickId: "b".repeat(24),
        }),
      ).searchParams.get("utm_source"),
    ).toBe("glow_alder");
  });
  it("tells crawlers from browsers", () => {
    for (const ua of [
      "Googlebot/2.1 (+http://www.google.com/bot.html)",
      "facebookexternalhit/1.1",
      "Slackbot-LinkExpanding 1.0",
      "curl/8.4.0",
      "python-requests/2.31",
      null,
      "",
    ])
      expect(isBotAgent(ua)).toBe(true);
    for (const ua of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      // A real browser run by an automated agent still counts as a visitor.
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36",
    ])
      expect(isBotAgent(ua)).toBe(false);
  });
});

describe("conversions", () => {
  it("takes a dollar value and an optional order reference", () => {
    expect(checkConversion({ value: "49.6", ref: "order-1001" })).toEqual({
      ok: true,
      valueUsd: 50,
      ref: "order-1001",
    });
    expect(checkConversion({})).toEqual({ ok: true, valueUsd: 0, ref: null });
    for (const bad of [
      { value: -1 },
      { value: "abc" },
      { value: 1e9 },
      { ref: "has space" },
      { ref: "x".repeat(101) },
    ])
      expect(checkConversion(bad)).toMatchObject({ ok: false });
  });
  it("only credits a click inside the attribution window", () => {
    const click = new Date("2026-10-01T00:00:00Z");
    expect(withinWindow(click, new Date("2026-10-30T00:00:00Z"))).toBe(true);
    expect(withinWindow(click, new Date("2026-11-01T00:00:00Z"))).toBe(false);
    expect(withinWindow(click, new Date("2026-09-30T00:00:00Z"))).toBe(false); // before the click
  });
});

describe("results", () => {
  it("works out cost and return, and says null when it can't", () => {
    expect(
      resultsOf({ clicks: 200, visitors: 150, conversions: 15, revenueUsd: 1800, spendUsd: 600 }),
    ).toEqual({
      clicks: 200,
      visitors: 150,
      conversions: 15,
      revenueUsd: 1800,
      spendUsd: 600,
      cpc: 3,
      cpa: 40,
      roas: 3,
      conversionRate: 10,
    });
    const none = resultsOf({
      clicks: 0,
      visitors: 0,
      conversions: 0,
      revenueUsd: 0,
      spendUsd: 500,
    });
    expect(none).toMatchObject({ cpc: null, cpa: null, conversionRate: null, roas: 0 });
    expect(
      resultsOf({ clicks: 5, visitors: 5, conversions: 1, revenueUsd: 10, spendUsd: 0 }).roas,
    ).toBeNull();
  });
  it("zero-fills a daily series and ignores days outside it", () => {
    const now = new Date("2026-10-07T15:00:00Z");
    const s = dailySeries(
      [
        new Date("2026-10-07T01:00:00Z"),
        new Date("2026-10-07T23:00:00Z"),
        new Date("2026-10-05T12:00:00Z"),
        new Date("2026-09-01T00:00:00Z"),
      ],
      [new Date("2026-10-06T10:00:00Z")],
      now,
      4,
    );
    expect(s.map((p) => p.day)).toEqual(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(s.map((p) => p.clicks)).toEqual([0, 1, 0, 2]);
    expect(s.map((p) => p.conversions)).toEqual([0, 0, 1, 0]);
  });
});
