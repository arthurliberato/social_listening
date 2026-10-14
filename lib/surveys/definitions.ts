// The surveys people can be asked, exactly as worded. Wording and scales are fixed here so that every answer in the
// warehouse means the same thing; change them and the old and new answers are no longer comparable.

export type SurveyId = "seq" | "umux_lite" | "nps";

export interface SurveyItem {
  id: string;
  text: string;
}

export interface SurveyDefinition {
  id: SurveyId;
  title: string;
  /** What puts a person in line for it (the rules are in eligibility.ts). */
  trigger: "onboarding_completed" | "established_user" | "long_term_user";
  scale: { min: number; max: number; lowLabel: string; highLabel: string };
  items: readonly SurveyItem[];
  /** Days before the same person may be asked again. Infinity: once, ever. */
  cooldownDays: number;
  /** Share of eligible people who are asked (a stable hash of survey and person, so the same people every time). */
  sampleRate: number;
}

export const SURVEYS: Record<SurveyId, SurveyDefinition> = {
  // Single Ease Question: how hard was the task you just did.
  seq: {
    id: "seq",
    title: "One quick question about setup",
    trigger: "onboarding_completed",
    scale: { min: 1, max: 7, lowLabel: "Very difficult", highLabel: "Very easy" },
    items: [
      { id: "setup_ease", text: "Overall, how easy or difficult was it to set up your account?" },
    ],
    cooldownDays: Infinity,
    sampleRate: 1,
  },
  // UMUX-Lite: two items, perceived usefulness and ease of use.
  umux_lite: {
    id: "umux_lite",
    title: "Two quick questions",
    trigger: "established_user",
    scale: { min: 1, max: 7, lowLabel: "Strongly disagree", highLabel: "Strongly agree" },
    items: [
      { id: "capabilities", text: "Ripplewise's capabilities meet my requirements." },
      { id: "ease_of_use", text: "Ripplewise is easy to use." },
    ],
    cooldownDays: 60,
    sampleRate: 0.5,
  },
  // Net Promoter Score.
  nps: {
    id: "nps",
    title: "One last question",
    trigger: "long_term_user",
    scale: { min: 0, max: 10, lowLabel: "Not at all likely", highLabel: "Extremely likely" },
    items: [
      {
        id: "recommend",
        text: "How likely are you to recommend Ripplewise to a friend or colleague?",
      },
    ],
    cooldownDays: 90,
    sampleRate: 0.5,
  },
};

/** The order they are considered in; the first one that is eligible is shown. */
export const SURVEY_ORDER: readonly SurveyId[] = ["seq", "umux_lite", "nps"];

/** At most one survey per person in this many hours, whatever they answered. */
export const ANY_SURVEY_GAP_HOURS = 24;
