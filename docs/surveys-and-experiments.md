# Surveys, experiments and the hidden truth (current state)

All of this is synthetic and in test mode. The wording, scales and rules below are the **proposed starting point**:
they are the owner's to confirm or change (see `docs/analytics-owner-guide.md`).

## In-product surveys

A short card appears bottom-right inside a workspace. It never takes focus, can always be closed with "Not now", and is
not shown to client viewers.

| Survey | Question | Scale | Asked when | Again after | Share asked |
|---|---|---|---|---|---|
| SEQ | "Overall, how easy or difficult was it to set up your account?" | 1 to 7, very difficult to very easy | Within 24 hours of finishing setup | never | everyone |
| UMUX-Lite | "Ripplewise's capabilities meet my requirements." and "Ripplewise is easy to use." | 1 to 7, strongly disagree to strongly agree | 7 or more days after sign-up and 3 or more visits | 60 days | half (stable per person) |
| NPS | "How likely are you to recommend Ripplewise to a friend or colleague?" | 0 to 10 | 14 or more days after sign-up | 90 days | half (stable per person) |

CSAT and SUS are not built yet: each needs a moment to attach to (CSAT after an Ask AI answer, SUS as a longer
invitation) and that is a decision for the owner.

Rules: at most one survey per person per 24 hours; once shown, a survey stays until answered or dismissed for the rest of
the visit. Ages are measured on the simulated clock.

**Events** (all in `docs/tracking-plan.json`, area Surveys): `Survey Eligibility Evaluated` (once per visit and survey,
with a reason: eligible, already_asked, cooldown, another_survey_recent, sampled_out), `Survey Shown`,
`Survey Item Answered` (one event per question, so one warehouse row per answer) and `Survey Dismissed`. The eligibility
event is what lets analysis separate "never asked" from "asked and did not answer".

Code: `lib/surveys/` (definitions, eligibility rules, service), `components/surveys/SurveyPrompt.tsx`, table `survey_state`.

## Experiment flags

Assignment is a stable hash of the flag and the unit, with weights in `lib/flags/index.ts`. Weights can be changed
without a code change through the `FLAG_WEIGHTS` setting, e.g.
`FLAG_WEIGHTS={"wizard_escape_hatch":{"control":50,"escape":50}}`.

| Flag | What it changes | Unit | Status |
|---|---|---|---|
| `sales_cta_copy` | Wording of the talk-to-sales button | person | running 50/50 |
| `wizard_escape_hatch` | Whether the first-run wizard offers "Continue without a new query" when the plan's query limit is already reached | account | **off** (escape weight 0), so the Starter dead end stays as behavior to analyse |

Exposure is logged as `Experiment Exposed` when the variant is on screen; for the wizard it is logged for both arms at the
moment the limit is hit.

## The hidden truth (`sim_truth`)

A separate database schema (`db/sim-truth-schema.ts`) holding each synthetic user's latent traits (perceived usefulness,
perceived ease of use, trust, satisfaction, patience, rating-scale style), how they change over simulated days, and the
effects planted in experiments. It is empty until the orchestrator writes it. A test
(`lib/sim/sim-truth.guard.test.ts`) fails if the product, the analytics code or the warehouse export ever mentions it.
The list of constructs is a draft for the owner to confirm.
