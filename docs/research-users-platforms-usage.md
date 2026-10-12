# Research: users, platforms and usage (for the simulation)

Written 2026-10-12 to check and sharpen the numbers in the simulation plan (`Ripplewise Simulation Plan: Market-Grounded
Agent Behavior…`). It adds web research on who uses social listening and influencer tools, which platforms the data comes
from, and how often and how people use them. Every figure carries a confidence tag. Most public numbers come from vendors
selling something, so read them as ranges, not facts.

**Confidence tags:** **A** = primary report or direct data; **B** = a reasonable secondary summary; **C** = vendor blog,
single source, undated or conflicting.

## What the research changes

1. **The trial conversion target is too high for a no-card trial.** The plan targets about 15–20% of trials converting.
   The best 2026 data (200 B2B products) puts the median free-to-paid rate at 8%, and a no-card trial at roughly 6–9%.
   Cards-required trials reach about 30%. Ripplewise's trial needs no card, so aim for **6–10%** overall. Keep the
   activated-versus-not contrast, rescaled so it adds up: about 30% of activated trials against about 2% of the rest gives
   roughly 7–8% overall if a fifth of trials activate.
2. **Real tools cannot see all platforms, and the corpus pretends they can.** About 31% of the corpus is Instagram and
   TikTok, which real listening tools reach only partially. This is a product-fiction choice, but it should be a
   conscious one, because "data coverage" is the top real-world complaint.
3. **Monthly is the dominant reporting rhythm.** About 46% of agencies report to clients monthly, 18% quarterly and 14%
   weekly. That supports the plan's month-end report bursts and argues against modelling many weekly reporters.
4. **Influencer outreach reply rates depend strongly on creator size.** Use tiered rates, not one number (below).
5. **The plan's "influencer budgets are falling" premise looks dated.** It came from the 2025 report. The 2026 edition
   reports 87.5% of brands expecting budgets to rise. The two surveys may not measure the same thing, so do not assume
   budget pressure; make it a per-account trait.
6. **Several useful numbers do not exist publicly:** role-level user mix, login frequency of listening tools, creators per
   campaign, and activation benchmarks. Those stay design parameters, not market facts (see Gaps).

## 1. Users

| Finding | Source | Conf. |
|---|---|---|
| Most social teams are small: the 2026 Meltwater report finds most respondents run teams of 0–2 people | [Meltwater 2026 Global State of Social Media](https://learn.meltwater.com/rs/814-WJU-189/images/2026%20Global%20State%20of%20Social%20Media%20Report.pdf?version=0) | B |
| Social media managers and data analysts are described as the traditional core users; PR staff made up about a third of users and C-level about 8% (2020 survey) | [Talkwalker State of PR 2020, via PR coverage](https://martechseries.com/analytics/global-survey-reveals-85-pr-practitioners-missing-effective-pr-tools-techniques/) | C (old) |
| 43% of respondents hold senior manager, director or C-suite titles (200+ professionals, 2023) | [SI Lab 2023](https://thesilab.com/social-listening-statistics/) | B |
| 30% of agency professionals say listening factors into every decision, against 10% at brands | [SI Lab State of Social Listening 2025](https://www.thesilab.com/state-of-social-listening) (more than 300 professionals; read through summaries) | B |
| Teams use more than one tool: over 30% use two (SI Lab). A Brand24 summary says 78.5% use more than one, which conflicts | SI Lab 2025; [Brand24 summary](https://brand24.com/blog/social-listening-statistics/) | C |
| Competitive benchmarking is the most common use case; cultural and trend analysis is the main objective | SI Lab 2025 | B |
| 86% of 300 marketers use the tools to monitor customer requests, questions and concerns (undated) | [Clutch survey, via PR Daily](https://www.prdaily.com/report-marketers-turn-to-instagram-youtube-linkedin-and-more-for-social-listening/) | C |
| Influencer programmes: 66% run in-house, 11% hybrid, 11% agency-run, 12% run none. Discovery and vetting is the function most often outsourced (19%). AI is used for discovery by 37% | [Influencer Marketing Hub 2026 benchmark](https://influencermarketinghub.com/influencer-marketing-benchmark-report/) (600+ marketers) | A |

**What to take from it.** Small teams are the norm, which supports the plan's single-user and pair archetypes and argues
against forcing every account to 6+ users. Agencies lean on listening for decisions more than brands do, which supports
making agencies the heaviest users. Most influencer work is done by brands in-house, so the influencer-agency archetype
should be a minority.

## 2. Platforms

### 2.1 What real tools can actually see

| Finding | Source | Conf. |
|---|---|---|
| In a 7-tool test, 4 of 7 drew 85% or more of their data from X and Reddit; 5 of 7 drew over 50% from a single source | [Datashake 2026 Social Data Coverage Report](https://www.datashake.com/resources/social-data-coverage-report-2026) | A |
| Top challenge among 241 social intelligence professionals: API restrictions and platform changes (64.6%); lack of data access 25.9%; budget 23.3% | Datashake (same report) | A |
| Twitter/X ended free access in February 2023; Instagram's API was deprecated in December 2024 | Datashake | A |
| X recent search covers 7 days, and the full archive needs a paid or enterprise plan; the TikTok research API is restricted; Instagram hashtag search returns only the last 24 hours | [Syncly](https://syncly.app/blog/social-listening-historical-data-what-12-tools-mean-(2026)) and other vendors who sell data access | C: verify against platform docs |
| Instagram was the most-used data source in 2025, though 19% planned to change | SI Lab 2025 | B |

### 2.2 How big the platforms are (for weighting a simulated population)

| Platform | Monthly users (approx.) | Conf. |
|---|---|---|
| Facebook | 3.05–3.07 billion | B |
| Instagram | about 3.0 billion | B |
| YouTube | 2.5–2.85 billion (sources disagree) | B |
| TikTok | about 1.9 billion | B |
| Pinterest | about 0.62 billion | B |
| X | about 0.59 billion | B |

These come from roundups of DataReportal's Digital 2026 figures; they count accounts, not people, and I found no Reddit
figure. Reach is not the same as what a listening tool can collect.

### 2.3 Where brands put influencer money

TikTok is the platform most often included in 2026 influencer plans (31% of respondents); every other platform falls in
a band of roughly 8–15%. Among brands using social commerce, TikTok Shop accounts for 66% of platform selections. These are
selection rates, not spend. Source: [IMH 2026 benchmark](https://influencermarketinghub.com/influencer-marketing-benchmark-report/) (A).

Creator tiers: nano and micro creators dominate expansion plans (about half of respondents expect to use more of each),
and nano and UGC creators are mostly paid under $500 per post (about 55% and 80%). Mid-tier fees cluster at
$2,000–$10,000. The report gives no creators-per-campaign figure.

### 2.4 Our corpus against this

| Source in corpus | Share | Real-tool reality |
|---|---|---|
| X | 36.3% | Heavily covered, but access is paid and limited |
| Instagram | 17.3% | Partially covered; hashtag and API access restricted |
| TikTok | 13.9% | Research API restricted; commercial tools have limited coverage |
| Facebook | 8.8% | Public pages and groups only |
| YouTube | 7.8% | Well covered |
| Reddit | 5.1% | Heavily covered in real tools; the corpus is light on it |
| Reviews, forums, blogs, news | 10.8% | Real tools lean on these more than the corpus does |

The corpus is **social-first and Instagram/TikTok-heavy (31%)**, while real tools lean on X, Reddit, news, blogs, forums
and reviews. Options: keep it as a deliberate product choice and show a visible "coverage" note in the product, or
rebalance toward Reddit and the open web. Either way it is a documented decision, not an accident.

**Rebalancing is not a config change (tried and reverted).** I changed the source shares in `datagen/config.ts` to favour
Reddit and the open web, and rebuilt the deployment-sized corpus. The mix did not move the way intended: X rose to 39.5%
and YouTube to 20.1%, while Reddit fell to 2.5% and the open web to about 5% combined. Root posts do follow the shares,
but about 63% of the corpus is comments and reposts, and those cascades pile up on X, YouTube, Instagram and TikTok
regardless. Steering the final mix means reworking the cascade rules, which could disturb the spam, sentiment and crisis
checks the corpus was validated against, so the change was reverted and the corpus is unchanged.

## 3. Usage

| Finding | Source | Conf. |
|---|---|---|
| Agencies report to clients monthly (about 46%), quarterly (18%) or weekly (14%) | Databox survey of 241 agencies, via [CloudCampaign](https://www.cloudcampaign.com/answers/social-report-frequency) | B |
| Listening frequency depends on the team: customer service and sales monitor continuously, consumer research listens in bursts around milestones | [SI Lab experts](https://www.thesilab.com/resource/how-frequently-should-you-run-social-listening-reports-four-experts-give-us-tips-for-better-social-listening-reporting) (opinion) | C |
| B2B SaaS daily-to-monthly active ratio (stickiness): typical 10–25%; periodic-use and reporting tools about 10–30%; collaboration tools 50–70% | [Saber](https://www.saber.app/glossary/dau-mau-ratio), [Monetizely](https://www.getmonetizely.com/articles/understanding-the-stickiness-ratio-a-key-metric-for-saas-success) | C |
| Median SaaS retention about 37% one week after first use, about 15% by week eight | [Mixpanel](https://mixpanel.com/blog/insights-from-saas-product-experts) (undated) | C |
| Free-to-paid conversion across 200 B2B products (January 2026): median 8%; 57% use a free trial; 62% of trials are 14 days; 20% require a card up front | [ChartMogul Conversion Report](https://chartmogul.com/reports/saas-conversion-report-2/) | A |
| Signup-to-paid funnels in that report: freemium about 5.6%, free trial about 8.9%, card-required trial about 31% (measured within 6 months, respondent estimates) | ChartMogul (same report) | A |
| Net revenue retention above 100% is far more common at higher prices: 2.7% of businesses with ARPA under $10 a month, against 41.1% with ARPA over $500 | [ChartMogul SaaS Retention Report, via summary](https://chartmogul.com/saas-retention-report/) | B (older) |
| Creator outreach reply rates (personalised): micro 15–25%, macro 5–10%, mega 2–5%; generic cold email 3–5% | [CreatorDB, citing InfluenceFlow](https://www.creatordb.app/blog/guides/the-ultimate-5-step-guide-to-contact-influencers); [Overloop](https://overloop.com/blog/benchmarks) | C |
| 65.9% of brands expect influencer payback within one month, 48% within two weeks | IMH 2026 | A |

**What to take from it.**
- **Bursty, not daily, is normal** for this category: expect low login frequency with report-driven spikes, and do not
  model most accounts as daily users.
- **Retention drops fast early** (roughly 37% at one week, 15% at eight), which fits a trial where most people never reach
  value.
- **Higher plans retain better**, which supports the plan's "NRR below 100% in Starter and Growth, above in Agency and
  Enterprise".
- **Short influencer payback expectations** mean campaigns are judged within weeks, so a campaign arc should be short.

## 4. The simulation plan checked against the evidence

| Plan claim | What the evidence says | Verdict | Suggested change |
|---|---|---|---|
| About 15–20% of trials convert | Median 8%; no-card trials about 6–9%; card-required about 30% | **Too high** for a no-card trial | Target 6–10% overall; rescale activated and non-activated to match (about 30% against 2% if a fifth of trials activate). Applied in `docs/simulation-plan.md` |
| Monthly report bursts for agencies | Monthly is the dominant client reporting cadence (46%) | Supported | Keep; weekly reporters a minority (about 14%) |
| Small and solo accounts exist | Most social teams are 0–2 people | Supported | Keep single-user and pair archetypes |
| Higher tiers expand, lower tiers shrink (NRR by tier) | NRR over 100% is far more common at high ARPA | Supported in direction | Keep; the exact rates stay design parameters |
| Outreach reply 5–15% (DM) and 15–30% (email) | Tiered: micro 15–25%, macro 5–10%, mega 2–5%; generic email 3–5% | Partly | Make reply probability depend on creator tier and personalisation |
| Influencer budgets under pressure (2025 survey) | 2026 survey: 87.5% expect increases | **Dated** | Make budget trend a per-account trait, not a global premise |
| Listening lands first, influencer expands (about 70/30) | No public attach-rate data; only an indirect Sprout proxy (as the plan itself says) | Unverified | Keep as a design parameter and label it so |
| Agencies are heavier users than brands | 30% of agencies versus 10% of brands say listening drives every decision | Supported | Weight agency use higher |
| Shelfware at 65% of licences, Sprout NRR path, Recurly churn split | Not rechecked in this pass | Unchecked | Verify before citing in a portfolio piece |

## 5. What this means for the build

- **Trial conversion:** lower the target to 6–10% when the simulation drives conversion.
- **Platform coverage:** decide whether the corpus should stay Instagram/TikTok-heavy, and if so show a visible coverage
  note, because incomplete data is the top real-world complaint (64.6%). Changing the mix itself needs a cascade rework
  (section 2.4).
- **Activity shape:** build low-frequency, spiky usage into the archetypes; reserve daily use for a small share of
  accounts (crisis-prone brands, customer-service-style monitoring).
- **Outreach:** drive creator replies from creator tier and message quality.
- **Reporting cadence:** most accounts monthly, some quarterly, a minority weekly.
- **Not yet built:** the plan's per-product billing and the hidden-driver ground-truth tables. This research does not
  change that recommendation or our storage limits.

## Gaps and how to close them

| Gap | Why it matters | How to close it |
|---|---|---|
| No role-level mix of listening users (analyst, comms, social, exec) | Sets how many seats of each persona to simulate | Get the full SI Lab and Meltwater 2026 reports (paywalled or gated); treat roles as design parameters meanwhile |
| No survey of how often teams log into listening tools | Sets daily versus weekly active mix | Ask vendors for benchmark data, or use your own agent runs once they exist |
| No creators-per-campaign figure | Sets campaign size and invitation volume | Collabstr's annual report or an IMH deep-dive, and label the figure as an assumption |
| No feature adoption or activation benchmarks for this category | Sets the activation definition | Treat as a hypothesis to test inside the simulation, as the plan proposes |
| The SI Lab 2025 report page was not reachable directly | Several figures are secondary | Request the report from SI Lab and replace summaries with the primary numbers |
| Platform API limits come from vendors who sell data access | Could overstate restrictions | Check each platform's current developer documentation |

## Sources

Primary or near-primary: [ChartMogul Conversion Report (Jan 2026)](https://chartmogul.com/reports/saas-conversion-report-2/),
[Influencer Marketing Hub 2026 benchmark](https://influencermarketinghub.com/influencer-marketing-benchmark-report/),
[Datashake 2026 Social Data Coverage Report](https://www.datashake.com/resources/social-data-coverage-report-2026),
[SI Lab State of Social Listening 2025](https://www.thesilab.com/state-of-social-listening),
[Meltwater 2026 Global State of Social Media](https://learn.meltwater.com/rs/814-WJU-189/images/2026%20Global%20State%20of%20Social%20Media%20Report.pdf?version=0).

Secondary or vendor: [Mixpanel](https://mixpanel.com/blog/insights-from-saas-product-experts),
[Saber](https://www.saber.app/glossary/dau-mau-ratio), [Monetizely](https://www.getmonetizely.com/articles/understanding-the-stickiness-ratio-a-key-metric-for-saas-success),
[CloudCampaign](https://www.cloudcampaign.com/answers/social-report-frequency),
[CreatorDB](https://www.creatordb.app/blog/guides/the-ultimate-5-step-guide-to-contact-influencers),
[Overloop](https://overloop.com/blog/benchmarks), [Syncly](https://syncly.app/blog/social-listening-historical-data-what-12-tools-mean-(2026)),
[Brand24](https://brand24.com/blog/social-listening-statistics/), [PR Daily](https://www.prdaily.com/report-marketers-turn-to-instagram-youtube-linkedin-and-more-for-social-listening/),
[MarTech Series (Talkwalker 2020)](https://martechseries.com/analytics/global-survey-reveals-85-pr-practitioners-missing-effective-pr-tools-techniques/),
[ChartMogul SaaS Retention Report](https://chartmogul.com/saas-retention-report/).
