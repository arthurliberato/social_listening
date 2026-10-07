import { describe, expect, it } from "vitest";
import { bandOf, health, pqa, PQA_THRESHOLD, type Signals } from "./score";

const base: Signals = {
  tier: "growth",
  billingStatus: "active",
  motion: "self_serve",
  liveQueries: 0,
  alerts: 0,
  dashboards: 0,
  schedules: 0,
  seatsUsed: 1,
  seatsLimit: 10,
  mentionsPct: 0,
  aiPct: 0,
  paywallsViewed14d: 0,
  activeDays14d: 0,
  activeUsers14d: 0,
  daysSinceActive: null,
  cancelAtPeriodEnd: false,
  openSalesRequest: false,
  creatorLists: 0,
  activeCampaigns: 0,
  creatorProfilesPct: 0,
  invitationsPct: 0,
  productsUsed: [],
};
const power: Signals = {
  ...base,
  liveQueries: 5,
  alerts: 3,
  dashboards: 4,
  schedules: 2,
  seatsUsed: 8,
  mentionsPct: 90,
  activeDays14d: 10,
  activeUsers14d: 6,
  daysSinceActive: 0,
};

describe("PQA", () => {
  it("a brand-new account scores zero", () => expect(pqa(base).score).toBe(0));
  it("a heavy, growing account clears the sales threshold, with reasons", () => {
    const r = pqa(power);
    expect(r.score).toBeGreaterThanOrEqual(PQA_THRESHOLD);
    expect(r.eligible).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(3);
    expect(r.reasons.join(" ")).toMatch(/90% of monthly mentions/);
  });
  it("is capped at 100", () => {
    expect(
      pqa({ ...power, aiPct: 90, paywallsViewed14d: 9, seatsUsed: 10 }).score,
    ).toBeLessThanOrEqual(100);
  });
  it("hits are individually small: one signal is not a lead", () => {
    expect(pqa({ ...base, liveQueries: 4 }).score).toBeLessThan(PQA_THRESHOLD);
  });
  it("accounts already with sales, on Enterprise, or locked are never leads", () => {
    expect(pqa({ ...power, tier: "enterprise" }).eligible).toBe(false);
    expect(pqa({ ...power, motion: "sales_assisted" }).eligible).toBe(false);
    expect(pqa({ ...power, openSalesRequest: true }).eligible).toBe(false);
    expect(pqa({ ...power, billingStatus: "locked" }).eligible).toBe(false);
    expect(pqa({ ...power, billingStatus: "canceled" }).eligible).toBe(false);
  });
});

describe("PQA across products", () => {
  it("Influencers depth adds points, with reasons", () => {
    const r = pqa({ ...base, activeCampaigns: 3, creatorProfilesPct: 85, invitationsPct: 90 });
    expect(r.score).toBe(30);
    expect(r.reasons.join(" ")).toMatch(/3 active campaigns/);
    expect(r.reasons.join(" ")).toMatch(/creator invitations used/);
  });
  it("using both products is a signal on its own", () => {
    expect(pqa({ ...base, productsUsed: ["listening", "influencers"] }).reasons.join(" ")).toMatch(
      /both products/,
    );
    expect(pqa({ ...base, productsUsed: ["influencers"] }).score).toBe(0);
  });
  it("an account that only uses Influencers still reads as engaged", () => {
    const only = health({
      ...base,
      productsUsed: ["influencers"],
      activeDays14d: 8,
      activeUsers14d: 3,
      daysSinceActive: 0,
    });
    expect(only.band).toBe("healthy");
    expect(only.reasons.join(" ")).toMatch(/1 of 5 core features/);
  });
});

describe("health", () => {
  it("bands at 40 and 70", () => {
    expect(bandOf(70)).toBe("healthy");
    expect(bandOf(69)).toBe("watch");
    expect(bandOf(40)).toBe("watch");
    expect(bandOf(39)).toBe("at_risk");
  });
  it("an engaged account is healthy", () => expect(health(power).band).toBe("healthy"));
  it("a silent account is at risk", () => {
    const h = health({ ...base, liveQueries: 1, daysSinceActive: 30, activeUsers14d: 0 });
    expect(h.band).toBe("at_risk");
    expect(h.reasons.join(" ")).toMatch(/quiet for 30 days/);
  });
  it("past due and a scheduled cancellation pull a healthy account down", () => {
    const worse = health({ ...power, billingStatus: "past_due", cancelAtPeriodEnd: true });
    expect(worse.score).toBeLessThan(health(power).score - 40);
    expect(worse.band).not.toBe("healthy");
  });
  it("stays within 0–100", () => {
    expect(health({ ...base, billingStatus: "locked", cancelAtPeriodEnd: true }).score).toBe(0);
  });
});
