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

## Plans

Defined once in `lib/entitlements/plans.ts`, enforced on the server, mirrored in the interface.

| | Trial | Starter | Growth | Agency | Enterprise |
| --- | --- | --- | --- | --- | --- |
| New creator profiles / month | 15 | 25 | 250 | 1,000 | 10,000 |
| Creator lists | 2 | 2 | 10 | 50 | 1,000 |
| Audience insights and follower quality | – | – | yes | yes | yes |
| List export (CSV) | – | – | yes | yes | yes |

Opening a profile counts once per creator per month (`creator_profile_views`), so re-opening one is free. Past the limit, new profiles are blocked and the person sees what the allowance is and the plan that raises it; profiles already opened stay available. Four paywall placements were added: `creator_list_limit`, `creator_profile_quota`, `creator_audience` and `creator_export`. Each is dismissible with equal-weight "Not now".

Roles: owners, admins and editors change lists; viewers can browse and export; client viewers cannot open Influencers.

## Data

- `creators` (shared reference data, like the mention corpus): 50,000 creators, loaded by `npm run db:load` (or `npx tsx db/load-creators.ts --seed 42 --count 50000`). Reproducible for a given seed.
- `creator_lists`, `creator_list_items`, `creator_profile_views` (per workspace or account).
- About 9% of creators are generated with inflated audiences (28–62% likely fake followers, engagement well below what their size predicts), so authenticity filtering has something real to find.

## Analytics

New events in `docs/tracking-plan.json` (112 total): `Product Hub Viewed`, `Product Opened`, `Creator Search Run`, `Creator Profile Viewed`, `Creator List Created`, `Creator Added To List`, `Creator Removed From List`, `Creator List Exported`. Paywalls reuse `Paywall Viewed`.

## Not yet built

Outreach, briefs, contracts, content approval, tracking links and payments (the campaign lifecycle) are the next milestone and will build on lists. Creator data is a snapshot; there is no refresh job. Comparing creators side by side, saved searches, and linking creators to the listening corpus (what people say about a creator's brand mentions) are natural follow-ups.
