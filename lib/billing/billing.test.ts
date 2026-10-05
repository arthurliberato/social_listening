import { describe, expect, it } from "vitest";
import { checkCard, formatCardNumber, luhn, parseExpiry } from "./cards";
import {
  addPeriod,
  applyDiscount,
  isUpgrade,
  money,
  mrrCents,
  periodPriceCents,
  unusedCreditCents,
} from "./pricing";

const d = (s: string) => new Date(s);
const NOW = d("2026-10-03T12:00:00Z");
const card = (number: string, over = {}) => ({
  number,
  expMonth: 12,
  expYear: 2030,
  cvc: "123",
  name: "A Person",
  ...over,
});

describe("pricing", () => {
  it("yearly is ten months", () => {
    expect(periodPriceCents("growth", "monthly")).toBe(24_900);
    expect(periodPriceCents("growth", "yearly")).toBe(249_000);
    expect(periodPriceCents("enterprise", "monthly")).toBeNull();
    expect(mrrCents("growth", "yearly")).toBe(20_750);
    expect(mrrCents("trial", "monthly")).toBe(0);
  });
  it("formats money", () => {
    expect(money(24_900)).toBe("$249");
    expect(money(20_750)).toBe("$207.50");
    expect(money(249_000)).toBe("$2,490");
  });
  it("adds calendar periods, clamping the day at month end", () => {
    expect(addPeriod(d("2026-01-31T00:00:00Z"), "monthly").toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(addPeriod(d("2028-01-31T00:00:00Z"), "monthly").toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
    expect(addPeriod(d("2026-10-03T08:00:00Z"), "yearly").toISOString()).toBe(
      "2027-10-03T08:00:00.000Z",
    );
    expect(addPeriod(d("2026-12-15T00:00:00Z"), "monthly").toISOString()).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });
  it("upgrades are anything that costs more per month", () => {
    const g = { tier: "growth", interval: "monthly" } as const;
    expect(isUpgrade(g, { tier: "agency", interval: "monthly" })).toBe(true);
    expect(isUpgrade(g, { tier: "starter", interval: "monthly" })).toBe(false);
    expect(isUpgrade(g, { tier: "growth", interval: "yearly" })).toBe(false); // cheaper per month: waits for renewal
    expect(
      isUpgrade({ tier: "starter", interval: "yearly" }, { tier: "growth", interval: "monthly" }),
    ).toBe(true);
  });
  it("credits the unused part of the period", () => {
    const o = {
      tier: "growth" as const,
      interval: "monthly" as const,
      periodStart: d("2026-10-01T00:00:00Z"),
      periodEnd: d("2026-10-31T00:00:00Z"),
    };
    expect(unusedCreditCents({ ...o, now: d("2026-10-01T00:00:00Z") })).toBe(24_900); // all of it
    expect(unusedCreditCents({ ...o, now: d("2026-10-16T00:00:00Z") })).toBe(12_450); // half
    expect(unusedCreditCents({ ...o, now: d("2026-11-05T00:00:00Z") })).toBe(0); // after the end
    // A discounted period only credits what was actually paid.
    expect(unusedCreditCents({ ...o, now: d("2026-10-16T00:00:00Z"), discountPct: 25 })).toBe(
      9_338,
    );
  });
  it("applies a percentage discount", () => {
    expect(applyDiscount(24_900, 25)).toEqual({ charge: 18_675, discount: 6_225 });
    expect(applyDiscount(24_900, 0)).toEqual({ charge: 24_900, discount: 0 });
  });
});

describe("cards", () => {
  it("luhn", () => {
    expect(luhn("4242424242424242")).toBe(true);
    expect(luhn("4242424242424241")).toBe(false);
  });
  it("accepts the success card and reads brand and last 4", () => {
    expect(checkCard(card("4242 4242 4242 4242"), NOW)).toEqual({
      ok: true,
      brand: "Visa",
      last4: "4242",
      behavior: "ok",
    });
    expect(checkCard(card("5555555555554444"), NOW)).toMatchObject({
      ok: true,
      brand: "Mastercard",
    });
  });
  it("test numbers: one fails on renewal, one is declined at once", () => {
    expect(checkCard(card("4000000000000341"), NOW)).toMatchObject({
      ok: true,
      behavior: "fail_renewal",
    });
    expect(checkCard(card("4000000000000002"), NOW)).toMatchObject({ ok: false, field: "number" });
  });
  it("validates each field with a specific message", () => {
    expect(checkCard(card("1234"), NOW)).toMatchObject({ ok: false, field: "number" });
    expect(checkCard(card("4242424242424242", { expMonth: 9, expYear: 2026 }), NOW)).toMatchObject({
      ok: false,
      field: "expiry",
      error: expect.stringContaining("expired"),
    });
    expect(checkCard(card("4242424242424242", { expMonth: 10, expYear: 2026 }), NOW)).toMatchObject(
      { ok: true },
    ); // valid through the end of the month
    expect(checkCard(card("4242424242424242", { expMonth: 13 }), NOW)).toMatchObject({
      ok: false,
      field: "expiry",
    });
    expect(checkCard(card("4242424242424242", { cvc: "12" }), NOW)).toMatchObject({
      ok: false,
      field: "cvc",
    });
    expect(checkCard(card("4242424242424242", { name: " " }), NOW)).toMatchObject({
      ok: false,
      field: "name",
    });
  });
  it("formats and parses as people type", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(parseExpiry("12/30")).toEqual({ expMonth: 12, expYear: 2030 });
    expect(parseExpiry("1230")).toEqual({ expMonth: 12, expYear: 2030 });
    expect(parseExpiry("nope")).toBeNull();
  });
});
