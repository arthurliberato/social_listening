# User types, the influencer question, and plans (current state)

Read from the code in this repository (Ripplewise), so these are the **current definitions**, not a proposal. Two of the
three questions below rest on something that does not exist yet, and that is stated where it applies. All pricing is
simulated test-mode billing for a fictitious product, so the numbers are placeholders chosen for the demo.

## 1. User-type definitions today

There is no single "user type" field. These layers exist, in different places.

### a) Workspace roles (`lib/permissions.ts`, enforced server-side)

Use these as the permission taxonomy.

| Role | What it can do | Uses a seat? |
|---|---|---|
| `owner` | Everything, including billing. A workspace always has at least one. | Yes |
| `admin` | People, workspaces, billing, audit, branding, plus everything an editor does | Yes |
| `editor` | Create and edit queries, dashboards, reports, alerts | Yes |
| `viewer` | Read everything and export; changes nothing | Yes |
| `client_viewer` | Dashboards, reports and Help only, with the agency's branding | **No** |

### b) Self-declared job role (`users.role_selected`)

Chosen in onboarding step 1 and used for analytics segmentation only.

| Id | Title | Blurb |
|---|---|---|
| `analyst` | Insights analyst | Build precise queries and defensible numbers |
| `social` | Social media manager | Track campaigns, find creators, respond fast |
| `comms` | Comms / PR lead | Catch reputational spikes and brief executives |
| `agency` | Agency account lead | Run listening for several clients |
| `exec` | Executive | See what matters this week |
| `admin` | Admin / operations | Seats, billing and security |

### c) Stated goals (`users.goals`, multi-select)

Monitor my brand, benchmark competitors, measure a campaign, detect and handle crises, research a topic or market.

### d) Account-level fields (`accounts`)

- `account_type`: `brand` or `agency`.
- `motion`: `self_serve` or `sales_assisted`. Set to `sales_assisted` when a contract is signed.
- `company_size_band`: an integer.

`account_type` and `company_size_band` exist as columns but **nothing in the UI sets them**, so they are always the
defaults today.

### e) Agent personas (for the synthetic users)

`persona_archetype` is `<role>_<seniority>`.

- Roles: `division_leader`, `account_exec`, `strategist`, `analyst`.
- Seniorities: `lead`, `senior`, `mid`, `junior`.
- They map onto the workspace roles above: the leader is `owner`, the others are `editor`. Seniority is not a product
  concept; it lives only in the agent profile.

## 2. What the influencer product does

**There is no influencer product in this repository.** The closest things, all inside the listening product:

- **Authors page and profiles:** ranking by reach, mentions or negative mentions; each author's recent posts; a
  **watchlist**.
- **A "high-reach author" alert type** (`influencer`): fires when a big account joins the conversation.
- **The "find creators" blurb** on the social media manager role in onboarding: wording only.

Discovery is limited to authors who already appear in your mentions. There is no search across the wider creator
universe, no outreach, no CRM or contact records, and no campaign tracking beyond ordinary dashboards and reports.
So it does not do discovery, outreach, campaigns or all of them as a separate product.

## 3. How plans are structured

One product, five tiers. `lib/entitlements/plans.ts` is the single source of truth. **There is no bundle with an
influencer tool.**

| Tier | $/month | Active queries | Mentions/month | Seats | Workspaces | History | Refresh | Alerts | Ask AI/month |
|---|---|---|---|---|---|---|---|---|---|
| Trial (14 days + 3-day grace) | 0 | 3 | 5,000 | 2 | 1 | 30 d | hourly | 2 | 10 |
| Starter | 79 | 3 | 10,000 | 1 | 1 | 30 d | 12 h | 3 | 10 |
| Growth | 249 | 10 | 50,000 | 5 | 1 | 365 d | hourly | 20 | 100 |
| Agency | 599 | 30 | 200,000 | 15 | 10 | 730 d | real-time | 100 | 500 |
| Enterprise | quoted | 50 | 1,000,000 | 50 | 1,000 | 1,825 d | real-time | 10,000 | 5,000 |

**Feature gates**

- Sentiment alerts, crisis rooms, scheduled reports, share of voice, the emotion widget and public share links start at
  **Growth**.
- White label starts at **Agency**.
- SSO, audit log, API and logo recognition are **Enterprise-only** (the API flag exists but nothing implements it).

**Billing rules**

- Yearly billing is 10 months for 12.
- A retention offer of 25% off two renewals is shown at most once.
- Failed payments retry at 1, 3 and 5 days.
- One add-on exists: a **history pack**, a one-time $49 for another year of history on one query.

**Enterprise quotes** (simulated sales desk): a $1,500/month platform fee plus $40 per seat per month, minimum 5 seats,
with a 10%, 15% or 20% discount for 12, 24 or 36-month terms.

**Not set**

- Bundle pricing.
- Influencer-tool seats or limits.
- Per-seat pricing on the self-serve tiers.

If you want these benchmarked against real players, that is the open decision.

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
| Agent personas | `agents/profile.ts`, `docs/agents.md` |
