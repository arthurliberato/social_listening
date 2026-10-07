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

## Outreach and the creator page (I3)

Creators don't have accounts. A brand invites a creator from the campaign roster, and the creator answers from their own page, reached with a link and nothing else.

**The brand's side** (on a creator's row in the campaign):
1. *Send invitation*: an offer per post, and a message (pre-filled, editable). The creator gets an email (`type: outreach`, addressed to a creator address; it's stored in `emails` and delivered to Mailpit when `SMTP_URL` is set) with the link. The row also shows the link so it can be copied and sent another way.
2. *Follow the answer*: invitation sent, opened, accepted, declined, countered, or expired. The brand gets an email for each answer.
3. *Settle a counter-offer*: accept it, send a revised offer (which replaces the old invitation and its link), or decline.
4. *Review content*: approve, or request changes with feedback the creator can read.
5. *Mark paid* (as before) tells the creator by email.

**The creator's page** (`/creator/:token`, no login, `noindex`): the campaign's brief, dates and goal, the offer, and what's due. They can accept, decline (a second confirming step), or suggest a different fee with a note; after accepting they submit a link to their post and a caption, see feedback if changes were requested, resubmit, and see "approved" and "paid". It never shows the budget, the other creators or the brand's notes.

**Rules** (`lib/creators/outreach-flow.ts`, tested): an invitation is open for 14 days of simulated time; it can be answered once (a double-click or a second tab is a no-op, enforced by a conditional update, not just the interface); a counter must be a whole-dollar amount different from the offer; content must be a real http(s) link; asking for changes needs feedback. Links are 48 random hex characters. A superseded or withdrawn invitation says so rather than failing. A made-up link gets the same "can't find that page" as an expired record, so it reveals nothing.

**Plan allowance**: invitations per month (each new or revised offer counts): 5 on Trial, 10 Starter, 200 Growth, 1,000 Agency, 10,000 Enterprise. Past it, the brand sees a paywall (`outreach_quota`) and nothing is sent.

**Events**: `Creator Invitation Sent`, `Creator Portal Viewed` (first open only), `Creator Invitation Answered`, `Creator Counter Resolved`, `Creator Content Submitted`, `Creator Content Reviewed`. Creator-side events carry the workspace and account but no member id, since creators aren't users: they have `actor_type: creator` and appear in Amplitude as `creator_<id>`. Every event also carries `product`. See `docs/analytics.md`.

## Tracking links and results (I4)

Every confirmed creator gets one tracking link per campaign: `/r/<code>`, ten characters from a 31-symbol alphabet (no look-alikes), unguessable. It records the visit and redirects to the campaign's landing page with the creator and campaign added to the address (`utm_source`, `utm_medium=influencer`, `utm_campaign`, plus `rw_cid`, the click id). The brand's own tags always win. Creators see their link on their own page as soon as they're confirmed and the brand has set a landing page; the brand sees all links on the results page.

**Setting up** (`/w/:ws/creators/campaigns/:id/results`): the brand sets the landing page (a real http/https address, no credentials in it). That also creates links for creators already confirmed, and creates the campaign's secret conversion key.

**Clicks.** A visit stores a salted hash of address and browser (not reversible, and different each day), never the address itself. A person counts once per link per day as a *unique visitor*. Crawlers and link previewers are redirected like anyone else but are flagged and left out of every number. A browser driven by an automated agent still counts as a visitor. Links on a completed campaign keep working, so a creator's old posts don't break; archived ones show "This link isn't active".

**Conversions.** The brand's own server reports a result with `GET` or `POST /api/t/conversion?cid=<rw_cid>&key=<campaign key>&value=<dollars>&ref=<order id>`. It needs the secret key (compared in constant time), a real click made in the last 30 days, and a non-crawler click; the same order reference is counted once; without a reference, one conversion per click. An unknown click and a wrong key look identical (401), so the endpoint can't be used to discover click ids.

**Results.** Clicks, unique visitors, conversions, revenue, spend (the agreed fees of confirmed creators), cost per click, cost per conversion, return on spend, and the conversion rate (conversions per unique visitor), overall and for each creator, plus a daily chart of clicks and conversions with a table alternative. Anything that can't be worked out (cost per conversion with no conversions) shows a dash, never zero or infinity. The arithmetic is in `lib/creators/tracking-flow.ts` and is tested.

**Plan:** tracking and results are on Growth and above (`campaignResults`, paywall `campaign_results`); links stay live if an account later downgrades, only the results page locks. Viewers can read results but not the setup or the key.

**Events:** `Campaign Destination Set`, `Tracking Link Created`, `Tracking Link Clicked` and `Campaign Conversion Recorded` (the last two have an anonymous audience actor and belong to Influencers), and `Campaign Results Viewed`.

## Plans

Defined once in `lib/entitlements/plans.ts`, enforced on the server, mirrored in the interface.

| | Trial | Starter | Growth | Agency | Enterprise |
| --- | --- | --- | --- | --- | --- |
| New creator profiles / month | 15 | 25 | 250 | 1,000 | 10,000 |
| Creator lists | 2 | 2 | 10 | 50 | 1,000 |
| Audience insights and follower quality | – | – | yes | yes | yes |
| List export (CSV) | – | – | yes | yes | yes |
| Active campaigns | 1 | 1 | 5 | 25 | 500 |
| Creator invitations / month | 5 | 10 | 200 | 1,000 | 10,000 |
| Tracking links and results | – | – | yes | yes | yes |

Opening a profile counts once per creator per month (`creator_profile_views`), so re-opening one is free. Past the limit, new profiles are blocked and the person sees what the allowance is and the plan that raises it; profiles already opened stay available. Four paywall placements were added: `creator_list_limit`, `creator_profile_quota`, `creator_audience` and `creator_export`. Each is dismissible with equal-weight "Not now".

Roles: owners, admins and editors change lists; viewers can browse and export; client viewers cannot open Influencers.

## Data

- `creators` (shared reference data, like the mention corpus): 50,000 creators, loaded by `npm run db:load` (or `npx tsx db/load-creators.ts --seed 42 --count 50000`). Reproducible for a given seed.
- `creator_lists`, `creator_list_items`, `creator_profile_views` (per workspace or account).
- About 9% of creators are generated with inflated audiences (28–62% likely fake followers, engagement well below what their size predicts), so authenticity filtering has something real to find.

## Analytics

New events in `docs/tracking-plan.json` (128 total): `Product Hub Viewed`, `Product Opened` (`target_product` says which), `Creator Search Run`, `Creator Profile Viewed`, `Creator List Created`, `Creator Added To List`, `Creator Removed From List`, `Creator List Exported`, the five campaign events, the six outreach events and the five tracking events above. Paywalls reuse `Paywall Viewed`.

## Not yet built

Creator emails are simulated (stored, and sent to Mailpit when configured); there's no real delivery, and no reminder emails for an invitation about to expire. Content is a link to a post, not an uploaded file. Still to build: contracts, real payouts (payment is marked by the brand), and anything that estimates reach or earned media value (results are measured visits and conversions only). Creator data is a snapshot; there is no refresh job. Comparing creators side by side, saved searches, and linking creators to the listening corpus (what people say about a creator's brand mentions) are natural follow-ups.
