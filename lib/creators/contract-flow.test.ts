import { describe, expect, it } from "vitest";
import {
  checkPayoutDetails,
  checkSignature,
  checkTerms,
  outcomeFor,
  payBlocker,
  renderContract,
  settleAt,
  SETTLE_DAYS,
  termsSummary,
  type PayState,
} from "./contract-flow";

const ok = {
  deliverables: "One Reel and three stories",
  usageDays: 90,
  exclusivityDays: 30,
  paymentDays: 14,
};

describe("contract terms", () => {
  it("accepts sensible terms and fills the optional ones", () => {
    const r = checkTerms({ ...ok, dueOn: "2026-11-01", extra: " No alcohol brands. " });
    expect(r).toMatchObject({
      ok: true,
      terms: { dueOn: "2026-11-01", extra: "No alcohol brands." },
    });
    expect(checkTerms({ deliverables: "A video" })).toMatchObject({
      ok: true,
      terms: { usageDays: 0, paymentDays: 0, dueOn: null },
    });
  });
  it("refuses empty, over-long or out-of-list terms", () => {
    for (const bad of [
      { ...ok, deliverables: "  " },
      { ...ok, deliverables: "x".repeat(501) },
      { ...ok, usageDays: 45 },
      { ...ok, exclusivityDays: -1 },
      { ...ok, exclusivityDays: 400 },
      { ...ok, exclusivityDays: 1.5 },
      { ...ok, paymentDays: 10 },
      { ...ok, dueOn: "next week" },
      { ...ok, extra: "x".repeat(1501) },
    ])
      expect(checkTerms(bad)).toMatchObject({ ok: false });
  });
  it("renders the same agreement every time, in plain words, with the fee and the dates", () => {
    const checked = checkTerms({ ...ok, dueOn: "2026-11-01" });
    if (!checked.ok) throw new Error(checked.reason);
    const terms = checked.terms;
    const text = renderContract({
      brand: "Latte Lane",
      creator: "Ana Alder",
      campaign: "Spring launch",
      feeUsd: 1500,
      terms,
    });
    expect(text).toBe(
      renderContract({
        brand: "Latte Lane",
        creator: "Ana Alder",
        campaign: "Spring launch",
        feeUsd: 1500,
        terms,
      }),
    );
    expect(text).toContain("$1,500");
    expect(text).toContain("due by 2026-11-01");
    expect(text).toContain("within 14 days of approving");
    expect(text).toContain("for 90 days after it is approved");
    expect(text).toContain("For 30 days after posting");
    expect(text).not.toContain("9. Additional terms");
    expect(termsSummary(terms)).toBe("90 days usage · 30 days exclusivity · pay within 14 days");
  });
});

describe("signing", () => {
  it("needs a typed name and an explicit yes", () => {
    expect(checkSignature("  Ana   Alder ", true)).toEqual({ ok: true, name: "Ana Alder" });
    expect(checkSignature("A", true)).toMatchObject({ ok: false });
    expect(checkSignature("Ana Alder", false)).toMatchObject({ ok: false });
    expect(checkSignature("x".repeat(101), true)).toMatchObject({ ok: false });
  });
});

describe("payout details", () => {
  const base = { holderName: "Ana Alder", accountNumber: "0001 2345 6789", country: "us" };
  it("keeps only the last four digits and how the account behaves", () => {
    const r = checkPayoutDetails(base);
    expect(r).toEqual({
      ok: true,
      holderName: "Ana Alder",
      last4: "6789",
      country: "US",
      behavior: "ok",
    });
    expect(JSON.stringify(r)).not.toContain("000123456789");
  });
  it("applies the test accounts", () => {
    expect(checkPayoutDetails({ ...base, accountNumber: "000999999991" })).toMatchObject({
      ok: true,
      behavior: "fail_payout",
    });
    expect(checkPayoutDetails({ ...base, accountNumber: "000999999992" })).toMatchObject({
      ok: false,
      field: "accountNumber",
    });
  });
  it("names the field that's wrong", () => {
    expect(checkPayoutDetails({ ...base, holderName: " " })).toMatchObject({
      ok: false,
      field: "holderName",
    });
    expect(checkPayoutDetails({ ...base, accountNumber: "123" })).toMatchObject({
      ok: false,
      field: "accountNumber",
    });
    expect(checkPayoutDetails({ ...base, accountNumber: "abcdefghij" })).toMatchObject({
      ok: false,
      field: "accountNumber",
    });
    expect(checkPayoutDetails({ ...base, country: "USA" })).toMatchObject({
      ok: false,
      field: "country",
    });
  });
});

describe("paying a creator", () => {
  const ready: PayState = {
    rosterStatus: "approved",
    feeUsd: 800,
    hasDetails: true,
    contractOutstanding: false,
    activePayout: false,
  };
  it("goes ahead only when everything the brand and creator owe is done", () => {
    expect(payBlocker(ready)).toBeNull();
    expect(payBlocker({ ...ready, rosterStatus: "content_submitted" })).toMatch(/Approve/);
    expect(payBlocker({ ...ready, rosterStatus: "confirmed" })).toMatch(/Approve/);
    expect(payBlocker({ ...ready, feeUsd: null })).toMatch(/fee/);
    expect(payBlocker({ ...ready, feeUsd: 0 })).toMatch(/fee/);
    expect(payBlocker({ ...ready, contractOutstanding: true })).toMatch(/signed/);
    expect(payBlocker({ ...ready, hasDetails: false })).toMatch(/payout details/);
    expect(payBlocker({ ...ready, activePayout: true })).toMatch(/already on its way/);
    expect(payBlocker({ ...ready, rosterStatus: "paid" })).toMatch(/already been paid/);
  });
  it("settles after the simulated delay, or fails on a bad account", () => {
    const t = new Date("2026-10-07T12:00:00Z");
    expect(settleAt(t).getTime() - t.getTime()).toBe(SETTLE_DAYS * 86_400_000);
    expect(outcomeFor("ok")).toEqual({ status: "paid" });
    expect(outcomeFor("fail_payout")).toMatchObject({ status: "failed" });
  });
});
