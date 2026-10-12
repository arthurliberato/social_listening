# Ripplewise Simulation Plan: Market-Grounded Agent Behavior, Packaging and Data Design for a Product-Analyst Portfolio

> **Revision notes (2026-10-12).** This is a copy of the original plan with five changes from
> `docs/research-users-platforms-usage.md`; the original is unchanged. Everything else is as written.
>
> | Where | Change | Why |
> |---|---|---|
> | §4.3 Trial → convert | 15–20% overall → **6–10%**; activated ~30% vs ~2% not (was ~45% vs ~4%) | The 2026 median for free-to-paid is 8%; no-card trials run about 6–9%. Ripplewise's trial needs no card. The activated and non-activated rates are rescaled so they add up to the new overall rate |
> | §4.3 Trial → abandon, late convert | ~90% end without paying; the grace-window conversions are part of the overall rate | Keeps the three trial rows consistent |
> | §1.3 Outreach benchmarks | Reply rate depends on creator tier and message quality | Micro 15–25%, macro 5–10%, mega 2–5% (one secondary source) |
> | §1.3 Influencer budgets | Budget trend becomes a per-account trait | The 2026 benchmark reverses the 2025 figures the plan cited |
> | §3.1 L1 and new §1.5 | Monthly reporting cadence noted; platform coverage added | Monthly is the dominant agency cadence; real tools cannot reach every platform |

The single most important change is this: split billing into per-product subscriptions (Listening plan + Creators plan, with a suite discount), and drive every agent with stored hidden variables that cause its outcomes. Do that, and upgrade roadblocks, shelfware, cross-sell, "bought both, kept one" and a testable feature-causes-retention question will all show up in the event data. Without it, cross-sell and product abandonment cannot appear in billing at all, and every "insight" will be either impossible to find or trivially obvious.

## TL;DR

- **Packaging is the blocker.** With one plan covering both products, cross-sell and "bought both, kept one" are invisible. Move to per-product subscription items with a bundle discount, modelled on how Sprout Social sells Influencer Marketing (ex-Tagger) and Meltwater sells Klear as separate modules. Also add a self-serve extra-seat add-on. Set `account_type` and `company_size_band` at signup.
- **Simulate about 360 accounts over 18 months.** Use ten weighted archetypes, with signups spread across the whole period. Each account gets hidden drivers stored in a separate ground-truth schema: need intensity, Boolean skill, champion strength, client portfolio, product affinity, budget slack, payment reliability, organisational inertia and engagement propensity. Outcomes must come from these drivers, not from scripted labels.
- **Build in the conditions for causal inference, and plant a known effect.** Engaged accounts should self-select into a feature such as scheduled reports. Add a staggered rollout, a randomised onboarding nudge, a score-threshold CSM call and a randomised retention-offer holdout. Then you can show that a naive comparison overstates the effect while difference-in-differences, instrumental variables and regression discontinuity recover the true value you planted. That is the headline portfolio piece.

---

## 1. Market grounding

### 1.1 How listening platforms package, price and gate

| Vendor | Model | What gates upgrades | Seats | Notes for Ripplewise |
|---|---|---|---|---|
| Brand24 | Public self-serve tiers: Individual $199/mo annual (3 keywords, 2,000 mentions, 1 user, 12-hour updates); Team $299 (7 keywords, 10,000 mentions); Pro $399 (12 keywords, 40,000); Business $599 (25 keywords, 100,000); Enterprise from $1,499 | Keywords and mentions | Unlimited from Team up | Closest analogue to Ripplewise Starter→Growth. Seats are not the upgrade lever. |
| YouScan | Starter-3 $499/mo annual: 3 topics, 15,000 monthly mentions, unlimited users, 10 AI Copilot questions/mo. "Unlimited" plans are custom, with add-ons (Visual Insights, Audience Insights, API) | Topics, mentions, AI questions, add-on modules | Unlimited | A Capterra reviewer complained that the starter mention allowance was cut ("It used to have 10.000 and suddenly they changed it to 5.000"). Allowance changes are a real churn trigger. |
| Brandwatch | Sales-led, annual contracts. Vendr data: $50,000 average ACV across 40 purchases, range $19,542–$81,200. UK G-Cloud price list offers a queries model (5 queries £2,880 up to 40 queries £10,650/yr add-on pricing) or a monthly-mentions model; historical access on mention plans = 24× the live monthly limit per month | Queries or mention volume; history; API | Negotiated | Validates both "query count" and "mention volume" as value metrics, and history as a separately priced resource (like your $49 history pack). |
| Sprout Social | Per seat ($199 Standard, $399 Advanced per seat/month); Listening is an add-on from Standard up; spike alerts sit in Advanced. A November 2025 UK G-Cloud filing reportedly lists Listening at $3,000/mo (reported second-hand by a competitor blog) | Seats, tier features, paid modules | Per seat | The archetypal "platform + modules" seller. |
| Hootsuite / Talkwalker | Hootsuite bought Talkwalker in April 2024. "Listening Basics" is on all plans; full Talkwalker-powered listening is enterprise-tier | Tier | Per seat | A free "lite" listening layer feeding a premium upgrade: a pattern worth copying for cross-product teasers. |
| Meltwater | Annual-only, quote-based, modular. Third-party estimates put a social listening add-on at $10k–$30k/yr and the Klear influencer module at $10k–$25k/yr. Vendr notes buyers who bundle modules up front get better pricing | Modules | Negotiated | Vendr: "Influencer marketing is less commonly purchased than media monitoring or social listening." Listening/monitoring usually lands first. |

**What this means for Ripplewise.** Your ladder ($79 / $249 / $599 / quoted Enterprise) sits plausibly between Brand24/YouScan (self-serve, with mention and topic caps) and Brandwatch/Meltwater (sales-led, $20k–$80k ACV). The way real vendors gate (query count, mention volume, history depth, refresh speed, alerts, AI questions, premium modules) matches yours, so quota pressure and feature-gate collisions are realistic upgrade triggers. Where you differ from the market: vendors that sell both products charge for them separately, while you bundle both into one plan.

### 1.2 How influencer platforms package and price

- **Modash** (closest self-serve analogue to your Influencers product): Essentials $299/mo monthly or $2,388/yr, with 2 seats, 300 profile analyses, 150 email unlocks and 100 tracked creators. Performance is $599/mo, with 5 seats, 800 profiles, 400 email unlocks, 250 tracked creators, plus payments and affiliates. The trial is capped at 20 profile views, 6 email unlocks and 10 tracked creators. **Searching is unlimited; opening a full profile consumes quota**, and limits reset monthly with no rollover. This mirrors your "new creator profiles/mo" limit exactly.
- **Enterprise influencer suites** are annual and sales-led. Vendr-derived figures: CreatorIQ median ~$39,250/yr; Aspire median ~$15,588/yr; Traackr ~$25k–$55k/yr. GRIN's own Business Wire release (January 27, 2026) confirms a move to "instant, self-serve access… flexible, month-to-month pricing"; third-party dollar figures for the new tiers conflict (Storika lists $0–$1,500/mo, archive.com $399–$1,799/mo), so treat the amounts as unverified.
- **Listening + influencer suites:** Sprout bought Tagger for $140M in August 2023 and rebranded it Sprout Social Influencer Marketing in February 2025. At the acquisition, Sprout's CFO said the company saw "a strong opportunity to… drive high adoption of influencer marketing software in our customer base." That is an explicit cross-sell into an existing listening/social base. Meltwater bought Klear in 2021 and sells it as a module. Brandwatch sells Influence alongside Consumer Intelligence as separate suites.

**Attach rates and which product lands first.** No vendor publishes the share of listening customers who also buy influencer software. The closest proxy is Sprout's "premium product attach rate," which, per Sprout's 2023 Investor Day 8-K, covers "social listening, premium analytics and social advocacy" — influencer was not part of the definition. CEO Justyn Howard said on the Q4 2023 call (February 20, 2024) that "our premium product attach rate is now 30%," adding that "about 30% of our customers have attached one of the modules and about 7% have two products," up from "more than 27%" on the Q3 2023 call. On the Q4 2025 call, Ryan Barretto said the multi-product attach rate for $30K+ customers was "well over 70%," with that group making up 59% of subscription revenue, and Sprout's CEO said on the Q2 2026 call that the $30K+ customer group has "higher attach rates of products like influencer marketing." The combined evidence points one way: **listening/monitoring lands first, and influencer is the expansion module, concentrated in larger accounts.** For the simulation, make Listening-first the dominant land path (about 70% of accounts that ever use both) and Influencers-first the minority (about 30%, concentrated in DTC and influencer-agency archetypes).

### 1.3 Churn, seasonality and retention dynamics

- **Expansion is hard even for leaders.** Sprout Social's dollar-based net retention fell from 107% (2023) to 104% (2024) to 100% (2025); excluding SMB it was 108% in 2024 and 102% in 2025. Meanwhile customers above $50K ARR grew 18% to 2,022. Small accounts churn and contract; large accounts expand. Your data should look like this: NRR below 100% in Starter/Growth cohorts, above 100% in Agency/Enterprise.
- **Multi-product adoption is the expansion engine where it works.** HubSpot reported that 62% of new Pro+ customers landed with multiple hubs, that 40% of its Pro+ installed base by ARR owns 4+ hubs, and full-year 2025 NRR of 103.5%. HubSpot also notes "a seasonal downtick in net revenue retention in Q1."
- **Involuntary churn is material.** Recurly's July 2026 network data shows SaaS churn of 3.22% split 2.16 points voluntary and 1.06 points involuntary, so about a third is failed payments. In the $250+ ARPC cohort involuntary churn is only 0.18%. Concentrate involuntary churn in Starter, monthly-billed and solo accounts.
- **Shelfware is the norm, and it peaks in December.** Vertice's "Unused SaaS applications" benchmark (updated July 2026, based on $75bn of processed spend) reports that "65% of all SaaS licenses are either entirely unused or underutilized – up from 62% a year ago," splitting into 14% fully unused and 51% underutilised (less than half of purchased licenses in use). Combined waste peaked at 69% in December 2025, consistent with year-end purchases that hadn't yet ramped up. Zylo's 2026 index puts average license utilisation at 54%. A share of seats in your top-tier accounts should be idle, and some top-tier accounts should be almost entirely dormant.
- **Agency client churn cascades to tool churn.** The ANA/4As 2025 tenure study puts average client–agency AOR tenure at about 7 years, but media-only agencies average 3.7 years. Focus Digital's 2026 data shows retainer agencies averaging 56-month client lifespans versus 24 months for project-based agencies. For Ripplewise, client contracts should be the unit that creates and destroys workspaces, queries and client_viewer seats.
- **Influencer seasonality and budget pressure.** Influencer Marketing Hub's 2025 benchmark reports the share of brands planning to increase influencer budgets fell from 59.4% (2024) to 49.2% (2025), and dedicated budgets fell to 75.6%. Practitioner sources report a Q4 creator-rate premium of 25–40% in November–December (low-quality source; treat as directional). Model campaign launches peaking in September–November with a January reset. **Revision:** the 2026 edition of the same benchmark reports 87.5% of brands expecting budgets to rise, and the two surveys may not measure the same thing, so do not hard-code budget pressure; make budget trend a per-account trait.
- **Outreach funnel benchmarks for creator simulation.** influencerfee.com reports that "Cold DMs to nano and micro creators typically generate a 5–15% response rate. Cold email to micro and mid-tier creators achieves 15–30%" (a vendor blog, so directional). Well-run personalised programmes cite about 30% reply, about 15% onboarding and 60–80% posting rates among onboarded creators. Use these to parameterise creator-record responses. A 2026 secondary source gives reply rates by creator tier for personalised outreach (micro 15–25%, macro 5–10%, mega 2–5%) and generic cold email at 3–5%, so make reply probability depend on creator tier and message quality, not one flat rate (see `docs/research-users-platforms-usage.md`).

### 1.4 Real user roadblocks (from G2/Capterra reviews)

| Roadblock | Verbatim evidence | Simulation hook |
|---|---|---|
| Query building / learning curve | Brandwatch reviewer (Capterra, Apr 2026): "There's a learning curve when it comes to setting up queries and getting the most accurate results." | Boolean skill latent → query edit loops, Boolean errors, time-to-first-dashboard |
| Sentiment distrust | Brandwatch Head of Insights (Capterra, Apr 2026): "Sentiment analysis remains an issue… Annoyance with the labour involved in grooming the sentiment." | sentiment_trust latent → manual re-tagging, lower dashboard reliance, export-to-spreadsheet |
| Noise | Meltwater VP (Capterra, Jan 2023): results "from a majority of click-bait, AI-generated SEO websites… an overpriced, worse alternative to Google alerts." | Broad queries → noise → exclusion edits or abandonment |
| Data mismatch | Brandwatch user (Capterra, May 2026): "the figures did not match. It made it hard to rely on the platform." | Trust shocks reduce engagement |
| Caps / topic cost | Talkwalker (G2): "Limiting monthly/annual data caps"; Sprout user: "They charge you a lot to create new listening topics, which has been cost-prohibitive." | Quota and query-count paywalls; some accounts churn instead of upgrading |
| Creator data accuracy | HypeAuditor (G2, Jul 2026): "outdated, incorrect, or missing email addresses cause significant losses, especially during bulk outreach campaigns." | Bounce/no-response creators; distrust → Influencers abandonment |
| Onboarding | HypeAuditor (G2, Jul 2026): "the onboarding experience could be improved… Some features aren't immediately intuitive." | Trial users who never reach first value |
| Contract friction | Upfluence (Capterra): "we were sold a 6-month contract… we were told the contract was 12 months"; Meltwater users describe hard-to-stop renewals | Cancellation flow friction, retention-offer response, annual lock-in churn spikes at term end |

### 1.5 Platform coverage (added in revision)

Real listening tools cannot see every platform. In a 2026 seven-tool test, four drew 85% or more of their data from X and
Reddit, and the top complaint among 241 professionals was API restrictions (64.6%). Instagram and TikTok are only partly
open to commercial tools. The Ripplewise corpus is Instagram/TikTok-heavy (about 31% of mentions), so decide whether to
keep that as a product choice and show a visible coverage note, or change it. Changing it is not a config tweak: most
corpus volume is comment and repost cascades, which pile up on X, YouTube, Instagram and TikTok regardless of the
root-post source shares. Details in `docs/research-users-platforms-usage.md`.

---

## 2. Improved segmentation model (layered)

Do not create a single "user type." Use six orthogonal layers. Some are observable and some are latent; keep the latent ones only in ground truth.

| Layer | Level | Values | Maps to existing field | Observable? |
|---|---|---|---|---|
| L1 Account archetype | Account | 10 archetypes (§4.1) | New `archetype` in ground truth; `account_type` (brand/agency/consultant/other) + `company_size_band` + `motion` observable | Partly — set `account_type` and `company_size_band` via signup questions |
| L2 Team composition | Account | solo, pair, core-team (3–5 seats), agency pod (seats + client_viewers), enterprise sprawl | Workspace roles (owner/admin/editor/viewer/client_viewer) | Yes, derived |
| L3 Job-to-be-done mix | Account and user | Use cases from §3, weighted | `goals` (multi-select) = stated JTBD; behaviour = revealed JTBD | Stated yes; revealed derived |
| L4 Usage rhythm | Account | always-on daily, always-on weekly/monthly, alert-driven passive, campaign-burst, crisis-spike, project one-off, dormant | None; emerges from behaviour | Derived |
| L5 Product mix | Account | Listening-only, Influencers-only, Listening-led dual, Influencers-led dual, balanced dual, switched | Needs per-product subscription (§5) | Derived + billing |
| L6 Lifecycle stage | Account | trial, activated trial, new paid (<90d), established, expanding, at-risk, dormant/shelfware, churned, resurrected | Billing events | Derived |

**User-level layer (within accounts).** Treat the onboarding `role_selected` (analyst/social/comms/agency/exec/admin) as the user's stated function. Treat `persona_archetype` (role × seniority) as the agent's ground-truth personality. They should *usually* agree but not always: 10–15% of users pick a role that doesn't match their behaviour, which is realistic and gives a "stated vs revealed" analysis. Map your four agent roles as follows:

- **division_leader:** owner, or for agencies the admin. Low frequency, high billing authority, reads summaries, triggers upgrades/cancellations.
- **account_exec:** editor or viewer. Report exports, client sharing, alert consumption.
- **strategist:** editor. Query building, competitive benchmarking, campaign planning, the Influencers campaign owner.
- **analyst:** editor. Heavy query editing, Ask AI, exports, Authors page.

Add a fifth non-seat actor, **client_stakeholder** (the client_viewer role): opens shared dashboards and reports. Their open rate is a leading renewal indicator for agencies.

**Why setting `account_type` and `company_size_band` matters.** Every planned analysis segments by them: agency vs brand NRR, seat utilisation by size, PQA scoring, shelfware risk. If they are always default, the analyst must infer segment from behaviour, which is circular, since you would be using the outcome to define the segment. Set them observably at signup (two onboarding questions), and in roughly 15% of accounts leave them blank or wrong (e.g., a consultant selecting "agency"). That gives a realistic data-quality issue to document.

---

## 3. Expanded use-case catalog

### 3.1 Social Listening (Arthur's four, plus eight more)

| # | Use case | Rhythm | Typical features | Signature in data |
|---|---|---|---|---|
| L1 | Always-on brand + competitor tracking (monthly) | Weekly logins, month-end report burst (agencies report to clients monthly ~46%, quarterly ~18%, weekly ~14%) | Dashboards, share of voice, scheduled reports | Sawtooth: export spikes in last/first 3 business days of month |
| L2 | Always-on + alerts | Low logins, alert-driven sessions | Alerts (volume, sentiment, high-reach author) | Sessions start from alert email; long gaps between |
| L3 | Crisis / crisis threat on-demand | Dormant → 5–15 day spike | Crisis room, hourly refresh, exports, Ask AI | Sudden 10× activity, then decay; upgrade during crisis, downgrade after |
| L4 | Exploratory category research at project kick-off | One 2–6 week burst | Many broad queries, history pack, Ask AI | High query creation/deletion churn, history-pack purchase, then dormant |
| L5 | Campaign measurement (pre/during/post) | Burst around campaign dates | Date-range comparison, SOV, emotion widget | Query created 2 weeks before a date; report 2–4 weeks after |
| L6 | Competitive intelligence / benchmarking | Monthly or quarterly | SOV, competitor queries | Competitor queries outnumber own-brand queries |
| L7 | Product feedback / voice-of-customer | Weekly | Topic filters, negative mentions, Ask AI | Heavy filter use on negative sentiment and product terms |
| L8 | New-business pitch research (agencies) | Ad hoc, 3–5 day bursts | Temporary workspace, exploration, export | Workspaces created then archived; queries for prospects not clients |
| L9 | Executive briefing | Weekly/monthly digest | Scheduled reports, public share links | Exec users with only report-open events |
| L10 | Influencer/author identification from listening | Ad hoc | Authors page, high-reach alert, watchlist | The **bridge**: Authors → watchlist → Influencers discovery |
| L11 | Issue/risk monitoring for regulated or high-risk brands | Always-on, passive | Sentiment alerts, crisis room | Alerts configured and acknowledged, little else |
| L12 | Client reporting factory (agency) | Fixed monthly cadence | White label, client_viewer, scheduled reports | Many workspaces, client_viewer opens, very regular cadence |

### 3.2 Influencers/Creators (parallel catalog)

| # | Use case | Rhythm | Signature |
|---|---|---|---|
| I1 | Always-on ambassador/creator programme | Steady monthly | Recurring invitations, repeat creators, contracts |
| I2 | One-off launch campaign | Single 6–10 week arc | Discovery burst → shortlist → outreach → content → results → dormant |
| I3 | Seasonal pushes (back-to-school, holiday, Valentine's) | 2–4 arcs/yr | Campaign creation clustered in Aug–Nov |
| I4 | Affiliate/performance programme | Steady, metric-heavy | Tracking links, ROAS views, payouts |
| I5 | Agency multi-client roster management | Parallel campaigns | Many active campaigns across workspaces; hits campaign limit |
| I6 | Gifting/seeding (no fee) | Bursty | High invitation volume, low budget, many declines |
| I7 | Creator vetting only (brand-safety/authenticity audit) | Ad hoc | Profile views and compare, no campaigns. Consumes profile quota fast |
| I8 | Competitor creator research | Ad hoc | Discovery and profiles of creators working with competitors |
| I9 | UGC sourcing | Bursty | Content submission/review heavy, low tracking |

---

## 4. Agent behavior specification

### 4.1 Account archetypes and proportions (target ~360 accounts)

| ID | Archetype | Share | account_type / motion | Size (users: seated / client_viewer) | Product affinity (L/I) | Default plan path | Key traits |
|---|---|---|---|---|---|---|---|
| A1 | Boutique social/PR agency | 22% | agency / self-serve | 6–10 (3–5 / 2–5) | 0.75 / 0.25 | Trial → Growth → Agency | Client portfolio drives everything; report exports; white-label desire |
| A2 | Agency network team | 8% | agency / sales-assisted | 10–20 (6–12 / 4–10) | 0.6 / 0.4 | Agency → Enterprise quote | Multi-workspace, seat sprawl, champion risk |
| A3 | Mid-market brand comms/PR team | 14% | brand / self-serve | 3–6 | 0.85 / 0.15 | Trial → Starter/Growth | Crisis-prone, alert-driven |
| A4 | Brand social/insights team | 12% | brand / self-serve | 3–7 | 0.65 / 0.35 | Growth | Always-on L1/L6/L7; cross-sell candidates |
| A5 | DTC/e-comm creator team | 12% | brand / self-serve | 2–5 | 0.25 / 0.75 | Trial → Growth (Influencers-first) | Q4 seasonality, ROAS, affiliate |
| A6 | Influencer-marketing agency | 7% | agency / self-serve | 6–12 | 0.15 / 0.85 | Growth → Agency | Campaign-limit pressure, payouts gate |
| A7 | Solo consultant/freelancer | 10% | consultant / self-serve | 1–2 | 0.8 / 0.2 | Starter | Price-sensitive, quota pressure, card failures |
| A8 | Project/crisis buyer | 6% | brand or agency / self-serve | 2–4 | 0.95 / 0.05 | Trial → month-to-month → cancel → resurrect | Burst usage, resurrection |
| A9 | Enterprise brand | 4% | brand / sales-assisted | 15–40 | 0.6 / 0.4 | Enterprise from start | Shelfware: many idle seats, a few power users |
| A10 | Tire-kicker / student / researcher | 5% | unset / self-serve | 1 | random | Trial only | Never activates; noise in funnel |

To meet Arthur's ≥6 users rule without breaking his ~3 seats realism, count users ≠ seats. An agency account has 3–5 seated, active users plus client_viewers, invited-but-never-activated users and departed users. Single-user archetypes (A7, A10) and small brands should exist; forcing every account to 6+ would erase the single-threaded-risk analysis.

### 4.2 Latent drivers (hidden variables, assigned at account creation)

Draw each variable from an archetype-specific distribution, add per-account noise, and store it in ground truth only.

| Variable | Range | Drives |
|---|---|---|
| `need_intensity` | 0–1 | Query count, mention volume, session frequency |
| `mention_scale` | 0.2–20 (log-normal) | Virtual mention metering (§7). How "big" the tracked brands are |
| `boolean_skill` (per user) | 0–1 | Boolean errors, query edit loops, noise level, time-to-first-value |
| `sentiment_trust` | 0–1 | Dashboard reliance vs exports, manual re-tagging |
| `engagement_propensity` | 0–1 | **The confounder**: feature adoption *and* baseline retention |
| `champion_strength` + `champion_tenure_months` | 0–1, months | Multi-threading, departure risk, post-departure collapse |
| `budget_slack` | 0–1 | Willingness to upgrade on paywall vs churn/downgrade |
| `price_sensitivity` | 0–1 | Retention-offer acceptance, yearly-vs-monthly choice |
| `payment_reliability` | 0–1 | Failed payment probability, dunning recovery |
| `org_inertia` | 0–1 | Shelfware: keeps paying while unused; slow to cancel |
| `product_affinity_L`, `product_affinity_I` | 0–1 each | Product mix and cross-sell timing |
| `seasonality_profile` | enum | Q4 campaign peak, academic calendar, fiscal-year (Apr/Jul) budgets |
| `crisis_propensity` | Poisson rate | Crisis shock arrivals |
| `client_portfolio` (agencies) | list of clients {start, contract_end, renewal_prob, needs} | Workspaces, queries, client_viewers, report cadence |
| `true_feature_effect` | per-account τ | Planted causal effects (§4.4) |
| `idiosyncrasy_seed` | int | Long-tail behaviours (§4.6) |

**Causal wiring (the core rule).** Every observable outcome must be a function of latents + shocks + product state, never a scripted label. For example, monthly churn hazard is a function of:

`h(t) = base_archetype × f(value_realised_t) × g(budget_slack) × (1 − τ·uses_feature_t) × champion_shock × client_loss_shock × price_change × noise`

where `value_realised_t` itself comes from need × boolean_skill × sentiment_trust × feature use.

### 4.3 Lifecycle trajectories (with triggers and target rates)

| Trajectory | Trigger mechanism (latent → event) | Target incidence |
|---|---|---|
| Trial → convert | Activation (§6 definition) reached within 7 days strongly predicts conversion | **~6–10% of trials convert overall** (no-card trial; see the revision notes). About a fifth of trials activate, converting at ~30%, against ~2% of the rest, which gives ~7–8% overall |
| Trial → abandon | Low boolean_skill + broad query → noise → no dashboard built | ~80% of trials never activate; ~90% end without paying |
| Trial → grace → convert late | Converts during the 3-day grace window; price_sensitivity high | ~1% of trials (part of the overall 6–10%, not on top of it). Creates a spike at day 14–17 |
| Quota-driven upgrade | Hits 80%/100% of mentions or queries; upgrades if budget_slack > threshold, else lives capped, trims queries, or churns | Of accounts hitting 100% for 2 consecutive months: ~35% upgrade, ~40% stay capped, ~25% churn within 3 months |
| Gate-driven upgrade | Encounters a gated feature tied to its JTBD (crisis room for A3, white label/client_viewer for A1, campaign tracking for A5) | Agency upgrades mostly gate-driven, not quota-driven: a discoverable finding |
| Seat-driven expansion | New hire / new client adds user; hits seat cap → extra-seat add-on or tier upgrade | Growth accounts in A1/A4 |
| Cross-sell L→I | Authors page / high-reach alert use → watchlist → first Influencers visit → campaign within 60 days → Influencers subscription | ~18% of Listening-first dual-eligible accounts by month 12 |
| Cross-sell I→L | Campaign results → brand mention tracking for campaign hashtag → Listening | ~10% of Influencers-first accounts |
| Bought both, kept one | Suite start; one product's usage decays (low affinity); downgrade removes product at renewal | ~30–40% of suite starters drop one product within 9 months; Influencers dropped about 2:1 vs Listening |
| Downgrade post-crisis | Crisis ends; monthly payer drops tier | 40% of crisis-driven upgrades revert within 2 months |
| Dormant shelfware | org_inertia high + champion left or project ended; annual billing keeps it alive | 15–25% of Agency/Enterprise accounts have <10% seat activity for ≥60 days; ~5% of all paid accounts are "near-zero" for 90+ days |
| Champion departure | Hazard tied to champion_tenure; user removed or goes inactive; account becomes single-threaded or headless | 8–12% of multi-user accounts per year. If no second editor with ≥4 active weeks, churn hazard ×3 for 6 months |
| Agency client loss cascade | Client contract ends → workspace archived, queries deleted, client_viewers removed → possible downgrade | Per-client annual loss ~15–25% for retainers, ~40% for project clients |
| Involuntary churn | Card fails (1 − payment_reliability); retries at day 1/3/5; recovery probability by plan | Involuntary ≈ one-third of churn in Starter/monthly; near zero in Enterprise |
| Retention offer | Shown once in cancellation flow (to a random 70%, holdout 30%) | Acceptance 20–35%, higher with price_sensitivity; ~half of acceptors churn at end of discount |
| Resurrection | A8 crisis buyers return when a new crisis hits | 30% of churned A8 accounts reactivate within 12 months |
| Yearly vs monthly | price_sensitivity low + need stable → yearly | Annual accounts show lower churn but churn spikes at month 12, and more shelfware |

### 4.4 Causal / confounding structures (the core case study)

Plant one primary question and several secondary ones. Store true effects in ground truth.

**Primary: "Do scheduled reports cause retention?"**
- **Confounding:** `engagement_propensity` raises both P(adopt scheduled reports) and baseline retention. Agencies with many clients also adopt more *and* retain more, because the client portfolio confounds too.
- **True effect (heterogeneous):**
  - Agencies with client_viewers: hazard ratio 0.75.
  - Brand teams: 0.92.
  - Solo accounts: 1.0 (null).
- **Expected naive estimate:** hazard ratio of about 0.45, i.e. a large overstatement.

**Identification hooks to bake in:**

1. **Staggered rollout (difference-in-differences / event study):** release scheduled reports to eligible accounts in four waves (months 4, 6, 8, 10), assigned by `hash(account_id) mod 4`. Log a `feature_flag_assigned` event. Use Callaway–Sant'Anna or a stacked event study.
2. **Randomised encouragement (IV):** 50% of eligible accounts receive an onboarding checklist item, "Schedule your first report." Assignment is random, raises adoption by ~25 points, and affects retention only through adoption. Gives a LATE.
3. **Regression discontinuity:** a CSM onboarding call is offered to accounts whose observable health score ≥ 60 on day 30. The call raises adoption of alerts and scheduled reports. Log the running variable.
4. **Plan-gate discontinuity:** Growth gates scheduled reports. Compare accounts just above vs just below the quota level that triggers upgrade (fuzzy RD on mention-usage share), or compare upgraders motivated by quota versus by gate.
5. **Natural experiment:** a 9-day alert-delivery outage in month 9 for a random 30% of accounts, keyed by region or workspace shard. Tests alert dependence on later engagement.
6. **Price change cohort:** raise Starter from $79 to $99 for signups after month 10. Gives an interrupted-time-series / cohort comparison of conversion and churn.
7. **Retention-offer holdout:** random 30% never see the offer. A clean A/B inside the "no A/B" story, useful as the benchmark against which the observational methods are graded.

**Secondary planted questions:**
- **Ask AI vs boolean_skill:** low-skill users who use Ask AI reach first value faster; Ask AI has no effect for high-skill users.
- **Client_viewer opens:** these predict agency renewal, but only because they proxy the client relationship. Plant an effect where client_viewer opens decline 6–8 weeks before a client-contract loss.
- **Authors page → cross-sell:** a true but modest effect, plus confounding by product_affinity_I.

### 4.5 Exogenous shocks and seasonality calendar

- **Crisis shocks:** Poisson per account (A3/A8 rate ~1.5/yr; others ~0.3/yr). Each gets a severity draw; activity multiplies 5–15× for 5–15 days with exponential decay. Some crises are *industry-wide*, hitting all accounts tracking the same category in the same week, so correlated spikes across unrelated accounts are a discoverable anomaly.
- **Calendar:**
  - Month-end/start report bursts (agencies).
  - Q4 influencer campaign peak (Sept–Nov campaign creation, Nov–Dec content).
  - December renewal/shelfware bump.
  - January budget reset and Q1 contraction.
  - Summer (July–August) usage dip of 15–25%.
  - US Thanksgiving week and late-December troughs.
- **Region:** about 55% North America, 30% EMEA, 15% APAC/LatAm by account count, but higher NA share of revenue (~65%) because Agency/Enterprise skews NA. This tests Arthur's prior that revenue concentrates in NA without making it trivially true. Timezones should shift activity hours.
- **Product incidents:** one sentiment-model regression week (month 12) that raises manual re-tagging and lowers dashboard use among high-sentiment_trust accounts.

### 4.6 Noise, heterogeneity and the long tail

- **Reserve 10–12% of accounts as "idiosyncratic":** each picks 1–2 unusual behaviours from a menu. Examples:
  - Only uses the Authors page.
  - Uses Influencers purely for compare/vetting (I7).
  - Exports everything daily and never views dashboards.
  - 9 workspaces each with one query.
  - Uses Ask AI as the only interface.
  - Builds 40 alerts and never logs in.
  - Logs in only from client_viewer-shared links.
  - Tracks a non-English market.
  - Weekend-only usage.
  - Creates and deletes the same query repeatedly.
- **Persona drift:** 10–15% of users behave unlike their stated role_selected.
- **Measurement noise:**
  - ~2% of events duplicated.
  - ~1% arrive late (backfilled timestamps).
  - Occasional null `persona` on server-side events.
  - Client clock skew.
  - One tracking-plan version change in month 8 (renamed property).
  - These give a realistic data-cleaning chapter.
- **Non-stationarity:** archetype mix of new signups shifts over time (more A5 after a hypothetical "Creators launch" marketing push in month 6), so cohort comparisons have composition effects.

### 4.7 Ground truth vs observable separation

- **Two schemas.** In Postgres (`sim_truth`) and BigQuery (`ripplewise_truth`), keep tables never read by the app or tracked:
  - `truth_accounts` (archetype + all latents)
  - `truth_users` (persona, seniority, boolean_skill, departure date)
  - `truth_shocks` (crisis, client loss, outage, with dates)
  - `truth_assignments` (rollout wave, encouragement arm, offer holdout)
  - `truth_effects` (planted τ by segment)
  - `truth_decisions` (each agent decision with the reason code and probability used)
- **The analytics dataset (`ripplewise_events`) only receives tracked events and app tables.** Join keys are shared (account_id, user_id) so validation is easy later.
- **Seal the truth.** Version the simulator config (YAML with archetype distributions and effect sizes) and commit its hash. Seal truth tables until analyses are written, so the portfolio can honestly claim "blind analysis, then validation against ground truth."

### 4.8 Implementation pattern for LLM agents

Use a **hybrid orchestrator**:
- **Daily tick:** a cheap stochastic policy decides who logs in and roughly what they do, driven by latents, rhythm and calendar.
- **LLM calls only at decision points:**
  - Writing a query (gives realistic Boolean quality and errors given boolean_skill).
  - Interpreting a paywall.
  - Deciding upgrade/downgrade/cancel with a stated rationale.
  - Composing a brief or outreach message.
  - Reacting to a crisis.
- Feed the LLM the latents as persona context and the account's recent state.
- Log its decision plus rationale to `truth_decisions`.
- This keeps cost manageable and makes behaviour causally traceable.

---

## 5. Packaging recommendation

**Problem.** One plan covers both products, so "pay for one, later add the other" and "buy both, keep one" do not exist as billing states. Usage-only proxies (product usage shares) will be the only evidence, which is weaker and unrealistic relative to market practice. Sprout and Meltwater both sell influencer as a separately priced module.

### Option A (recommended): per-product subscriptions with a suite discount

- **Structure:** an account holds 0–2 subscription items. `listening` uses tiers Starter/Growth/Agency/Enterprise with the current Listening limits; `creators` uses tiers Starter/Growth/Agency/Enterprise with the current Influencers limits.
- **Suite discount** when both are active, e.g. 20% off the lower-priced item.
- **Illustrative creators prices:** Starter $99, Growth $299, Agency $699, roughly in line with Modash's $299/$599 monthly points.
- **Trial:** covers both products (so "trial both → subscribe to one" is observable).
- **Feature gates follow the product:** creator CSV export and contracts require creators Growth; crisis room requires listening Growth.
- **Bridge features** (Authors → "find this author in Creators") stay visible to listening-only accounts as a teaser paywall, mirroring Hootsuite's "Listening Basics" free layer.
- **Pros:**
  - Every target pattern becomes a billing fact: cross-sell sequences, product abandonment, suite-discount effects, product-level NRR, land-and-expand paths.
  - Mirrors Stripe-style subscription items, so the code is straightforward.
- **Cons:**
  - Two plan matrices to maintain.
  - Gate logic must check the right product.
  - Migration of seeded accounts needed (map current plan to both items or to listening only, by archetype).
- **Effort:** moderate. A `subscription_items` table, per-item plan_tier, entitlement checks keyed by product, and billing events carrying `product`.

### Option B: base platform plan + Creators add-on module

- **Structure:** keep current Listening-centred tiers. Influencers becomes an add-on (e.g., +$149/+$299/+$499 by tier) that can be added or removed mid-term.
- **Pros:** smallest code change; mirrors Sprout/Meltwater module selling; add-on attach rate becomes a clean KPI.
- **Cons:**
  - "Influencers-only" customers are impossible, which kills the Influencers-first land path (A5/A6 need it).
  - Implies Listening is always the land product, which pre-bakes the finding.

**Recommendation: Option A.** It is the only option where "which product lands first" is a genuine empirical question in the data.

### Other packaging questions

- **Per-seat on self-serve:** don't switch wholesale. The market is split: Brand24/YouScan offer unlimited users, Sprout prices per seat. Add an **extra-seat add-on** (e.g., $29/seat/mo on Growth/Agency) so seat pressure has a cheaper resolution than a tier jump. That makes "seat expansion vs tier expansion" a separable expansion-revenue driver and makes seat underuse (paid but idle seats) measurable.
- **Enterprise accounts:** include them (A9, ~4% of accounts, but ~20–25% of ARR). Without them there is no ARR concentration, no seat-sprawl shelfware and no sales-assisted motion to contrast with self-serve PQA scoring.
- **`account_type`:** must be set observably (signup question); see §2.

---

## 6. Tracking plan additions

Every event keeps `account_id`, `user_id`, `plan_tier` and `persona`, and adds:
- `product` (listening/creators/hub)
- `workspace_id`
- `workspace_role`
- `role_selected`
- `listening_tier` / `creators_tier` (after §5)
- `billing_interval`
- `days_since_signup`
- `tracking_plan_version`
- `session_id`
- `source` (in_app, email_alert, scheduled_report_email, share_link)

| Area | Event | Key properties | Enables |
|---|---|---|---|
| Hub / session | `Session Started`, `Product Switched` | from_product, to_product, entry_source | Product mix, login by role, alert-driven sessions |
| Quota | `Quota Threshold Reached` (extend) | resource (mentions/queries/alerts/ai/profiles/invitations/campaigns), pct (50/80/100), limit, days_left_in_cycle | Quota pressure curves, PQA |
| Gates | `Feature Gate Encountered` | gate_name, required_tier, product, surface, action_taken (dismissed/viewed_pricing/started_upgrade) | Gate-driven upgrade analysis |
| Billing | `Subscription Item Added` / `Removed` / `Tier Changed` | product, from_tier, to_tier, mrr_delta, reason, suite_discount_applied | Cross-sell, keep-one, NRR by product |
| Billing | `Payment Failed`, `Payment Retried`, `Payment Recovered` | attempt_n, decline_type | Involuntary churn |
| Billing | `Retention Offer Shown` / `Accepted` / `Declined` | offer_id, holdout_flag | Offer causal effect |
| Billing | `Seat Added` / `Seat Removed`, `Invite Sent` / `Invite Accepted` | role, inviter_role | Seat sprawl, multi-threading |
| Queries | `Query Created` / `Edited` / `Deleted`, `Query Validation Failed` | n_terms, n_operators, has_exclusions, error_type, edit_seconds | Boolean friction, time-to-first-value |
| Value | `Dashboard Viewed`, `Widget Interacted` | widget_type (SOV, sentiment, emotion), query_count | Breadth/depth of engagement |
| Sentiment | `Sentiment Overridden` | from, to, n_mentions | Sentiment distrust |
| Reports | `Report Exported`, `Report Scheduled`, `Scheduled Report Delivered`, `Share Link Created` | format, recipients_n, white_label | Renewal driver hypothesis |
| Client | `Client Viewer Opened` | asset_type, days_since_delivery | Agency renewal signal |
| Alerts | `Alert Created`, `Alert Fired`, `Alert Acknowledged` | alert_type, latency_to_ack | Passive-use and outage experiment |
| AI | `Ask AI Queried` | question_type, answer_rated | AI as skill substitute |
| Bridge | `Author Watchlisted`, `Author Opened in Creators` | author_reach_band | Cross-sell path |
| Creators | `Creator Searched`, `Creator Profile Opened`, `Shortlist Created`, `Campaign Created` / `Status Changed`, `Invitation Sent`, `Creator Responded` (accept/decline/counter/no_response), `Content Submitted` / `Reviewed`, `Tracking Link Clicked` (anonymous), `Conversion Recorded`, `Campaign Results Viewed`, `Payout Simulated` | campaign_id, creator_tier, response_latency, objective | Outreach funnel, ROAS-driven retention |
| Experiments | `Feature Flag Assigned`, `Onboarding Checklist Item Shown` / `Completed`, `CSM Call Offered` / `Held` | wave, arm, running_score | Causal identification |
| Lifecycle | `Account Activated` (computed server-side) | activation_definition_version | Activation study |

**Proposed activation definition to test:** within 7 days, ≥1 query edited after creation (shows Boolean refinement) **and** ≥1 dashboard viewed on 2 separate days **and** (≥1 alert or report scheduled **or** ≥1 teammate invited). Arthur should validate this against alternatives rather than assume it.

---

## 7. Sizing and time horizon under constraints

- **Decouple metering from storage (the most important constraint fix).** Bill quota usage with a virtual counter: `metered_mentions = matched_mentions × mention_scale`. Store only a capped sample of result rows per query (e.g., ≤1,500 rows per query per month) or mention-ID references into the shared corpus. With ~9,400 corpus mentions per 30-day window, real matches can never produce realistic Growth/Agency volumes anyway. Replace the artificial "this/the/for" broad queries with mention_scale, so quota pressure reflects brand size rather than nonsense queries.
- **Storage budget.** About 545 MB of Neon headroom. Reserve ~150 MB for app state growth (users, campaigns, creators activity, billing). That leaves ~350 MB, about 1.75M result rows at 200 bytes. 360 accounts × ~4 queries × 18 months × ≤1,500 rows is worst case ~39M rows, so the cap must be much lower *or* results must be shared references. Recommend shared references (one corpus row reused by many accounts' queries, plus a small join table) and daily aggregates (`query_day_metrics`: counts by sentiment/topic/source) instead of row materialisation for dashboards. Aggregates for 360 × 4 × 548 days ≈ 0.8M rows, well within budget.
- **Events go to BigQuery, not Neon.** At ~150–250 events per active user-week, ~1,500 active users over 78 weeks is roughly 20–30M events. That is a few GB in BigQuery, which is cheap. Keep raw events out of Neon.
- **Population:** ~360 accounts and ~2,200 users, including client_viewers and invited-only users. Stagger signups at ~15–25 per month plus a seeded starting base of ~90, so you get 12+ monthly cohorts with at least 6 months of follow-up each.
- **Horizon:** 18 simulated months. Twelve gives one Q4 and one renewal cycle; 18 gives annual renewals for early cohorts, a second Q1 contraction, and enough post-period for the staggered rollout. Run it in simulated-time batches (e.g., 1 week per run) so you can checkpoint and inspect.
- **Highest insight per storage byte:**
  1. Billing/subscription events and seat changes (tiny, highest value).
  2. Quota/gate encounters.
  3. Report/export/client_viewer events.
  4. Alerts fired/acknowledged.
  5. Creator outreach funnel.
  6. Raw query results (lowest marginal value, so cap aggressively).

---

## 8. Portfolio analyses mapped to required data

| # | Analysis | Hiring-manager signal | Required data |
|---|---|---|---|
| 1 | **Feature → retention causal study** (naive vs DiD vs IV vs RD, validated against planted τ) | Causal rigour without A/B tests: rare and impressive | Rollout waves, encouragement arm, CSM running score, retention-offer holdout, feature usage, churn |
| 2 | **Activation definition** (search candidate "aha" combos, pick by lift and coverage, check on later cohorts) | Core PM-analytics skill | First-14-day events, conversion, 90-day retention |
| 3 | **PQA scoring model** (which trials/Starter accounts are upgrade-ready; precision at top-k vs a heuristic) | Directly used by PLG revenue teams | Quota pct milestones, gate encounters, invites, query edits, motion |
| 4 | **Expansion revenue decomposition** (NRR = seat add-ons + tier upgrades + cross-sell − downgrades − churn, by archetype and cohort) | Speaks the CFO's language | Subscription items with mrr_delta, seats, product |
| 5 | **Multi-product adoption and land path** (which product lands first, time-to-second-product, keep-one survival curves, suite discount effect) | Platform strategy | Per-product subscription events (needs §5) |
| 6 | **Shelfware/at-risk model** (seat utilisation, champion departure, single-threadedness → renewal risk 60 days ahead) | CS and renewal ops | Seat activity, user removals, sessions by role, annual renewal dates |
| 7 | **Pricing/packaging test** (Starter price change ITS, retention-offer A/B, yearly vs monthly) | Monetisation | Price change cohort flag, offer holdout, billing interval |
| 8 | **Agency renewal driver test** (do exports/client_viewer opens predict renewal beyond client count?) | Tests Arthur's own prior; shows humility | Client portfolio (truth for validation), exports, client_viewer opens |
| 9 | **Roadblock funnel** (Boolean errors → noise → abandonment; Ask AI as remedy) | Product-discovery insight | Query validation failures, edits, sentiment overrides, AI usage |
| 10 | **Influencer outreach funnel and campaign seasonality** | Second-product depth | Creator response events, campaign status, calendar |

---

## Caveats

- **Pricing sources are mixed.** Brand24, YouScan, Modash and Sprout seat prices come from vendor pages or consistent third-party snapshots. Brandwatch, Meltwater, CreatorIQ, Aspire and Traackr figures are procurement-data or competitor-blog estimates (several from vendors selling alternatives), so treat them as directional. The Sprout $3,000/mo Listening figure is second-hand, and GRIN's January 2026 dollar amounts are unverified, although the move to month-to-month self-serve pricing is confirmed by GRIN's own release.
- **No public attach-rate data.** Neither the listening→influencer attach rate nor the land sequence is published by any vendor found. Sprout's 27–30% "premium product attach rate" (Q3–Q4 2023 calls) covers social listening, premium analytics and social advocacy, not influencer, so it is only an indirect proxy. The proportions recommended here (70/30 land split, ~18% cross-sell by month 12, 30–40% keep-one) are design parameters, not market facts.
- **Agency client tenure ≠ tool tenure.** The ANA/4As ~7-year figure covers AOR relationships; social-listening retainers are likely shorter and more project-like.
- **Simulated insight is only as credible as its causal wiring.** If outcomes are scripted by archetype rather than generated from latents and shocks, analyses will merely rediscover the config. Arthur should state openly in his portfolio that the data is synthetic and frame the work as "methods validated against known ground truth."
- **Arthur's priors should be testable, not hard-coded.** "Agencies are the main customers," "NA dominates revenue," "report exports drive renewal" and "unified sentiment view is the hook" should each come out partially true, with exceptions, so the analysis has something to discover.