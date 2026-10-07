# Ripplewise: product notes

Ripplewise is a fictitious social listening product for brand, communications and agency teams. It watches public conversation about a brand, tells the team when something is happening, and helps them explain it to the people who need to know. All data is synthetic (4M generated mentions across 40 fictitious brands); nothing is scraped.

This page is the product thinking behind the build: who it is for, the decisions that shape it, how it measures itself, and what is honestly unfinished. Screens are in [`docs/screenshots`](screenshots) (light and dark), and [`docs/tour.md`](tour.md) is a 20-minute walkthrough of the running product.

## The job

A comms lead needs to answer three questions, quickly and with evidence: *what are people saying, is it getting worse, and what do I tell my boss or client?* Social listening tools usually fail the first one by drowning people in noise (job ads, spam, namesakes), and the third one by stopping at a dashboard. So the product is organised around three moments:

1. **Set up without noise.** Onboarding creates a first query from the brand, with a built-in exclusion for the usual job-ad noise, and shows an estimate before anything is saved. The query builder has a live preview and a noise score.
2. **Notice.** Alerts compare the last hour with the account's own normal, so a quiet brand and a loud one both get useful thresholds. A fired alert opens a crisis room.
3. **Explain.** Dashboards, scheduled reports, cited AI answers and stakeholder updates turn what was found into something a person can send.

## Decisions worth defending

**One definition of "visible mentions", everywhere.** The feed, dashboards, alerts, reports, Topics and Authors all read the same filtered set (non-spam, with the user's sentiment corrections applied). A count on a dashboard equals the count after you click through to Mentions, and tests check this. People stop trusting a tool the first time two screens disagree.

**Ground truth never reaches the product.** The generated data knows which mentions are spam and what the sentiment really is. The product only sees what a real classifier would: a predicted sentiment, and spam heuristics it can explain ("153 likely-spam mentions hidden, show"). Hiding spam is the default; showing it is one click, so nothing is silently dropped.

**AI that has to show its work.** Ask AI answers only if it can cite at least three real mentions, and every `[n]` links to the mention behind it. If it cannot, or the provider fails, the answer is withheld and the question is not counted against the monthly allowance. The provider here is a clearly labelled simulation (it only restates the mentions it is given) behind a one-method interface, so a real model can replace it without touching the rules.

**Alerts that don't cry wolf.** A rule needs both a multiple of the usual hourly volume *and* a minimum volume, repeats are held back by a cooldown, and building a rule shows how often it would have fired over the past 30 days. An injected crisis must trip a real-time plan's alert within one 5-minute release cycle; a slower plan sees the same crisis later, never earlier. Both are acceptance tests.

**Limits are part of the product, not an afterthought.** Plans are defined once and enforced on the server and reflected in the interface (locks, tooltips, 15 paywall placements). No dark patterns by rule: cancelling is reachable from Billing in three steps or fewer, the retention offer is shown at most once, nothing is pre-ticked, and "Not now" carries equal weight to "Upgrade". When an account lapses it becomes read-only, not hidden.

**Roles are a matrix, and it is tested.** Owner, Admin, Editor, Viewer and Client viewer, with client viewers free (they see dashboards and reports only, under the customer's branding on higher plans). An audit log records who changed queries, dashboards, reports, alerts, people, plans and sharing, and is an Enterprise feature that records from day one so the history is there when someone upgrades.

**Every screen has all its states.** Loading, empty, error and permission states exist for each screen, and charts have a table twin. Accessibility targets WCAG 2.2 AA: 24px targets, visible focus, keyboard alternatives for drag, reduced-motion support, and automated checks in light and dark.

## How the product measures itself

The short version is below; [`docs/analytics.md`](analytics.md) has the design, the queries it supports, and what is not yet verified.

- **A tracking plan as the source of truth** (`docs/tracking-plan.json`, 138 events, named for a SaaS product rather than a shop). Events are generated into typed code, so an unknown event fails the build, and every event carries the same global properties (account, workspace, plan, trial day, role, theme and so on), plus the product it belongs to and whether the actor is a member or a creator.
- **A funnel from lead to product.** Lead events go to GA4; everything goes to Amplitude and a warehouse mirror; sign-up stores the attribution fields on the user so a lead can be joined to what they did in the product. Names and emails never go to analytics.
- **Product-qualified accounts.** A nightly job scores each account for sales readiness (breadth of use, seats, quota pressure, repeated paywalls) and for health (recency, breadth, people active, risk). A score of 60 or more shows the account owner a dismissible "talk to us" card and sends one email to sales. Admins can see their own account's health and the reasons.
- **Experimentation.** Hash-based flags give each person a stable variant; `Experiment Exposed` fires once per session when the variant is actually on screen. The first experiment tests the call-to-action wording on the sales card.

## What is simulated, and says so

Mention data, the AI provider, the Northstar ID sign-in provider, the payment processor (test mode), the sales team that replies to quote requests, and the sources ("Instagram (simulated)"). Each is labelled where a person would see it. The sign-in provider is also boxed in on purpose: it can only sign in accounts it created, because anyone can type any username into a fake provider.

## How it was checked

352 unit and database tests, 189 end-to-end tests in 18 files (each flow through the real interface, including role and plan boundaries), and automated accessibility scans in both themes. Beyond passing tests, the screenshots in this repo were reviewed by eye, and doing so found things the tests did not: chart axis labels running together on a week-long window, a sentiment donut whose legend crushed it, truncated tiles on Home, and a missing favicon. Those are fixed. Photographing the screens against a *real* crisis in the data, rather than an invented alert, is what surfaced the axis problem and made the crisis room worth showing at all.

## Known gaps

- Payments are a labelled test-mode simulation; there is no processor integration.
- Sessions end when a password changes, but there is no per-IP login limit (only per-account throttling).
- The audit log does not record reads, exports, AI questions or the small edits inside editors, by design.
- Some of the long end-to-end runs are slow in development mode, and I verified changes with targeted runs of the nearest specs rather than the full suite each time.
- The AI answers are extractive restatements, not generated prose. That is an honest limit of a simulation, and the interface would not change with a real model.
