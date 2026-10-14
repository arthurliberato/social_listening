import { bucket } from "@/lib/flags";
import { ANY_SURVEY_GAP_HOURS, SURVEYS, type SurveyId } from "./definitions";

const DAY = 86_400_000;

export interface SurveyHistory {
  shownAt: Date | null;
  answeredAt: Date | null;
  dismissedAt: Date | null;
}

export interface SurveyFacts {
  userId: string;
  now: Date;
  signupAt: Date;
  onboardingCompletedAt: Date | null;
  /** Distinct visits (sessions) the person has made. */
  sessions: number;
  history: Record<SurveyId, SurveyHistory>;
}

export type EligibilityReason =
  "eligible" | "already_asked" | "cooldown" | "another_survey_recent" | "sampled_out";

export interface Eligibility {
  /** False: the person has not reached the point where this survey could apply, so nothing is logged about it. */
  triggered: boolean;
  eligible: boolean;
  reason: EligibilityReason | null;
}

const lastTouched = (h: SurveyHistory): Date | null =>
  [h.shownAt, h.answeredAt, h.dismissedAt].reduce<Date | null>(
    (a, d) => (d && (!a || d > a) ? d : a),
    null,
  );

function triggered(id: SurveyId, f: SurveyFacts): boolean {
  const daysSinceSignup = (f.now.getTime() - f.signupAt.getTime()) / DAY;
  switch (SURVEYS[id].trigger) {
    // Only right after finishing setup: asked later, the answer would be about something else.
    case "onboarding_completed":
      return (
        !!f.onboardingCompletedAt && f.now.getTime() - f.onboardingCompletedAt.getTime() <= DAY
      );
    case "established_user":
      return daysSinceSignup >= 7 && f.sessions >= 3;
    case "long_term_user":
      return daysSinceSignup >= 14;
  }
}

/**
 * Whether this person should be asked this survey now, and if not, why not. The reason is logged (once per visit and
 * survey) so that analysis can tell who was never asked from who was asked and did not answer, which is the difference
 * between a sampling choice and non-response.
 */
export function evaluateSurvey(id: SurveyId, f: SurveyFacts): Eligibility {
  if (!triggered(id, f)) return { triggered: false, eligible: false, reason: null };
  const def = SURVEYS[id];
  const mine = f.history[id];
  const last = lastTouched(mine);
  const no = (reason: EligibilityReason): Eligibility => ({
    triggered: true,
    eligible: false,
    reason,
  });
  if (last && def.cooldownDays === Infinity) return no("already_asked");
  if (last && f.now.getTime() - last.getTime() < def.cooldownDays * DAY) return no("cooldown");
  const anyRecent = Object.values(f.history).some((h) => {
    const t = lastTouched(h);
    return t && f.now.getTime() - t.getTime() < ANY_SURVEY_GAP_HOURS * 3_600_000;
  });
  if (anyRecent) return no("another_survey_recent");
  if (bucket(`survey:${id}`, f.userId) / 10_000 >= def.sampleRate) return no("sampled_out");
  return { triggered: true, eligible: true, reason: "eligible" };
}
