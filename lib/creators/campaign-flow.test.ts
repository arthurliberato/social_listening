import { describe, expect, it } from "vitest";
import { CREATOR_STATUSES, budgetSummary, checkMove, nextStatuses } from "./campaign-flow";

describe("campaign pipeline", () => {
  it("only offers moves checkMove accepts, and never loops back on itself", () => {
    for (const from of CREATOR_STATUSES)
      for (const to of nextStatuses(from)) {
        expect(to).not.toBe(from);
        expect(checkMove(from, to, 500)).toEqual({ ok: true });
      }
  });
  it("refuses skipping steps", () => {
    expect(checkMove("shortlisted", "paid", 500)).toMatchObject({ ok: false });
    expect(checkMove("invited", "approved", 500)).toMatchObject({ ok: false });
    expect(checkMove("paid", "declined", 500)).toMatchObject({ ok: false });
  });
  it("needs a fee to confirm, but not to send content back for changes", () => {
    expect(checkMove("negotiating", "confirmed", null)).toMatchObject({ ok: false });
    expect(checkMove("negotiating", "confirmed", 0)).toMatchObject({ ok: false });
    expect(checkMove("negotiating", "confirmed", 750)).toEqual({ ok: true });
    expect(checkMove("content_submitted", "confirmed", null)).toEqual({ ok: true });
  });
  it("counts only agreed fees against the budget", () => {
    const b = budgetSummary(2000, [
      { status: "shortlisted", feeUsd: 900 },
      { status: "negotiating", feeUsd: 900 },
      { status: "confirmed", feeUsd: 500 },
      { status: "paid", feeUsd: 700 },
      { status: "declined", feeUsd: 300 },
    ]);
    expect(b).toMatchObject({ committed: 1200, paid: 700, remaining: 800, pct: 60, over: false });
  });
  it("flags an exceeded budget and handles a zero budget", () => {
    expect(budgetSummary(1000, [{ status: "approved", feeUsd: 1500 }])).toMatchObject({
      over: true,
      pct: 100,
      remaining: -500,
    });
    expect(budgetSummary(0, [])).toMatchObject({ pct: 0, over: false });
  });
});
