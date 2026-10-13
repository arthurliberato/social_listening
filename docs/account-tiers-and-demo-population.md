# Account tiers and the demo population (current state)

Read from the code in this repository (Ripplewise) and from a full build of the demo population, so these are the
**current definitions and measured results**, not a proposal. Written 2026-10-12. All accounts, people and data are
synthetic, and billing is simulated test mode.

The point of the population is to give analysis **different behavior to compare**: for example accounts on the top plan
that barely use it, next to accounts on the cheapest plan that hit every limit.

## 1. What a tier is here

A tier is a **seeding profile**: a plan, a team size, and how much the account has already used. It is not a product
concept. The product's own tiers are the plans in `lib/entitlements/plans.ts` (see `docs/user-types-and-plans.md`).

Each profile is created through the product's own sign-up, invite, subscription and backfill code, then given queries on
the corpus. Nothing is written around the product's rules.

| Profile | Plan | Users | Queries | Intended behavior |
|---|---|---|---|---|
| `starter-limit` | Starter ($79) | 1 | 3 of 3 slots: one brand query and two broad ones | At its limits |
| `growth` | Growth ($249) | 3 to 5 | 4 to 8 brand queries | Typical use |
| `agency-low` | Agency ($599) | 2 to 4 | 1 to 2 brand queries | Low use on the top self-serve plan |

"Max plan" here means Agency, the largest plan a customer can check out on. Enterprise (sales-quoted) is not in the mix.

## 2. The plan limits each profile runs against

| | Starter | Growth | Agency |
|---|---|---|---|
| Seats | 1 | 5 | 15 |
| Active queries | 3 | 10 | 30 |
| Mentions per month | 10,000 | 50,000 | 200,000 |
| History window | 30 days | 365 days | 730 days |
| Alerts / Ask AI per month | 3 / 10 | 20 / 100 | 100 / 500 |

The monthly mention allowance is what "topping the limit" means for queries: backfill collects newest mentions first and
stops when the account's allowance runs out.

## 3. The recommended mix and what it measured

Seeded with `--mix starter-limit:50,growth:25,agency-low:15` on the small demo corpus (about 392,000 mentions). Measured
on Postgres 16:

| Profile | Accounts | Users | Queries (avg) | Mentions collected (avg) | Against its allowance |
|---|---|---|---|---|---|
| `starter-limit` | 50 | 50 | 3.0 | 10,000 | **All 50 at the cap (100%)**; 3 of 3 query slots used |
| `growth` | 25 | about 100 | 5.9 | 17,200 (max 24,200) | about 34% on average (max about 48%) |
| `agency-low` | 15 | about 45 | 1.4 | 7,400 (max 14,600) | about 4% on average (max about 7%) |
| **Total** | **90** | **198** | | | |

How the Starter accounts reach the cap: two of their three queries are broad (common words such as "this", "the",
"for"). Each matches more than half of the roughly 9,400 mentions in a 30-day window (about 5,200 and 5,800), and
results are counted once per query, so together they pass the 10,000 allowance and collection stops. A brand query
alone would not get there on a corpus this small.

## 4. What the data looks like to an analyst

Each seeded user carries `account_profile` and `usage_profile` in the manifest (`agents-demo.json`):

| `usage_profile` | `account_profile` | Segment |
|---|---|---|
| `at_limits` | `starter-limit` | Lowest plan, quota exhausted, every query slot used |
| `typical` | `growth` | Middle plan, working inside its limits |
| `low` | `agency-low` | Highest self-serve plan, mostly unused |

The product events that matter for these segments are in `docs/tracking-plan.json`, among them `Quota Threshold
Reached`, `Paywall Viewed`, `Upgrade Started`, `Plan Upgraded`, `Plan Downgraded`, `Cancellation Started` and
`Subscription Canceled`. Every event carries `account_id`, `plan_tier` and the persona, so the segments can be cut in
BigQuery once events are flowing.

## 5. What is and is not simulated

**Set up at seed time:** the account, its users and roles, the paid subscription, the queries, and the collected history
(so the quota is already used).

**Not simulated at seed time:** Ask AI use, alerts, scheduled reports, how often people sign in, upgrades, downgrades
and cancellations. These are meant to come from agents acting over time. The seeder does not fire the product events
above; they happen when someone uses the product.

**Starter accounts reach their cap but do not yet show an upgrade decision.** Nothing makes them upgrade; that is
behavior to add.

## Left in on purpose: Starter owners are stuck in onboarding

`seed:demo` does not mark owners as onboarded, so every owner starts at the first-run wizard. For the 50 `starter-limit`
accounts that is a dead end: all three query slots are already used, step 4 ("Here's your first query") tries to create a
fourth, the plan blocks it ("Your Starter plan includes 3 active queries"), and that step has no skip. Those users cannot
reach the rest of the app. This is kept deliberately as behavior to analyse (a funnel drop at step 4 for accounts at their
limit), and it points at a product question: should the wizard offer a way out when the plan limit is already reached?

- **Growth and agency-low owners are not stuck.** They have free query slots, so they can finish the wizard by entering
  any brand that exists in the corpus, for example "Juniper Roast".
- **To clear the dead end for a demo:** run this in the database, or add `--onboard-owner` to the `seed:demo` script and
  reseed.

  ```
  update users set onboarding_completed_at = now(), role_selected = coalesce(role_selected, 'agency')
  where email like 'demo.%@agents.example.test';
  ```

## 6. How much space it needs

Total database after setup: **about 455 MB** (Neon free plan limit: 1 GB).

| Part | Size |
|---|---|
| Corpus: mentions, authors, stories | about 230 MB |
| Creators (10,000) | about 13 MB |
| Saved-query results for the 90 accounts | about 206 MB (Starter 99 MB, Growth 85 MB, Agency 22 MB) |
| Everything else (users, subscriptions, events) | a few MB |

Each saved query stores one row (about 200 bytes) per matching mention, so the Starter accounts, each at the cap, cost
about 2 MB apiece. A Growth account that filled its whole allowance would cost about 10 MB and an Agency account about
41 MB, so a population with many such accounts needs a larger database. The history pack add-on is capped at 10,000
older mentions (about 2 MB) per purchase.

## 7. Open decisions

- **Enterprise** is not represented. Add it only if you want to study sales-assisted accounts.
- **The mix ratios** (50, 25 and 15 accounts) are a starting point, not a requirement; `--mix` takes any counts.
- **Behavior over time** (Ask AI, alerts, sign-ins, upgrade and cancel decisions) is not built; it needs the
  orchestrator for the autonomous agents.
- **Seeded users per account are a design choice**, not data from real customers: one user on Starter, two to four on
  Agency, three to five on Growth.

## Where to look in the code

| Topic | File |
|---|---|
| Tier profiles and seeding | `lib/sim/seed-agents.ts` (`TIER_PROFILES`, `BROAD_QUERIES`), `scripts/seed-agents.ts` |
| Plans and limits | `lib/entitlements/plans.ts` |
| Backfill and the monthly allowance | `jobs/backfill.ts` |
| Build and setup commands | `package.json` (`demo:setup`), `docs/demo-deployment.md` |
| Event definitions | `docs/tracking-plan.json` |
| User types and plans | `docs/user-types-and-plans.md` |
