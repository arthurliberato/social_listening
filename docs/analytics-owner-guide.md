# Analytics owner's guide: what you decide, what I build

This is for the person who owns the analysis (you), not the person who writes the code (me). It covers four things:
what the roles are, how a tracking plan gets made, what goes in one, and what you can analyse at each step of the
build. All the data is synthetic, so this shows how you work, not findings about real customers. Say that
plainly in your portfolio.

## 1. The split of work

| You decide | I build |
|---|---|
| The questions the data must answer | The events, properties and tables |
| What counts as success (the metrics) | The agents that produce behavior |
| What each event means, in plain words | The pipeline into BigQuery |
| Which analyses to run and how to report them | Nothing is added to the product's tracking until you have signed it off |

The rule going forward: **no new event gets built until it is a row in your tracking plan with a question attached.**

## 2. The three roles you are applying to

**Product analyst.** Answers "what is happening and why" from behavior data. Owns the tracking plan with the PM,
the metric definitions and the dashboards. Typical questions: Where do new accounts drop out of onboarding? Which plan
hits its limits first? Does feature X lift retention? Typical outputs: funnels, retention curves, segment
comparisons, experiment readouts, a metric dictionary.

**Product manager.** Decides what to build and why. Brings the business question and the decision that hangs on it
("should the wizard let Starter accounts skip step 4?"). Judges the analysis on whether it changes the decision.
Typical outputs: priorities, a hypothesis, a success metric, a go or no-go.

**Quant UX researcher (your target).** Combines behavior data with attitudes: surveys and rating scales
(SEQ, UMUX-Lite, NPS, CSAT, SUS), measurement quality (are the scales reliable and valid), experiments, and careful
causal reasoning. Where the analyst says "50 % drop at step 4", the quant UXR adds "and they rated that step 2 out of 7,
and the survey cannot be trusted for people who never reached it". Typical outputs: a survey design, a
measurement model, an A/B test plan with power, a causal estimate, a report written for a PM.

Overlap: all three read the same funnel. The difference is the question they ask of it.

## 3. How a tracking plan is made

Work backwards. Do not start from "what can we log".

1. **Decision.** What will someone decide with this? (Example: whether to give Starter accounts a way out of the wizard.)
2. **Question.** What must be true or false to decide? (Do Starter owners who hit the limit ever come back?)
3. **Metric.** The number that answers it, defined exactly. (Share of Starter owners who reach Home within 7 days.)
4. **Events.** The smallest set of user actions needed to compute the metric.
5. **Properties.** What you need to split each event by (plan, role, step).
6. **Check.** How you will know the event fires correctly (a test, and a count that makes sense).

An event that has no question attached is clutter. A question with no event is a gap.

### What goes in the plan (one row per event)

| Column | Meaning | Example |
|---|---|---|
| Event name | Object + past-tense action, Title Case | `Onboarding Step Blocked` |
| Trigger | The exact moment it fires, in plain words | "The person pressed Next and the step refused to continue" |
| Does not fire when | The edge cases that people forget | "A typo in a field does not count as blocked" (decide!) |
| Properties | Name, type, allowed values, required or not | `block_reason`: validation, plan_limit, seat_limit |
| Who or what | Member, system, creator | member |
| Question it serves | Which of your questions needs it | "Do Starter owners get stuck at step 4?" |
| Metric it feeds | The metric definition | Funnel step conversion |
| Owner | You | |
| Status | Proposed, built, verified, retired | |

Also keep a **metric dictionary**: for every metric, its formula, the denominator (who is counted), the time window,
and what is excluded. Most analysis arguments are really arguments about the denominator.

Every event already carries these global properties, so you never have to ask for them per event: account, workspace,
plan tier, trial day, user role, persona, is-synthetic, agent run, app version, route, theme, product, actor type and
session id.

## 4. A worked example, from data we already have

**Decision:** should the first-run wizard offer a way out when a plan limit is already reached?

**Question:** what share of Starter owners cannot finish onboarding, and what do they do next?

**Metric:** onboarding completion within 7 days, by plan tier. Denominator: owners who viewed step 1.

**Events needed:**
- `Onboarding Step Viewed` and `Onboarding Step Completed` (exist): the funnel.
- `Onboarding Step Blocked` (I proposed it, not yet yours): says *why* someone did not pass a step. Without it
  you only see the drop, not the cause.
- `Onboarding Exited` (I proposed it, not yet yours): separates "left" from "still there". Weak on its own, since closing
  a tab does not always fire it. Decide whether it is worth keeping.

**What you would then be able to say:** "All 50 Starter accounts stall at step 4 with a plan-limit block, 0 % finish.
Growth and Agency finish at X %." That is a finding, a segment and a recommendation in one line.

## 5. What you can analyse, step by step

The honest timeline. "Analyses unlocked" are things you can do with the data that exists after that step.

| Step | What it adds | Analyses unlocked | Data caveat |
|---|---|---|---|
| **Done now** | 90 seeded accounts, 3 tiers, events flowing to RudderStack, `session_id` | Account segmentation (plan mix, quota use, at-limit vs low-use). Setting up BigQuery tables and views. Writing your metric dictionary. | Almost no behavior yet: only seeded state and a few test events. |
| **1. Onboarding agent runs** (Starter stalls, Growth and Agency finish) | Real funnel events for 90 owners | Funnel and drop-off by tier. Time per step. Block reasons. **Case study 1: the wizard dead end.** | One-time event; no time dimension yet. |
| **2. Flow events plus surveys** | Task-level ratings and who was invited to answer | Task success and ease (SEQ), UMUX-Lite, NPS, CSAT. Behavior against attitude. Non-response bias, since the plan logs who was eligible. | Scores come from the agent's rating model, so reliability is something you test, not assume. |
| **3. Orchestrator over simulated weeks** | Daily activity for every account over a simulated period | Retention and cohort curves. Activation definition and time to activate. Feature adoption. Upgrade, downgrade and churn, so **survival analysis**. HEART metrics (happiness, engagement, adoption, retention, task success). | Time is simulated; say how the clock works in any write-up. |
| **4. Experiments (flags)** | Variants assigned per account | A/B tests with account-level randomisation, power calculation, CUPED variance reduction, guardrail metrics. | Few accounts (90), so power is limited; that is itself something to discuss. |
| **5. Hidden ground truth (`sim_truth`)** | A sealed table of what the agents "really" felt and intended | Validate your methods: did the survey recover the true satisfaction, did the experiment estimate match the planted effect, does a staggered difference-in-differences pick up a known change. | Only possible because the data is synthetic; this is the portfolio's strongest differentiator. |

## 6. What I need from you next

Pick one thing, and we do only that:

- **Option A (recommended):** write case study 1 as a one-page brief: decision, question, metric, the events you would
  want. I show you the funnel on the 50 Starter accounts we already seeded, so you see the real shape of the data
  before deciding anything more.
- **Option B:** go through the existing 147 events together, in groups of ten, and you mark each one keep, rename or
  drop against a question. Slow, but you own the whole plan afterwards.
- **Option C:** start with the metric dictionary (ten metrics, formulas and denominators) before touching events.

Nothing gets built until you choose.
