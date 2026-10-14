import { describe, expect, it } from "vitest";
import { evaluateSurvey, type SurveyFacts, type SurveyHistory } from "./eligibility";
import type { SurveyId } from "./definitions";

const NONE: SurveyHistory = { shownAt: null, answeredAt: null, dismissedAt: null };
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000);
const facts = (
  over: Partial<SurveyFacts> = {},
  hist: Partial<Record<SurveyId, SurveyHistory>> = {},
) =>
  ({
    userId: "00000000-0000-4000-8000-000000000001",
    now: day(20),
    signupAt: day(0),
    onboardingCompletedAt: null,
    sessions: 5,
    history: { seq: NONE, umux_lite: NONE, nps: NONE, ...hist },
    ...over,
  }) satisfies SurveyFacts;

/** A user id whose sampling bucket falls on the asked side for a 50% survey (found by search, so the test does not depend on a hash value). */
function userWhere(id: SurveyId, asked: boolean) {
  for (let i = 0; i < 200; i++) {
    const userId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const e = evaluateSurvey(id, facts({ userId }));
    if (e.eligible === asked) return userId;
  }
  throw new Error("no such user");
}

describe("survey eligibility", () => {
  it("SEQ applies only within a day of finishing setup, and once", () => {
    const now = day(3);
    expect(evaluateSurvey("seq", facts({ now }))).toMatchObject({ triggered: false });
    const done = (h: number) => new Date(now.getTime() - h * 3_600_000);
    expect(evaluateSurvey("seq", facts({ now, onboardingCompletedAt: done(2) }))).toMatchObject({
      eligible: true,
    });
    expect(evaluateSurvey("seq", facts({ now, onboardingCompletedAt: done(30) }))).toMatchObject({
      triggered: false,
    });
    const asked = { seq: { ...NONE, shownAt: done(1) } };
    expect(
      evaluateSurvey("seq", facts({ now, onboardingCompletedAt: done(2) }, asked)),
    ).toMatchObject({ eligible: false, reason: "already_asked" });
  });

  it("UMUX-Lite needs a week and three visits", () => {
    const userId = userWhere("umux_lite", true);
    expect(evaluateSurvey("umux_lite", facts({ userId, now: day(6) })).triggered).toBe(false);
    expect(evaluateSurvey("umux_lite", facts({ userId, sessions: 2 })).triggered).toBe(false);
    expect(evaluateSurvey("umux_lite", facts({ userId }))).toMatchObject({ eligible: true });
  });

  it("a 50% survey leaves some people out and says so", () => {
    const userId = userWhere("umux_lite", false);
    expect(evaluateSurvey("umux_lite", facts({ userId }))).toMatchObject({
      triggered: true,
      eligible: false,
      reason: "sampled_out",
    });
  });

  it("respects the cooldown and the one-survey-a-day gap", () => {
    const userId = userWhere("nps", true);
    const recent = (d: number) => ({ ...NONE, answeredAt: day(d) });
    expect(evaluateSurvey("nps", facts({ userId }, { nps: recent(-50) }))).toMatchObject({
      reason: "cooldown",
    });
    expect(evaluateSurvey("nps", facts({ userId }, { nps: recent(-100) }))).toMatchObject({
      eligible: true,
    });
    expect(
      evaluateSurvey("nps", facts({ userId, now: day(20.5) }, { umux_lite: recent(20) })),
    ).toMatchObject({ reason: "another_survey_recent" });
  });
});
