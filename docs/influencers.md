# Influencers (Ripplewise Creators)

A second product that shares Ripplewise's login, workspaces, roles, plan, billing, analytics and design system. After sign-in, people land on the **product hub** (`/hub`): the screen splits in two, one half for Social listening and one for Influencers. Both halves are ordinary links, so the hub works with the keyboard and on a phone (where the halves stack). The last product used is remembered in a cookie and marked "Last used"; a product switcher in the top bar moves between them without going back to the hub.

All creators are synthetic: names, handles, bios and audiences are generated (`datagen/creators.ts`), and nothing is scraped.

## What is in the first milestone (I1)

| Area | What it does |
| --- | --- |
| Hub | Split-screen product chooser; workspace picker when someone belongs to several; client viewers skip it (they only see dashboards and reports). |
| Discovery (`/w/:ws/creators`) | Search by name, handle or topic. Filter by platform, audience size, niche, country, engagement, authenticity and brand safety. Sort, and page. Every filter lives in the URL. |
| Creator profile (`/creators/:id`) | Key numbers, authenticity and brand safety, and audience demographics (age, gender, country, interests) with a table twin for each chart. |
| Lists (`/creators/lists`) | Shortlists per workspace. Add from discovery or a profile (creating a list in the same step), remove, delete, export to CSV. |

## Campaigns (I2)

A campaign (`/w/:ws/creators/campaigns`) has a name, objective, brief, budget and dates, and a roster of creators. Creators come in from a creator list (everyone already on the campaign is left alone) and move through a pipeline, one allowed step at a time:

`Shortlisted → Invited → Negotiating → Confirmed → Content submitted → Content approved → Paid`, with `Declined` reachable before content is in (and reversible back to shortlisted). Content that needs changes goes back to `Confirmed` ("Request changes"). The rules live in `lib/creators/campaign-flow.ts`, are enforced by the server actions, and the interface only offers the moves that are allowed.

- **Fees and budget.** Confirming a creator needs an agreed fee. Confirmed and later creators count as committed against the budget; paid ones are shown separately. The budget is advisory: confirming past it is allowed, with a plain warning and an "Over budget by $X" state (never colour alone).
- **Lifecycle.** Draft → Active → Completed → Archived. Completed and archived campaigns are read-only; re-opening one takes a slot on the plan again.
- **Plans.** Draft and active campaigns count against the plan: 1 on Trial and Starter, 5 on Growth, 25 on Agency, 500 on Enterprise (`activeCampaigns`, paywall `campaign_limit`).
- **Roles.** Owners, admins and editors change campaigns; viewers read them.
- **Events and audit.** `Campaign Created`, `Campaign Status Changed`, `Campaign Creators Added`, `Campaign Creator Status Changed`, `Campaign Creator Removed`, plus audit-log entries.

## Plans

Defined once in `lib/entitlements/plans.ts`, enforced on the server, mirrored in the interface.

| | Trial | Starter | Growth | Agency | Enterprise |
| --- | --- | --- | --- | --- | --- |
| New creator profiles / month | 15 | 25 | 250 | 1,000 | 10,000 |
| Creator lists | 2 | 2 | 10 | 50 | 1,000 |
| Audience insights and follower quality | – | – | yes | yes | yes |
| List export (CSV) | – | – | yes | yes | yes |
| Active campaigns | 1 | 1 | 5 | 25 | 500 |

Opening a profile counts once per creator per month (`creator_profile_views`), so re-opening one is free. Past the limit, new profiles are blocked and the person sees what the allowance is and the plan that raises it; profiles already opened stay available. Four paywall placements were added: `creator_list_limit`, `creator_profile_quota`, `creator_audience` and `creator_export`. Each is dismissible with equal-weight "Not now".

Roles: owners, admins and editors change lists; viewers can browse and export; client viewers cannot open Influencers.

## Data

- `creators` (shared reference data, like the mention corpus): 50,000 creators, loaded by `npm run db:load` (or `npx tsx db/load-creators.ts --seed 42 --count 50000`). Reproducible for a given seed.
- `creator_lists`, `creator_list_items`, `creator_profile_views` (per workspace or account).
- About 9% of creators are generated with inflated audiences (28–62% likely fake followers, engagement well below what their size predicts), so authenticity filtering has something real to find.

## Analytics

New events in `docs/tracking-plan.json` (117 total): `Product Hub Viewed`, `Product Opened`, `Creator Search Run`, `Creator Profile Viewed`, `Creator List Created`, `Creator Added To List`, `Creator Removed From List`, `Creator List Exported`, and the five campaign events above. Paywalls reuse `Paywall Viewed`.

## Not yet built

Campaign tracking is manual: someone on the brand's team moves each creator along the pipeline. Still to build: real outreach (emails to creators and a creator-facing portal), contracts, content upload and review, tracking links with results, and payouts. Creator data is a snapshot; there is no refresh job. Comparing creators side by side, saved searches, and linking creators to the listening corpus (what people say about a creator's brand mentions) are natural follow-ups.
