# Ripplewise: briefing for a research assistant, and a plan for quantitative UX research

Written 2026-10-13 for handing to another assistant in research mode. It is self-contained: it says who the person is, what
exists, what does not, and what to research. Where it cites a file, the path is relative to the repository
(`arthurliberato/social_listening`, working branch `claude/keen-keller-fxvnc0`).

## 0. What to do with this document

**The person's goal.** They are building a portfolio project to apply for jobs, and they have discovered they are
**most interested in quantitative UX research (quant UXR)**. They want to start analysing this week. They need:

1. The most useful quant UXR methods, benchmarks and instruments for a product like this one, with sources.
2. A **detailed plan of what is still left to set up** so the project can support quant UXR analysis (instrumentation,
   simulated data, experiments, tooling, analyses, packaging), in priority order, with effort estimates.
3. Honest advice on how to present synthetic data credibly to hiring managers.

**Please return:** (a) answers to the research questions in section 9, each with sources and a confidence note; (b) a
critique of the plan in section 7 (what is missing, over-scoped, or in the wrong order); (c) a recommended reading list;
(d) templates or checklists where they exist (analysis plan, survey items, experiment design, power calculations).

**Important framing.** Everything here is **synthetic by design**: the product, its data and its "users" are fictitious
and generated. The honest claim is "methods validated against known ground truth", not "findings about real users".

## 1. The person and constraints

- Working alone, with an AI assistant doing most of the building. Uses Windows (PowerShell) on a personal computer.
- **Timeline:** wants to start analysing this week; to apply to jobs with this project "at its forefront".
- **Accounts and tools:** Google Cloud (free trial, about 100 GB BigQuery), Vercel and Neon (free plan, 1 GB database),
  GitHub. A Claude API key exists for the agent runs (about a cent per agent run on the cheapest model).
- Prefers plain-language explanations and step-by-step instructions; does not want secrets pasted into chat.

## 2. The project in one page

**Ripplewise** is a fictitious B2B social listening SaaS with a second product, Influencers (creator discovery,
outreach, campaigns). It is built as a production-quality web app, used by **autonomous browser agents emulating real
users**: real onboarding, plan limits, paywalls, billing (test mode), cancellation, emails.

- **Stack:** Next.js 15 (App Router, TypeScript), PostgreSQL 16 with Drizzle, pg-boss for background jobs, Auth.js,
  Tailwind with shadcn, ECharts. Analytics: events go to RudderStack, which delivers to BigQuery; a Postgres mirror
  (`analytics_events`) keeps every event too.
- **Products and plans:** five tiers (Trial, Starter $79, Growth $249, Agency $599, Enterprise quoted). Limits on active
  queries, mentions per month, seats, history window, alerts, AI questions, and (Influencers) creator profiles,
  campaigns, invitations. One account covers both products; there is **no per-product billing** (a gap the simulation plan
  flags). Details: `docs/user-types-and-plans.md`.
- **The synthetic world:** `datagen/` generates the corpus of public "mentions" (posts, comments, reviews, news) for 40
  fictitious brands, with launches, news and crisis stories, cascades, spam and noise, and ground-truth labels. Nothing is
  scraped. Sizes: about 392k mentions (small), 958k (medium), several million (full).
- **The agents** (`agents/`): profile sampling (traits, competencies, awareness, state), a scripted brain and a Claude
  brain, an action layer that drives the real UI with Playwright, an analyst policy for a case ("CS-001": set up a
  search for a coffee brand, read and label mentions, make categories, write a report), a ledger of every step, an
  evaluator that scores against hidden truth, and a **batch runner** (`npm run agents:batch`).

## 3. Current state

| Area | Status |
|---|---|
| App code | Built and tested: 522 unit tests, a large browser (Playwright) suite, axe accessibility checks, CI. `main` contains everything up to PR #16 (merged 2026-10-11). About 18 newer commits are only on `claude/keen-keller-fxvnc0`: query repair for agents, tier seeding (`--mix`, `--team-size`), a data-coverage note and Help topic, a pure-Node data loader (works on Windows), the batch runner, VM setup scripts, research and planning docs |
| Public demo | Vercel production (from `main`) plus a Neon database loaded with the small corpus and **90 accounts / 198 users** in three tiers (about 455 MB of 1 GB). The person can log in. Not yet running the newest branch code |
| Simulation lab | **VM setup written, not yet created.** Plan: a Google Cloud VM (Ubuntu 24.04) runs the app, a local Postgres (no 1 GB cap), the job worker and the agents. Scripts in `ops/vm/` (`seed.sh` tested; `bootstrap.sh` syntax-checked only) |
| Agents | One task per run works (scripted and Claude brains; Claude run measured at about 3,066 input and 1,473 output tokens, about one cent on the cheapest model). Batch runner tested locally (3 agents, concurrency 2, retry, resume, CSV). **Not built:** the orchestrator (agents living on the site over simulated days, with tier-specific behavior) |
| Event pipeline | App sends events server-side to RudderStack. **Nothing has been sent to a real RudderStack or BigQuery yet**; steps in `docs/rudderstack-bigquery.md`. Events are always stored in Postgres |
| Experiments | Framework exists (deterministic flag assignment, an `Experiment Exposed` event) with **one flag** (`sales_cta_copy`) |
| Surveys / attitudinal data | **None.** No satisfaction, NPS, SUS or task-rating instruments exist in the product |
| Ground truth for analysis | Corpus has labels (true sentiment, spam, topics). Agent profiles hold latent traits. A separate sealed "truth" schema for behavior and experiments is **designed, not built** |

## 4. The three account tiers (the behavioral contrast)

Seeded with `--mix starter-limit:50,growth:25,agency-low:15` through the product's own sign-up, subscription and backfill
code. Measured on the small corpus:

| Profile | Accounts | Users each | Queries | Measured state |
|---|---|---|---|---|
| `starter-limit` | 50 | 1 | 3 of 3 (two deliberately broad) | **All at the 10,000-mention monthly cap** |
| `growth` | 25 | 3 to 5 | 4 to 8 | About a third of the 50,000 allowance |
| `agency-low` | 15 | 2 to 4 | 1 to 2 | About 4% of the 200,000 allowance |

**An intentional dead end:** `starter-limit` owners start at the first-run wizard, whose step 4 tries to create a
fourth query and is blocked by the plan ("Your Starter plan includes 3 active queries") with no skip. They cannot reach the
app. This was **left on purpose** as behavior to analyse (a funnel drop for accounts at their limit) and it raises a
product question: should the wizard offer a way out? See `docs/account-tiers-and-demo-population.md`.

## 5. What data exists for UX analysis

**145 tracked events** (87 from the browser, 58 from the server), with a typed schema in `docs/tracking-plan.json`. By area:

| Area | Events (examples) |
|---|---|
| Acquisition and auth (9) | Marketing Page Viewed, Pricing Page Viewed, Sign Up Started/Completed, Login Completed/Failed (with `error_type`) |
| Onboarding (5) | Onboarding Step Viewed/Completed/Skipped/Completed, Checklist Item Completed |
| Query building (11) | Query Builder Opened, Query Previewed, **Query Validation Failed**, Query Saved/Edited/Deleted, AI Query Generated |
| Mentions, insight, dashboards, alerts, crisis, reports (44) | Mention Filter Applied, Mention Opened/Tagged/Sentiment Overridden, Ask AI, Dashboard/Widget events, Alert events, Report events |
| Plan and churn (17) | Paywall Viewed/Dismissed, Upgrade Started, Quota Threshold Reached, Plan Upgraded/Downgraded, Payment Failed, Cancellation Started, Save Offer Viewed/Accepted |
| Friction and help | **Error Displayed**, **Empty State CTA Clicked**, Help Opened, Support Contacted, Command Palette Opened, Keyboard Shortcut Used |
| Collaboration, workspaces, sales (13) | Teammate Invited, Workspace Switched, Client Viewer Added, Sales Contact Requested, Demo Booked, Quote events |
| Influencers and creator portal (33), hub (2) | Creator search and lists, campaigns, outreach, content, tracking, contracts, payouts; Product Hub Viewed, Product Opened |
| Experiments (1) | Experiment Exposed |

**Global properties on every event:** `account_id`, `workspace_id`, `plan_tier`, `trial_day`, `user_role`,
`persona_archetype`, `is_synthetic`, `agent_run_id`, `app_version`, `route`, `ui_theme`, plus `product` and `actor_type`.
Event time is the agent's simulated clock when one is set (`timestamp`), separate from when RudderStack received it.
Each browser also has a device id. There is **no session id** (sessions would be derived from gaps).

**Agent-side signals that act like attitudinal proxies** (stored in every ledger line, not in the product events): traits
(digital fluency, learning rate, sampling depth, refinement diligence, data judgment, quality standard), competencies
(spreadsheet fluency, query-syntax skill, intent clarity), awareness of each product capability (unknown, aware, tried,
fluent) and a changing **state** (fatigue, workload, deadline pressure, frustration, trust in data). There is also a
**vision mode** where the agent looks at screenshots and reports what looks visually wrong (`visual-issues.json`), a bridge
between qualitative review and quantitative counts.

## 6. Quant UXR methods and how they map to this project

| Method | What the project supports now | What is missing |
|---|---|---|
| **HEART** (happiness, engagement, adoption, retention, task success) | Engagement, adoption, retention and task success can be derived from events | **Happiness** needs survey data. No metric definitions or goals-signals-metrics table yet |
| **Funnel and drop-off analysis** | Strong: onboarding steps, query creation, upgrade and cancellation flows, plus the Starter dead end | Step timing is derivable but no explicit task start/end events |
| **Task success and time on task** | Agents record per-step ledgers with outcomes | A defined task catalogue (task, success criterion, event pairs), session ids |
| **Error and friction metrics** | Error Displayed, Query Validation Failed, Login Failed, Empty State CTA, Help Opened, Support Contacted | An error taxonomy, rage/dead-click signals, help-search terms |
| **Usability and attitudinal scales** (SUS, UMUX-Lite, SEQ, CSAT, NPS) | None | Instruments in the product, a latent-satisfaction model that generates responses with realistic error and non-response |
| **A/B testing and experimentation** | Deterministic assignment, exposure event, one flag | More flags, planted true effects, an analysis pipeline (power, CUPED, sequential or fixed-horizon tests) |
| **Causal inference without experiments** (difference-in-differences, instrumental variables, regression discontinuity) | Designed in `docs/simulation-plan.md` (staggered rollout, randomised nudge, score threshold) | Not built; needs ground-truth schema and planted effects |
| **Retention, cohorts, survival** | Possible once the orchestrator runs across simulated months | The orchestrator and enough accounts and time |
| **Behavioral segmentation** | Tier profile and persona archetype exist | Compare behavior-derived clusters with the known labels (a clean validation) |
| **Pricing and packaging research** (Van Westendorp, Gabor-Granger, conjoint, MaxDiff) | Real billing events and paywall exposure | A simulated survey layer; per-product billing is not set |
| **Feature adoption and Kano-style analysis** | Awareness states and feature events | A feature catalogue and an adoption model |
| **Measurement validity** (reliability, factor analysis) | None | Multi-item simulated scales to analyse |
| **Mixed methods** | Agent rationales and vision-mode findings (LLM-generated, not human) | A written protocol for treating LLM output as qualitative data, with limits stated |
| **Instrumentation audit** | An audit script (`npm run audit:warehouse`) and naming rules | Coverage review against the HEART table |

## 7. What is left to set up (prioritised plan)

Effort is the assistant's estimate of building time, not the person's reading or analysis time.

### P0: get data flowing (this week)

1. **Create the Google Cloud VM and run the scripts** (`ops/vm/README.md`). Person: about 1 hour. Result: app plus
   database plus agents on one machine, no size cap.
2. **Connect RudderStack to BigQuery for real** (`docs/rudderstack-bigquery.md`): a server source, a BigQuery destination,
   a service account, then verify rows and an empty discards table. Person: about 1 to 2 hours, plus waiting for the sync.
   Check RudderStack's free event allowance first.
3. **Build the orchestrator v1** (about 2 to 3 days of build): each simulated day, each account decides whether to log in
   and what to do, with behavior by tier (browse, create queries, hit limits and paywalls, upgrade, downgrade or cancel);
   events dated by the simulated day; several agents at once; resumable. Starter owners should attempt the wizard and
   stall (the intentional dead end).
4. **First overnight run:** about 90 accounts over about 3 simulated months; confirm events arrive in BigQuery.

### P1: instrumentation for quant UXR (about 1 to 2 days)

5. **Session id and task events:** explicit start, success, failure and abandon events for a defined task catalogue
   (for example: create a query, build a dashboard, schedule a report, upgrade, cancel).
6. **In-product micro-surveys** as new tracked events, shown after tasks and at milestones: a single ease question
   (SEQ) after key tasks, CSAT after exports and reports, a short usability scale (SUS or UMUX-Lite) around day 14, NPS around
   day 30. Needs UI and tracking-plan entries (the repo's rule is typed events; unknown events fail the build).
7. **Friction signals:** an error taxonomy, rage-click and dead-click detection, help-search terms and null results.
8. **Extend global properties** with `session_id`, `days_since_signup`, `workspace_role`, `billing_interval`, as the plan lists.

### P2: a simulated attitudinal layer (about 2 days)

9. **Ground-truth (sealed) schema** (`sim_truth`): per-account and per-user latent variables (need intensity, query-writing
   skill, trust in the data, engagement propensity, budget slack, champion strength), shocks, assignments and planted effects.
10. **Survey response model:** satisfaction as a latent function of experienced friction, task success and value, with
    measurement error, scale acquiescence, and non-response that depends on engagement (so naive averages are biased).
    This is what lets SUS, NPS and CSAT analyses be validated.

### P3: planted experiments and causal designs (about 2 to 3 days)

11. **Two or three UX experiments** with logged assignment and known, heterogeneous true effects (for example: an onboarding
    checklist nudge, paywall copy, a wizard escape hatch for accounts at their plan limit). Pre-register each in a short analysis plan.
12. **At least one observational design** (staggered rollout, difference-in-differences) beside a randomised one, so methods
    can be graded against the planted truth.

### P4: analysis environment (about 1 to 2 days)

13. **BigQuery modelling:** dataset layout (raw events, cleaned events, sessions, tasks, funnels, cohorts, truth sealed in a
    separate dataset), documented views.
14. **Notebooks** (Python and/or R) in a reproducible repository folder, a dashboard (Looker Studio or similar), and a
    metrics dictionary (HEART goals, signals, metrics).

### P5: portfolio packaging (about 2 to 3 days, ongoing)

15. **Three case studies** (for example: onboarding friction for accounts at their limit; paywall and upgrade behavior by
    tier; a usability benchmark with a validated survey scale), each with question, method, result, validation against
    truth and limitations.
16. **A methods appendix** (sampling, power, bias, how the synthetic data was generated) and a one-page project README with the
    live demo link.

### Suggested order

Week 1: P0, then P1 items 5 and 6. Weeks 2 to 3: P2, P3, and the first two analyses. Week 4: P4 polish and P5. The analysis can
start on P0 data alone (funnels, quota pressure, tier contrast) while later pieces are built.

## 8. Risks and caveats

- **Synthetic data limits what can be claimed.** Findings describe the simulator, so the strength is rigorous method plus
  validation against known truth. If outcomes are scripted by archetype instead of generated from latents and shocks,
  analyses only rediscover the configuration.
- **Agent behavior is not human behavior.** The Claude brain and the scripted brain are policies; vision-mode and
  rationale text are LLM output, not participant data.
- **The first dataset will be small and partly artificial:** 90 accounts, a few simulated months, a single analyst case.
  Larger scale and richer behavior come later.
- **Several benchmark numbers are secondary or vendor-sourced.** See `docs/research-users-platforms-usage.md` for sources
  and confidence tags (for example, trial-to-paid conversion: median 8%; opt-in trials about 6 to 9%).
- **Unbuilt or untested pieces:** the orchestrator; the VM bootstrap on a real machine; RudderStack and BigQuery live;
  per-product billing; the `large` corpus; the batch runner at high concurrency.
- **Known product dead end** (Starter owners at the wizard) is deliberate; do not "fix" it without asking.
- **Platform realism:** the corpus is Instagram and TikTok heavy (about 31%) compared with real listening tools; a coverage
  note in the product says counts cover "the public posts we can collect". Rebalancing the mix needs a cascade rework.

## 9. Research questions for the assistant

1. **Which quant UXR methods do hiring managers expect in a portfolio** (for tech, SaaS and B2B roles), and which of the
   methods in section 6 are most valued? Which are overkill for a solo synthetic project?
2. **Standard instruments and norms:** SUS, UMUX-Lite, SEQ, CSAT, NPS, UEQ-S. Current benchmarks and score interpretation,
   item wording, when each is appropriate, how many responses are needed, and how to simulate realistic responses.
3. **HEART framework in practice:** examples of goals, signals and metrics for a B2B analytics product, and common mistakes.
4. **Experimentation for UX:** sample size and power for typical effect sizes on conversion and task success, variance
   reduction (CUPED), sequential testing, guardrail metrics, and how to run these at small scale.
5. **Causal inference for product teams:** when difference-in-differences, instrumental variables and regression
   discontinuity are credible, with worked examples and recommended libraries in Python and R.
6. **Survey design and bias:** non-response, acquiescence, order effects, and how to model them in simulated data so analyses
   can be validated.
7. **Behavioral measures of usability:** task success, time on task, error rate and abandonment: recommended definitions
   and how to derive them from event logs, plus session-reconstruction heuristics.
8. **Pricing and packaging research methods** (Van Westendorp, Gabor-Granger, conjoint, MaxDiff): when to use which, and
   whether a simulated version is meaningful.
9. **Synthetic data in portfolios:** how to present it credibly, what reviewers dislike, and examples of strong simulated
   case studies. Ethical and honesty considerations.
10. **Tooling:** best practice for a small BigQuery analysis setup (dataset layout, dbt or plain views, notebooks, dashboards)
    and for pre-registering analyses.
11. **Typical quant UXR interview tasks** (case questions, take-homes) so the project's analyses can mirror them.
12. **Critique the plan in section 7:** what is missing, mis-ordered or too large for a week-by-week schedule.

## 10. Reference: where things are

| Topic | Where |
|---|---|
| Original simulation plan, with research-driven revisions | `docs/simulation-plan.md` |
| Research on users, platforms, usage (sources, confidence) | `docs/research-users-platforms-usage.md` |
| User types, influencer product, plans | `docs/user-types-and-plans.md` |
| Tiers and the demo population (measured) | `docs/account-tiers-and-demo-population.md` |
| Deployment on Vercel and Neon | `docs/demo-deployment.md` |
| VM lab setup | `ops/vm/README.md` |
| Event schema | `docs/tracking-plan.json`, `docs/analytics.md` |
| RudderStack and BigQuery | `docs/rudderstack-bigquery.md` |
| Agents, batch runner, vision mode | `docs/agents.md`, `agents/` |
| Plan limits (single source of truth) | `lib/entitlements/plans.ts` |
| Experiments and flags | `lib/flags/index.ts` |
| Corpus generator | `datagen/`, `docs/datagen.md` |

**Honesty notes for whoever reads this:** the scores and measurements quoted here come from local and sandbox
runs of the build, not from production traffic. Nothing here describes real customers.
