# Ripplewise platform interface (M0, interface binding)

Written for the autonomous-agents spec (v0.1, section 16). It describes what the platform **actually does today**, read from the code on branch `claude/add-build-brief`. Where the agent spec expects something the platform lacks, it is listed under **Gaps** (section 10) with a suggested change.

Conventions: server actions are Next.js "use server" functions called from the UI (they are POSTs to the page route with a `Next-Action` header, not a stable REST API). Paths are relative to the repo root. `ws` is a workspace slug.

---

## 1. Access method (answers checklist item 1)

- **UI is the only supported interface.** There is no public REST or GraphQL API and no API keys (the `api` plan flag exists in `lib/entitlements/plans.ts` but nothing implements it; see Gaps G1).
- The UI is built for automation: stable `data-testid` attributes on every interactive element, accessible names, and `data-hydrated="true"` on the mentions feed. The Playwright specs in `tests/e2e/*.spec.ts` are the best worked examples; `tests/e2e/helpers.ts` (`createUser`, `openFeed`) shows the real sign-up flow.
- **Wait for hydration.** A production build paints server-rendered buttons before React attaches; a click in that gap is lost. Use `page.waitForLoadState("networkidle")` after navigation (as the specs do) or the `data-hydrated` marker on the feed.
- **Run it:** `docker compose up` (app, postgres 16, mailpit) or `npm run build && npm run start` against `DATABASE_URL`. Env needed: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST=true`, `APP_URL`. Optional: `SMTP_URL`, `AMPLITUDE_API_KEY`, `NEXT_PUBLIC_AMPLITUDE_KEY`, `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`, `APP_VERSION`, `SIM_CLOCK_OFFSET_MS`, `RUN_JOBS_IN_PROCESS` (default on: pg-boss workers run inside the web process).

## 2. Screens and actions

Routes under `app/`. "Role" is the minimum role (matrix in section 3). Every `/w/[ws]/*` page loads through `requireWorkspace(slug)`; non-members get a 403 page.

### Acquisition and auth (public)

| Route | What a user can do | Action / endpoint |
|---|---|---|
| `/` , `/pricing`, `/contact-sales` | Read marketing, toggle plan compare, request sales contact | `submitSalesRequest(input)` (`app/(marketing)/contact-sales/actions.ts`) |
| `/signup` | Create account + workspace | `app/(auth)/signup/actions.ts` (name, email, company, password; `data-testid` `signup-*`) |
| `/verify` | Resend / confirm email (link arrives in `/inbox`) | `app/(auth)/verify/actions.ts` |
| `/login`, `/login/magic`, `/oauth/northstar/*` | Password login, magic link, simulated OAuth ("Northstar") | `app/(auth)/login/**/actions.ts`, `app/oauth/northstar/**`; Auth.js route `/api/auth/[...nextauth]` |
| `/forgot`, `/reset` | Password reset by emailed link | `app/(auth)/forgot|reset/actions.ts` |
| `/invite/[token]` | Accept a team invite | `acceptInviteAction` (`app/settings/team/actions.ts`) |
| `/inbox` | Simulated mailbox for the signed-in user (all emails the app "sends") | page only |
| `/quote/[token]` | View, accept and sign a sales quote | `acceptAction`, `signAction` (`app/quote/[token]/actions.ts`) |
| `/share/[token]` | Public read-only dashboard/report | `getSharedWidgetData` |
| `/api/t/o/[id]`, `/api/t/c/[id]` | Email open pixel / click redirect (tracked) | GET |

### Onboarding (`/onboarding`, 5 steps; any step can be skipped)

`saveRole(role)`, `saveGoals(goals[])`, `saveBrand(input)`, `getQueryPreview()`, `saveFirstQuery()`, `sendInvites(emails[])`, `completeOnboarding(durationMs)` in `app/onboarding/actions.ts`. Ends on `/w/[ws]/home` with a checklist.

### Workspace (`/w/[ws]/...`)

| Route | Purpose | Actions (file: `app/w/[ws]/<area>/actions.ts`) | Role |
|---|---|---|---|
| `home` | Checklist, headline numbers, alert strip | none | view |
| `queries`, `queries/new`, `queries/[id]` | Query list and builder (guided and advanced Boolean, live preview, lint) | `previewAction(...)`, `saveQuery(slug, {id?, name, booleanText, builderMode, filters, ...})` (create **and** edit), `setQueryStatus(slug, id, "paused"|"live")`, `deleteQuery(slug, id)` | view / edit |
| `mentions` | Feed: URL-synced filters, cards/list/table views, drawer, saved views | `setSentiment`, `addTags`, `removeTag`, `setFlag`, `restoreOverrides` (undo), `getMentionDetail`, `countNewMentions`, `listSavedViews`, `saveView`, `deleteView`, `workspaceTags`; export at `GET /api/w/[ws]/mentions/export` (CSV) | view / edit (overrides) |
| `dashboards`, `dashboards/[id]` | Dashboards, 12 widget types, templates, edit mode, drill-down, share | `createDashboard`, `saveDashboard`, `deleteDashboard`, `duplicateDashboard`, `setPublicLink`, `recordInternalShare`, `recordDashboardView`, `getWidgetData` | view / edit |
| `alerts`, `alerts/new`, `alerts/events/[id]` | Rules with backtest, fired alerts, acknowledge, mute, delete | `backtestAction`, `createAlert`, `setAlertMuted`, `deleteAlert`, `markOpened`, `acknowledgeAlert`, `startCrisis` | view / edit |
| `crisis`, `crisis/[id]` | Crisis room: tasks, stakeholder update, resolve | `openCrisis`, `addTask`, `toggleTask`, `sendUpdate`, `setResolved` | edit; plan feature |
| `reports`, `reports/new`, `reports/[id]` | Report builder, schedules, send copy | `createReport`, `saveReport`, `deleteReport`, `saveSchedule`, `stopSchedule`, `sendCopyNow`, `listReportTargets`, `addSectionToReport`; PDF/CSV at `GET /api/w/[ws]/reports/[id]/export` | view / edit; scheduling is a plan feature |
| `exports` | Data export form | uses the export endpoints above | export |
| `ask` | Ask AI (cited answers), AI summary, peak explanation, query writer | `askAction`, `summaryAction`, `peakAction`, `writeQueryAction` | view; monthly quota |
| `authors`, `authors/[id]`, `topics` | Author profiles, watchlist, topics | `setWatched` | view |

### Settings (`/settings/...`, account-wide)

| Route | Purpose | Actions |
|---|---|---|
| `billing`, `billing/checkout`, `billing/cancel`, `/upgrade` | Plan, card, change plan, cancel (≤3 steps), save offer once | `app/settings/billing/actions.ts`: `checkoutAction`, `changePlanAction`, `updateCardAction`, `keepCurrentPlanAction`, `saveOfferAction`, `acceptOfferAction`, `cancelAction`, `resumeAction` |
| `usage` | Quota meters | none |
| `members`, `workspaces` | Invites, roles, remove, create/rename/archive/restore workspaces | `app/settings/team/actions.ts`: `invitePeopleAction`, `resendInviteAction`, `revokeInviteAction`, `changeRoleAction`, `removeMemberAction`, `leaveWorkspaceAction`, `createWorkspaceAction`, `renameWorkspaceAction`, `archiveWorkspaceAction`, `restoreWorkspaceAction` |
| `branding` | White-label for client viewers | `saveBrandingAction` |
| `audit` | Audit log | page only (owner/admin) |

Not present as screens: Help, Sources/upload, API/keys, notifications settings page beyond the bell, categories/auto-tag rules (see Gaps).

## 3. Authentication, roles, tenancy

- **Auth.js (next-auth v5)**: credentials (email+password, Argon2), magic link, and simulated OAuth, all through Credentials providers with single-use tokens (`lib/auth/tokens.ts`). JWT session cookie. Email must be verified before onboarding.
- **Login throttle:** 5 wrong passwords within 15 min lock that email for 15 min (`lib/auth/throttle.ts`); keyed by email hash only, no per-IP limit.
- **Tenancy:** `accounts` (plan, trial dates, usage) → `workspaces` → `memberships` (user, workspace, account, role). One user can belong to several workspaces; the workspace slug in the URL selects context.
- **Roles** (`lib/permissions.ts`): `owner`, `admin`, `editor`, `viewer`, `client_viewer`.

| Capability | owner | admin | editor | viewer | client_viewer |
|---|---|---|---|---|---|
| View mentions, queries, alerts, crisis, authors, topics | ✓ | ✓ | ✓ | ✓ | - |
| Edit those | ✓ | ✓ | ✓ | - | - |
| View dashboards and reports | ✓ | ✓ | ✓ | ✓ | ✓ (only these) |
| Export | ✓ | ✓ | ✓ | ✓ | - |
| Members, workspaces, billing, audit, branding | ✓ | ✓ | - | - | - |

- **Mapping to the agent spec roles:** analyst → editor; strategist → editor (or viewer); account executive → editor; division leader → owner/admin; technical contributor → no equivalent (no API). Seniority (lead/senior/mid/junior) is **not modeled** in the product.
- **Seeding accounts:** there is no seed script for agent accounts. Today accounts are created through the real sign-up UI, then teammates through `/settings/members` invites and `/invite/[token]` (the link is in the invitee's `/inbox`). `tests/e2e/helpers.ts#createUser` is the reference flow. See G2.

## 4. Data loading and scoping

- **Corpus:** `npm run datagen` writes `data/corpus` (seeded and reproducible: `--seed`, `--authors`, `--scale`, `--brands`, `--end`); `npm run db:migrate` then `npm run db:load` bulk-loads it with COPY into `mentions`, `authors`, `sources`, `brands`, `stories`. The full build is about 4.1M mentions and 40 brands. All names, brands and URLs are fictitious.
- **The corpus is global and read-only.** Mentions are not copied per account. A query's matches are materialized into `query_matches` (per query) and `query_daily_stats` by the backfill job; the feed, dashboards and alerts read those.
- **Scoping:** every workspace-level table carries `workspace_id`; the corpus is shared. Human edits (sentiment, tags, flags) live only in `mention_overrides` per workspace, never in the corpus.
- **Case data / truth packs:** the platform has no concept of a case, brief, or truth pack. Ground truth for the corpus lives in datagen output (stories, `is_spam`, true sentiment), not in the app. See G3.
- **History window per plan:** trial/starter 30 days, growth 365, agency 730 (`historyDays`). Backfill runs newest-first up to the account's remaining monthly mention allowance. Later mentions are released as the sim clock advances (`jobs/release.ts`), snapped to the plan's refresh tier (starter 12 h, growth hourly, agency 5 min).

## 5. Tracking

- **Plan:** `docs/tracking-plan.json` (source of truth, 104 events, each with `area`, `side` client/server, `properties`, `destinations`, optional `ga4_name`). `lib/analytics/events.ts` is generated from it (`npm run gen:events`), so unknown events or properties fail typecheck.
- **Path:** client `track()` (`lib/analytics/client.ts`) → Amplitude Browser SDK (if `NEXT_PUBLIC_AMPLITUDE_KEY`) and `POST /api/track` (beacon); server `trackServer()` (`lib/analytics/server.ts`) **always** inserts into Postgres `analytics_events` (the warehouse mirror), then sends to Amplitude Node SDK (`AMPLITUDE_API_KEY`) and GA4 Measurement Protocol (`GA4_MEASUREMENT_ID`, `GA4_API_SECRET`, funnel events only, no PII). Without keys, only the Postgres mirror is written; this is the dataset agents will populate.
- **Global properties on every event:** `account_id, workspace_id, plan_tier, trial_day, user_role, persona_archetype, is_synthetic, agent_run_id, app_version, route, ui_theme`. Plus groups `account` and `workspace`; `groupIdentifyAccount()` pushes nightly scores (PQA, health band).
- **Agent labelling:** the harness sets a cookie `rw_sim` = base64 JSON `{persona, run, model}` before sign-up (`lib/sim-context.ts`). Sign-up stores it on the user (`personaArchetype`, `agentRunId`, `agentModel`; `isSynthetic` is always true). It labels analytics only and changes no behavior.
- **`analytics_events` row:** `name, side, user_id, account_id, workspace_id, device_id, props jsonb, created_at (default now())`.
- **Event names (full list):** Marketing Page Viewed, Pricing Page Viewed, Plan Compare Toggled, Sign Up Started/Completed, Email Verified, Login Completed/Failed, Password Reset Requested, Onboarding Step Viewed/Step Completed/Skipped/Completed, Checklist Item Completed, Query Builder Opened, Query Previewed, Query Validation Failed, Query Saved/Edited/Paused/Deleted, Query Backfill Completed, AI Query Generated, Mentions Feed Viewed, Mention Filter Applied, Mention Opened/Tagged/Sentiment Overridden/Flagged, Mentions Bulk Action Applied, Saved View Created, Peak Explanation Viewed, AI Summary Generated, Ask AI Question Submitted, Ask AI Citation Opened, Insight Shared, Author Profile Viewed, Author Watchlisted, Topic Opened, Dashboard Created/Saved/Viewed/Shared, Widget Added/Configured/Moved/Drilled Down, Alert Created/Triggered/Notification Sent/Opened/Acknowledged/Muted/Deleted, Crisis Room Opened, Crisis Task Created, Stakeholder Update Sent, Crisis Room Resolved, Report Created, Report Section Added, Report Exported/Scheduled/Delivered/Opened, Export Downloaded, Teammate Invited, Invite Accepted, Comment Added, User Mentioned, Workspace Created/Switched/Archived, Client Viewer Added, Paywall Viewed/Dismissed, Upgrade Started, Subscription Started, Plan Upgraded/Downgraded, Seat Added, Payment Failed, Trial Ended, Quota Threshold Reached, Sales Contact Requested, Demo Booked, Quote Viewed/Accepted, Contract Signed, Cancellation Started, Cancellation Reason Submitted, Save Offer Viewed/Accepted, Subscription Canceled, Account Reactivated, Command Palette Opened, Keyboard Shortcut Used, Theme Changed, Help Opened, Error Displayed, Empty State CTA Clicked, Notification Opened, Email Opened, Email Link Clicked, Experiment Exposed. Exact properties per event: `docs/tracking-plan.json` (do not duplicate here).
- **Naming differs from the agent spec.** Spec names (`query_created`, `mention_opened`, `sentiment_overridden`, `visual_export`, ...) are snake_case; the platform uses Title Case events (`Query Saved`, `Mention Opened`, `Mention Sentiment Overridden`, `Report Exported`/`Export Downloaded`). A mapping table is needed (G9).
- Not tracked: `screen_view` for every screen (only marketing/pricing, feed, builder, dashboard, alert, crisis, etc. have view events), `preview_run` (it is `Query Previewed`), and anything for "message colleague".

## 6. Capabilities present (agent spec catalog)

| Capability | Status | Notes |
|---|---|---|
| Keyword and Boolean queries | Present | AND / OR / NOT, quotes, parentheses, wildcard `run*` (trailing only) |
| Exclusions | Present | `NOT term`; guided builder has an exclusions field |
| Proximity operators | Present | `a NEAR/5 b`, `NEAR/5f` (ordered) |
| URL operator for replies | **Absent** | only `site:domain`; no reply-to-URL operator (G4) |
| Author operators | Present | `author:handle`, `@mention`, `#hashtag`, `hashtag:` |
| Field filters | Present | `source:`, `lang:`, `country:`, `logo:`; plus UI filters (source, sentiment, language, country, tag, type, followers, media, spam, flagged, range, sort) |
| Tags | Present | `addTags`/`removeTag` on mentions, tag filter |
| Categories | **Absent** | no category/subtopic entity (G5) |
| Auto-tagging rules | **Absent** | (G5) |
| Sentiment override | Present | `setSentiment`, bulk, undo; stored in `mention_overrides` |
| Custom dashboards and templates | Present | 12 widget types, templates, edit mode with keyboard move |
| AI summaries | Present | crisis-room summary, Ask AI with ≥3 citations, peak explanation, AI query writer; simulated provider behind a swappable interface; monthly quota per plan |
| Share of voice | Present | widget (growth+) |
| Historical backfill | Automatic only | runs on save; no manual "request backfill" or add-on (G6) |
| Custom source upload | **Absent** | (G7) |
| Scheduled reports | Present | growth+; deliveries land in `/inbox`; open/click tracked |
| Conditional alerts | Present | three rule types in `lib/alerts/rules.ts` (`volume_spike`, `sentiment_drop`, `influencer`), email/in-app channels, backtest preview |
| Branded exports | Present | white-label branding (agency+) applies to client viewer pages and PDF |
| Query reuse across projects | **Absent** | queries belong to one workspace; no copy/share (G8) |
| API access | **Absent** | plan flag only (G1) |
| Crisis room, authors watchlist, topics | Present | extras beyond the catalog |

## 7. Quotas, plans, paywalls

`lib/entitlements/plans.ts` is the single source of truth, enforced server-side by `can(tier, action, usage)` and mirrored in the UI.

| Plan | $/mo | Active queries | Mentions/mo | Seats | Workspaces | History | Refresh | Alerts | Ask AI/mo |
|---|---|---|---|---|---|---|---|---|---|
| trial | 0 | 3 | 5,000 | 2 | 1 | 30 d | hourly | 2 | 10 |
| starter | 79 | 3 | 10,000 | 1 | 1 | 30 d | 12 h | 3 | 10 |
| growth | 249 | 10 | 50,000 | 5 | 1 | 365 d | hourly | 20 | 100 |
| agency | 599 | 30 | 200,000 | 15 | 10 | 730 d | real-time | 100 | 500 |
| enterprise | quoted | 50 | 1,000,000 | 50 | 1,000 | 1,825 d | real-time | 10,000 | 5,000 |

- Feature flags per plan: sentiment alerts, crisis room, scheduled reports, white label, share of voice, emotion widget, public share links, SSO, audit log, API, logo recognition (growth adds the first six, agency adds white label; enterprise the rest).
- When a limit is hit the UI opens a paywall modal (10 placements) and the server action returns `{ok:false, error, upgradeTo}`. Mention quota exhaustion sets `backfill_status = quota_exhausted` and the release job still advances the clock.
- **No overage pricing and no add-ons** (the agent spec's "slots, overage, add-ons" in 4J are not modeled; G6).
- Billing is a simulated internal provider in test mode only; trial lifecycle: reminder at 3 days, trial ended → grace (3 days) → read-only lock (`lib/billing`, `runBillingLifecycle`). Cancellation: Billing → Cancel → reason → (save offer once) → confirm.
- Throughput limits: no HTTP rate limiting in the app. Concurrency is bounded by Postgres and the Next process. Previews and widget queries run against the shared corpus (target: preview <1.5 s on 1M rows). The e2e suite runs one worker; many concurrent agents were never load-tested (G10).

## 8. Simulated time

- `lib/simclock.ts#simNow()` returns `Date.now() + SIM_CLOCK_OFFSET_MS`, clamped to the corpus window (`HISTORY_START` to `WORLD_END` in `datagen/config.ts`). The offset is a **process-wide environment variable**, not per request or per agent. It drives the release job, trial days (`trial_day`), billing lifecycle, alerts, and "now" in feeds.
- **Actions and events cannot carry a simulated timestamp.** `analytics_events.created_at` and every `created_at`/`updated_at` default to the database wall clock. Lifecycle jobs accept an explicit `now` (e.g. `runBillingLifecycle(now, accountIds)`, `runRelease(queryId, now)`) so tests can drive them, but user actions cannot. See G11 for the proposed change.

## 9. Reset and snapshots

- **Reset to a known state today:** drop and recreate the database, `npm run db:migrate`, `npm run db:load` (the corpus load takes minutes at full scale). A faster path: create a Postgres template database after load and `CREATE DATABASE ... TEMPLATE`, or truncate the app tables (everything except `mentions`, `authors`, `sources`, `brands`, `stories`).
- `data/corpus` plus the seed makes the corpus reproducible; the app tables are not seeded, so a "known state" is just a freshly migrated, corpus-loaded database.
- Emails go to the `emails` table (and SMTP/Mailpit if `SMTP_URL` is set); the in-app `/inbox` is the reliable way for an agent to click verification, invite and report links.
- Background jobs (pg-boss) run in-process: backfill on query save, release (new mentions as time moves), alerts, report schedules, nightly PQA/health scores (`jobs/pqa.ts`).

## 10. Gaps and suggested changes

| # | Gap (agent spec expectation → reality) | Suggested change | Size |
|---|---|---|---|
| G1 | `create_api_key` / `api_call` and the technical contributor → no API | Add per-account API keys and a small read API (queries, mentions, counts) gated by the `api` plan flag; or drop the technical contributor from v1 | M-L |
| G2 | Seeding many accounts with 8-9 agents each → sign-up UI only | Add a harness-only seeding script (`scripts/seed-agents.ts`) that calls the same domain functions as sign-up and invites (`createAccountAndUser`, invite service) so the *data* is real; agents still do everything else through the UI. Needs seniority/persona fields on `users` (persona and run already exist) | M |
| G3 | Cases, briefs, truth packs and a ledger → none in the app | Keep them outside the app (agent orchestrator + ledger store); the platform only needs to expose `agent_run_id` (done). Truth for the corpus is in `datagen` output | S |
| G4 | URL operator for replies → absent | Add `url:`/`reply_to:` field in `lib/query/grammar.peggy` plus a `mentions.parent_url` column from datagen (corpus is threaded already) | M |
| G5 | Categories and auto-tagging rules → absent (tags only) | Add `categories` (name, keywords) and `tag_rules` (query → tag) tables with a rule-application job and UI under Mentions or Queries | M |
| G6 | Manual backfill request, add-ons, overage → automatic backfill only | Add a "Backfill more history" action (plan-gated) and an add-on/overage model in `plans.ts` | M |
| G7 | Custom source upload → absent | Add a CSV upload per workspace into a workspace-scoped mentions table merged in query compile | L |
| G8 | Query reuse across projects → absent | Add "Copy to workspace" for queries and a template library | S |
| G9 | Event names differ from spec snake_case | Keep the platform's Title Case plan as source of truth and write a mapping table in the agent repo; add missing events only if agents need them (`screen_view`, `help_opened` exists as `Help Opened` but there is no Help screen, `Support Contacted`) | S |
| G10 | Concurrency and rate limits unknown | Load-test with N parallel browser contexts, set `max` pool size, and document limits; add a global request budget if needed | M |
| G11 | No simulated timestamps on actions/events | Accept an optional `x-sim-time` header or `rw_sim.clock` field (harness-only, honored when `is_synthetic`), thread it through `trackServer` and the `created_at` defaults via a `now()` helper, and make `simNow()` per-request instead of env-global | M-L |
| G12 | Help screen and support contact → absent | Add `/help` (topics) and a `contact_support` form that writes `emails`/`sales_requests` and fires `Help Opened` / a new event | S |
| G13 | Seniority levels and offline social layer → not in the product | Keep seniority only in the agent profile; messages stay in the agent ledger (spec 11 already says they are not platform events) | none |
| G14 | Screenshot/text perception → pages are text-rich, but some charts are canvas (ECharts) | Every chart has a table alternative (WCAG); agents should read that table view instead of the canvas | none |
| G15 | Server actions are not a stable API | For Tier 0/1 agents, drive the UI with Playwright; do not call server actions directly (their IDs change per build) | none |

## 11. Quick reference for an agent harness

1. Start: `docker compose up` or `npm run start` (prod build); wait for `/login` to return 200.
2. Before sign-up set cookie `rw_sim=<base64 {"persona":"analyst_mid","run":"run-001","model":"..."}>` on the app origin.
3. Sign up at `/signup` (`signup-name`, `signup-email`, `signup-company`, `signup-password`, `signup-submit`), open `/inbox`, follow the verification link, complete or skip the 5 onboarding steps (`role-*`, `onboarding-next`, `onboarding-skip`, `brand-name`).
4. Work in `/w/<slug>/...`; invite colleagues from `/settings/members`; their invite links are in the invitee's inbox (log in as them to read it).
5. Read results from the DB (`analytics_events`, `emails`) for evaluation, never from the agent's own view.
