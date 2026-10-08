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
2. *Follow the answer*: invitation sent, opened, accepted, declined, countered, or expired. The brand gets an email for each answer.  A creator who has not answered is reminded once by email, three days before the invitation lapses (a job every 30 minutes; one reminder per invitation, none for answered, expired or archived-campaign invitations).
3. *Settle a counter-offer*: accept it, send a revised offer (which replaces the old invitation and its link), or decline.
4. *Review content*: approve, or request changes with feedback the creator can read.
5. *Mark paid* (as before) tells the creator by email.

**The creator's page** (`/creator/:token`, no login, `noindex`): the campaign's brief, dates and goal, the offer, and what's due. They can accept, decline (a second confirming step), or suggest a different fee with a note; after accepting they submit a link to their post and a caption, see feedback if changes were requested, resubmit, and see "approved" and "paid". It never shows the budget, the other creators or the brand's notes.

**Rules** (`lib/creators/outreach-flow.ts`, tested): an invitation is open for 14 days of simulated time; it can be answered once (a double-click or a second tab is a no-op, enforced by a conditional update, not just the interface); a counter must be a whole-dollar amount different from the offer; content must be a real http(s) link; asking for changes needs feedback. Links are 48 random hex characters. A superseded or withdrawn invitation says so rather than failing. A made-up link gets the same "can't find that page" as an expired record, so it reveals nothing.

**Plan allowance**: invitations per month (each new or revised offer counts): 5 on Trial, 10 Starter, 200 Growth, 1,000 Agency, 10,000 Enterprise. Past it, the brand sees a paywall (`outreach_quota`) and nothing is sent.

**Events**: `Creator Invitation Sent`, `Creator Portal Viewed` (first open only), `Creator Invitation Answered`, `Creator Counter Resolved`, `Creator Content Submitted`, `Creator Content Reviewed`. Creator-side events carry the workspace and account but no member id, since creators aren't users: they have `actor_type: creator` and appear in RudderStack and BigQuery as `creator_<id>`. Every event also carries `product`. See `docs/analytics.md`.

## Tracking links and results (I4)

Every confirmed creator gets one tracking link per campaign: `/r/<code>`, ten characters from a 31-symbol alphabet (no look-alikes), unguessable. It records the visit and redirects to the campaign's landing page with the creator and campaign added to the address (`utm_source`, `utm_medium=influencer`, `utm_campaign`, plus `rw_cid`, the click id). The brand's own tags always win. Creators see their link on their own page as soon as they're confirmed and the brand has set a landing page; the brand sees all links on the results page.

**Setting up** (`/w/:ws/creators/campaigns/:id/results`): the brand sets the landing page (a real http/https address, no credentials in it). That also creates links for creators already confirmed, and creates the campaign's secret conversion key.

**Clicks.** A visit stores a salted hash of address and browser (not reversible, and different each day), never the address itself. A person counts once per link per day as a *unique visitor*. Crawlers and link previewers are redirected like anyone else but are flagged and left out of every number. A browser driven by an automated agent still counts as a visitor. Links on a completed campaign keep working, so a creator's old posts don't break; archived ones show "This link isn't active".

**Conversions.** The brand's own server reports a result with `GET` or `POST /api/t/conversion?cid=<rw_cid>&key=<campaign key>&value=<dollars>&ref=<order id>`. It needs the secret key (compared in constant time), a real click made in the last 30 days, and a non-crawler click; the same order reference is counted once; without a reference, one conversion per click. An unknown click and a wrong key look identical (401), so the endpoint can't be used to discover click ids.

**Results.** Clicks, unique visitors, conversions, revenue, spend (the agreed fees of confirmed creators), cost per click, cost per conversion, return on spend, and the conversion rate (conversions per unique visitor), overall and for each creator, plus a daily chart of clicks and conversions with a table alternative. Anything that can't be worked out (cost per conversion with no conversions) shows a dash, never zero or infinity. The arithmetic is in `lib/creators/tracking-flow.ts` and is tested.

**Plan:** tracking and results are on Growth and above (`campaignResults`, paywall `campaign_results`); links stay live if an account later downgrades, only the results page locks. Viewers can read results but not the setup or the key.

**Events:** `Campaign Destination Set`, `Tracking Link Created`, `Tracking Link Clicked` and `Campaign Conversion Recorded` (the last two have an anonymous audience actor and belong to Influencers), and `Campaign Results Viewed`.

## Agreements and payouts (I5)

**Agreements** (Growth and above). Once a creator is confirmed through Ripplewise, the brand can put the terms in writing: deliverables, how long the brand may reuse the content (own post only, 30, 90, 180 or 365 days), exclusivity, when payment is due after approval, an optional due date and any extra terms. The agreement is rendered once in plain words (fee included), stored word for word with a SHA-256 hash, and shown on the creator's own page. The creator signs by typing their name and ticking an explicit yes, or asks for changes with a note; the brand sees the note, revises, and the new version replaces the old (the history stays). A signed agreement can't be replaced, and what was signed can't change afterwards. Signing is a conditional update, so a double-click or a second tab is refused, not repeated. While an agreement is waiting on the creator (or on a revision), content can't be submitted and payment can't start; a brand that never sends one is not blocked (deals made elsewhere still work).

**Payouts** (Agency and above, simulated; nothing here moves real money). The creator adds where they want to be paid on their own page: name on the account, account number, country. **Only the last four digits and the holder's name are stored**; the number never reaches the database, the logs or analytics. Once the content is approved, any agreement is signed and details are on file, the brand starts a payout for the agreed fee (the panel says exactly what is still missing when it can't). The payout settles after two simulated days: the creator becomes *Paid*, both sides are told by email, and the budget meter's "paid" total follows. A settle job runs every five minutes, and a payout that has come due is also settled the moment either side loads the campaign, so what's on screen is true. Settling is a conditional claim, so it happens once however many callers race.

Test accounts, in the manner of a payment processor's test mode (also listed on the creator's form): `000123456789` works every time; `000999999991` saves fine, then every payout to it fails (to see a failed payout and the retry); `000999999992` can't be verified when saved. A failed payout tells both sides and leaves the creator *approved*, not paid; the brand retries once the creator has fixed their details (each retry is a numbered attempt). "Mark paid (outside Ripplewise)" stays for payments made elsewhere, and is hidden while a payout is on its way so nobody is paid twice.

**Events:** `Creator Contract Sent`, `Creator Contract Signed`, `Creator Contract Changes Requested`, `Creator Payout Details Saved` (no account data), `Creator Payout Initiated` (with the attempt number) and `Creator Payout Settled`. The creator-side events have `actor_type: creator`; settlement has **`actor_type: system`** because nobody did it, the clock did, so it isn't attributed to whoever happened to load the page.

## Saved searches and comparison (I6)

**Saved searches.** On the discovery page, the filters in use can be saved under a name and opened again with one click. What is stored is the *canonical* query string, rebuilt from the parsed filters, so only valid filters ever reach the database, the page number is forgotten (a saved search starts on page one), and the same search always looks the same. A search with no filters can't be saved (it would just be the whole directory). Names are unique within a workspace. Each saved search shows how many creators match it today, counted by the same code the discovery page uses. The plan caps how many an account keeps (Trial and Starter 3, Growth 25, Agency 100, Enterprise 1,000), with a paywall at the limit; viewers can open saved searches but not save or delete them.

**Comparison.** Tick *Compare* on the creators you're weighing up (the ticks follow you across pages and filters within the tab), then open the comparison: creators as columns, measures as rows. It shows the facts (platform, niche, country, brand safety) and the numbers (followers, engagement rate, average views, posts per week, 30-day growth, authenticity, estimated rate, and **cost per 1,000 views**, the fairest single number across creators of different sizes). The best creator on each measure is marked with the word "Best" (never colour alone): highest engagement, growth, authenticity and views; lowest rate and cost per 1,000 views. Ties share it, and nothing is marked when everyone is equal or only one creator has a value. Followers and posting frequency are facts, not scores, so nobody is "best" at them. How many creators can be compared at once depends on the plan (Trial and Starter 2, Growth 4, Agency and Enterprise 6); ticking one too many, or opening a link that asks for more, shows what the next plan adds. The comparison uses only the figures already visible in discovery, so it can't be used to read gated audience details or to get around the monthly profile allowance; those stay on each creator's profile. **Add all to a list:** the comparison page puts every creator shown on an existing list, or on a new one named on the spot, in one step (editors and admins; viewers are told why they can't). Creators already on the list are skipped and counted, and each one added is a `Creator Added To List` event with `source: compare`. The usual list limit and its paywall apply.

**Events:** `Creator Search Saved`, `Saved Search Opened`, `Saved Search Deleted`, `Creators Compared`.

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
| Creator agreements | – | – | yes | yes | yes |
| Pay creators from Ripplewise | – | – | – | yes | yes |
| Saved searches | 3 | 3 | 25 | 100 | 1,000 |
| Creators compared at once | 2 | 2 | 4 | 6 | 6 |

Opening a profile counts once per creator per month (`creator_profile_views`), so re-opening one is free. Past the limit, new profiles are blocked and the person sees what the allowance is and the plan that raises it; profiles already opened stay available. Four paywall placements were added: `creator_list_limit`, `creator_profile_quota`, `creator_audience` and `creator_export`. Each is dismissible with equal-weight "Not now".

Roles: owners, admins and editors change lists; viewers can browse and export; client viewers cannot open Influencers.

## Data

- `creators` (shared reference data, like the mention corpus): 50,000 creators, loaded by `npm run db:load` (or `npx tsx db/load-creators.ts --seed 42 --count 50000`). Reproducible for a given seed.
- `creator_lists`, `creator_list_items`, `creator_profile_views` (per workspace or account).
- About 9% of creators are generated with inflated audiences (28–62% likely fake followers, engagement well below what their size predicts), so authenticity filtering has something real to find.

## Analytics

New events in `docs/tracking-plan.json` (139 total): `Product Hub Viewed`, `Product Opened` (`target_product` says which), `Creator Search Run`, `Creator Profile Viewed`, `Creator List Created`, `Creator Added To List`, `Creator Removed From List`, `Creator List Exported`, the five campaign events, the six outreach events the five tracking events the six contract and payout events, the four search and comparison events above, and `Creator Invitation Reminded` (sent by the system). Paywalls reuse `Paywall Viewed`.

## Not yet built

Creator emails are simulated (stored, and sent to Mailpit when configured); there's no real delivery.  Still to build: anything that estimates reach or earned media value (results are measured visits and conversions only), tax forms and withholding, and a real payment provider behind the payout rail. Creator data is a snapshot; there is no refresh job. The two products share a login, workspaces, plans and billing but not data: Influencers does not read the listening corpus, by design.

## Content as a file (I7)

A creator can send their content as a file instead of a link to a post: on their page they choose *Upload a file* (the link stays the default). Each version is one or the other.

- **Accepted:** JPG, PNG, GIF, WebP, MP4, MOV and PDF, up to 25 MB. The type is decided from the file's first bytes, never from its name or the type the browser claims, so a web page renamed `holiday.png` is refused. SVG is refused on purpose (it can carry scripts). The stored name is tidied (no path, no odd characters, the right extension).
- **Stored in Postgres** in `campaign_content_files`, apart from the content rows, so listing content never reads the bytes; it carries a SHA-256. It is deleted with its campaign. This suits the simulated product; a real deployment would put files in object storage behind the same two routes.
- **Opening a file:** the brand opens it from the review panel (members of that workspace only; the route checks the campaign belongs to the workspace). The creator opens their own uploads from their page by the same private link they use for everything else. Anyone else gets a plain 404. Files are served with their real type, `X-Content-Type-Options: nosniff`, a `sandbox` content-security-policy, `no-store` and `noindex`; images and MP4 open in the browser, PDF and MOV download.
- **Same rules as a link:** only while confirmed and not under review, only after any agreement is signed, one at a time, a caption is optional, and review works the same (approve, or ask for changes with feedback).
- **Analytics:** `Creator Content Submitted` carries `content_kind` (`link` or `file`). No new events.
- **Not done:** virus scanning, per-plan storage limits, thumbnails, and video playback in the review panel (the file opens in a new tab).

## Screenshots

Captured with `npm run screenshots -- influencers` on a demo workspace built through the real screens (all names and data are synthetic). Each is in light and dark.

- The product hub after sign-in: [light](screenshots/14-product-hub-light.jpg), [dark](screenshots/14-product-hub-dark.jpg)
- Discovery with a saved search and two creators ticked for comparison: [light](screenshots/15-creator-discovery-light.jpg), [dark](screenshots/15-creator-discovery-dark.jpg)
- A creator's profile: authenticity, brand safety and audience: [light](screenshots/16-creator-profile-light.jpg), [dark](screenshots/16-creator-profile-dark.jpg)
- Comparing three creators, with the best on each measure marked: [light](screenshots/17-creator-compare-light.jpg), [dark](screenshots/17-creator-compare-dark.jpg)
- A campaign: one creator's file waiting for review, one invitation out, one shortlisted: [light](screenshots/18-campaign-roster-light.jpg), [dark](screenshots/18-campaign-roster-dark.jpg)
- Tracking results: visits, conversions, cost and return: [light](screenshots/19-campaign-results-light.jpg), [dark](screenshots/19-campaign-results-dark.jpg)
- What the creator sees on their own page, with no account: [light](screenshots/20-creator-page-light.jpg), [dark](screenshots/20-creator-page-dark.jpg)

