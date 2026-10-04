# Billing and plans (M8)

## Shape

`lib/billing/*` is an internal **BillingService** behind the same small interface a Stripe integration would
implement (`BillingProvider.charge`; card capture would move to Stripe Elements). Only the simulated,
**test-mode** provider ships. Nothing real is ever charged and card numbers are never stored: only brand,
last four, expiry and a test behaviour flag.

| File | What it does |
| --- | --- |
| `pricing.ts` | Prices (yearly = 10 months), MRR, calendar periods, proration, the save offer |
| `cards.ts` | Card validation and the test numbers |
| `provider.ts` | The processor interface and the simulated provider |
| `service.ts` | subscribe, change plan (prorated), preview, cancel, resume, save offer |
| `lifecycle.ts` | `runBillingLifecycle(now)`: everything the clock drives |
| `usage.ts` | Meters for every limit, and "what blocks a downgrade" |
| `paywalls.ts` | Registry of every paywall placement |

## Test cards

| Number | Behaviour |
| --- | --- |
| 4242 4242 4242 4242 | Always succeeds |
| 4000 0000 0000 0341 | Saves, then every **renewal and retry** fails (to exercise dunning) |
| 4000 0000 0000 0002 | Declined when you try to save it |

Any future expiry, 3-digit code and name.

## Account states

`trialing → grace (3 days, full access) → locked`, and `active ⇄ past_due → locked`, `active → canceled`.

* **Locked and canceled are read-only.** `requireWorkspace()` drops the effective role to `viewer`, so every
  server action's edit-role check refuses writes and every screen hides its edit controls. Collection
  (release job), alerts and scheduled reports stop. Viewing and exporting still work.
* A plan change updates `accounts.plan_tier` in one place; entitlements are read per request, so they follow
  instantly. Alert rule types and scheduled reports the plan no longer includes stop immediately.

## The clock

`runBillingLifecycle(now, only?)` is what the worker runs every 5 minutes (`now` defaults to the simulated
clock, `SIM_CLOCK_OFFSET_MS` fast-forwards it). Tests pass any `now` and scope to their own account.
A Postgres advisory lock stops overlapping runs from charging twice.

| When | What happens |
| --- | --- |
| 3 days and 1 day before trial end | Reminder email (once each) |
| Trial end | `grace`, email, `Trial Ended {converted:false}` |
| Trial end + 3 days | `locked`, email |
| Period end, not cancelled | Apply any scheduled downgrade (if it still fits), charge, receipt |
| Renewal charge fails | `past_due`, `Payment Failed`, dunning email; retries at +1, +3, +5 days |
| Fourth failure | `locked` (suspended), final email |
| Period end, cancelled | `canceled`, plan back to none, no charge |

Updating the card while `past_due` retries the payment immediately.

## Plan changes

* **Upgrade** (more per month): starts now, credits the unused part of what the current period actually
  cost, charges the difference, new period begins today.
* **Downgrade or yearly → monthly**: scheduled for the renewal. Refused up front, with a to-do list, if the
  account is over the smaller plan's limits (queries, alerts, seats incl. pending invites, workspaces).

## Cancellation

Billing → Cancel plan (1) → reason (2) → confirm (3). Access continues to the period end. A save offer
(25% off the next 2 renewals) is shown **at most once per account, ever**, on the confirm step, with a
"Keep my plan" button of equal weight. Resume is one click until the period ends.

## Events

Server: `Subscription Started`, `Plan Upgraded`, `Plan Downgraded`, `Payment Failed`, `Trial Ended`,
`Subscription Canceled`. Client: `Pricing Page Viewed`, `Plan Compare Toggled`, `Upgrade Started`,
`Cancellation Started`, `Cancellation Reason Submitted`, plus the existing `Paywall *` events.
