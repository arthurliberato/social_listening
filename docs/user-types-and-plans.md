# User types, the influencer product, and plans (current state)

Read from the code in this repository (Ripplewise), so these are the **current definitions**, not a proposal. Updated
2026-10-12; it replaces the earlier version, which predates the Influencers product. All pricing is simulated test-mode
billing for a fictitious product, so the numbers are placeholders chosen for the demo.

## 1. User-type definitions today

There is no single "user type" field. These layers exist, in different places.

### a) Workspace roles (`lib/permissions.ts`, enforced server-side)

Use these as the permission taxonomy. They apply to both products (Social listening and Influencers).

| Role            | What it can do                                                                | Uses a seat? |
| --------------- | ----------------------------------------------------------------------------- | ------------ |
| `owner`         | Everything, including billing. A workspace always has at least one.           | Yes          |
| `admin`         | People, workspaces, billing, audit, branding, plus everything an editor does  | Yes          |
| `editor`        | Create and edit queries, dashboards, reports, alerts, campaigns               | Yes          |
| `viewer`        | Read everything and export; changes nothing                                   | Yes          |
| `client_viewer` | Dashboards, reports and Help only, with the agency's branding                 | **No**       |

### b) Self-declared job role (`users.role_selected`)

Chosen in onboarding step 1 and used for analytics segmentation only.

| Id        | Title                 | Blurb                                         |
| --------- | --------------------- | --------------------------------------------- |
| `analyst` | Insights analyst      | Build precise queries and defensible numbers  |
| `social`  | Social media manager  | Track campaigns, find creators, respond fast  |
| `comms`   | Comms / PR lead       | Catch reputational spikes and brief executives |
| `agency`  | Agency account lead   | Run listening for several clients             |
| `exec`    | Executive             | See what matters this week                    |
| `admin`   | Admin / operations    | Seats, billing and security                   |

### c) Stated goals (`users.goals`, multi-select)

Monitor my brand, benchmark competitors, measure a campaign, detect and handle crises, research a topic or market.

### d) Account-level fields (`accounts`)

- `account_type`: `brand` or `agency`.
- `motion`: `self_serve` or `sales_assisted`. Set to `sales_assisted` when a contract is signed.
- `company_size_band`: an integer.

`account_type` and `company_size_band` exist as columns but **nothing in the UI sets them**, so they are always the
defaults today.

### e) Creators (not users)

Creators in the Influencers product **have no accounts and no login**. They are synthetic records in a directory
(`datagen/creators.ts`). A brand invites one from a campaign, and the creator answers from a personal link
(`/creator/:token`, no sign-in). Their events carry a creator actor, and visitors who click a tracking link are an
anonymous audience actor. Neither counts as a seat.

### f) Agent personas (for the synthetic users)

`persona_archetype` is `<role>_<seniority>`.

- Roles: `division_leader`, `account_exec`, `strategist`, `analyst`.
- Seniorities: `lead`, `senior`, `mid`, `junior`.
- They map onto the workspace roles above: the leader is `owner`, the others are `editor`. Seniority is not a product
  concept; it lives only in the agent profile.

## 2. What the influencer product does

There **is** an Influencers product (Ripplewise Creators). It shares the login, workspaces, roles, plan, billing and
analytics with Social listening, and people choose between the two on a hub page (`/hub`) after sign-in. Client viewers
skip the hub. Full detail is in `docs/influencers.md`; in short:

| Area | What it does |
| --- | --- |
| Discovery (`/w/:ws/creators`) | Search and filter a synthetic creator directory by platform, audience size, niche, country, engagement, authenticity and brand safety; every filter lives in the URL. |
| Creator profile | Key numbers, authenticity, brand safety and audience demographics, each chart with a table twin. |
| Lists | Shortlists per workspace, with CSV export (Growth and above). |
| Campaigns | Name, objective, brief, budget, dates and a roster that moves through a pipeline from shortlisted to paid. |
| Outreach | Invitations by email, a creator page to accept, decline or counter, reminders, content submission and review. |
| Tracking and results | One tracking link per confirmed creator, clicks, conversions, revenue, cost per click, return on spend (Growth and above). |
| Agreements and payouts | Creator contracts (Growth and above) and simulated payouts (Agency and above); nothing moves real money. |
| Saved searches and comparison | Saved discovery filters and side-by-side creator comparison. |

Social listening still has its own influence features, separate from the product above: the Authors page (ranking by
reach, mentions or negative mentions, with a watchlist) and a "high-reach author" alert type (`influencer`).

**What it does not do:** discovery covers only the synthetic directory (nothing is scraped from real platforms), money
movement is simulated, and creators cannot log in.

## 3. How plans are structured

One account, five tiers, covering both products. `lib/entitlements/plans.ts` is the single source of truth. **There is
no separate Influencers plan and no bundle price**; the creator limits sit inside the same tiers.

### Listening limits

| Tier | $/month | Active queries | Mentions/month | Seats | Workspaces | History | Refresh | Alerts | Ask AI/month |
|---|---|---|---|---|---|---|---|---|---|
| Trial (14 days + 3-day grace) | 0 | 3 | 5,000 | 2 | 1 | 30 d | hourly | 2 | 10 |
| Starter | 79 | 3 | 10,000 | 1 | 1 | 30 d | 12 h | 3 | 10 |
| Growth | 249 | 10 | 50,000 | 5 | 1 | 365 d | hourly | 20 | 100 |
| Agency | 599 | 30 | 200,000 | 15 | 10 | 730 d | real-time | 100 | 500 |
| Enterprise | quoted | 50 | 1,000,000 | 50 | 1,000 | 1,825 d | real-time | 10,000 | 5,000 |

### Influencers limits

| Tier | New creator profiles/month | Creator lists | Active campaigns | Invitations/month | Saved searches | Compare size |
|---|---|---|---|---|---|---|
| Trial | 15 | 2 | 1 | 5 | 3 | 2 |
| Starter | 25 | 2 | 1 | 10 | 3 | 2 |
| Growth | 250 | 10 | 5 | 200 | 25 | 4 |
| Agency | 1,000 | 50 | 25 | 1,000 | 100 | 6 |
| Enterprise | 10,000 | 1,000 | 500 | 10,000 | 1,000 | 6 |

Draft and active campaigns count against the plan; completed and archived ones do not.

### Feature gates

| Starts at | Features |
|---|---|
| **Growth** | Sentiment alerts, crisis room, scheduled reports, share of voice, emotion widget, public share links; creator audience data, creator CSV export, campaign tracking and results, creator contracts |
| **Agency** | White label; creator payouts (simulated) |
| **Enterprise** | SSO, audit log, API, logo recognition |

Trial and Starter have none of the gated features. The API flag exists but nothing implements it.

### Billing rules

- Yearly billing is 10 months for 12.
- A retention offer of 25% off two renewals is shown at most once.
- Failed payments retry at 1, 3 and 5 days.
- One add-on exists: a **history pack**, a one-time $49 for another year of history on one query (up to 10,000
  mentions), kept outside the monthly mention allowance.

**Enterprise quotes** (simulated sales desk): a $1,500/month platform fee plus $40 per seat per month, minimum 5 seats,
with a 10%, 15% or 20% discount for 12, 24 or 36-month terms.

**Not set**

- Bundle pricing across the two products.
- Per-seat pricing on the self-serve tiers.

If you want these benchmarked against real players, that is the open decision.

## 4. Synthetic accounts (test population)

Accounts for the autonomous agents are created through the product's own sign-up, invite and billing code
(`npm run seed:agents`, `lib/sim/seed-agents.ts`).

- Every seeded account is on one plan (default Agency, `--plan starter|growth|agency`) and has a team of 8–9 people by
  default. `--team-size 2` or `--team-size 2-4` makes smaller teams (an owner and an analyst first).
- A Starter account has one seat, so a larger seeded team would exceed its plan.
- **Open decision:** a mix of account tiers with different usage (for example Agency accounts with low use, and Starter
  accounts that reach their limits). It is not built; the seeder gives every account the same plan today.

## Where to look in the code

| Topic | File |
|---|---|
| Roles and permission matrix | `lib/permissions.ts` |
| Onboarding roles and goals | `app/onboarding/Wizard.tsx` |
| Account fields | `db/app-schema.ts` (`accounts`, `users`) |
| Plans and limits | `lib/entitlements/plans.ts` |
| Prices, yearly rule, trial, save offer | `lib/billing/pricing.ts` |
| Enterprise quote formula | `lib/sales/pricing.ts` |
| History pack | `lib/billing/history-pack.ts`, `docs/billing.md` |
| Influencers product | `docs/influencers.md`, `lib/creators/`, `app/w/[ws]/creators/` |
| Synthetic creators | `datagen/creators.ts` |
| Agent personas and seeding | `agents/profile.ts`, `lib/sim/seed-agents.ts`, `docs/agents.md` |
