# CLAUDE.md — Ripplewise (fictitious social listening B2B SaaS)

## Mission
Build a production-quality, human-facing social listening web app. It will be used by
autonomous browser agents emulating real users, so build EXACTLY as for humans:
real onboarding, limits, paywalls, empty/error states, emails, billing, cancellation.
No agent-only shortcuts or hidden endpoints. Stable `data-testid` + accessible names required.

## Stack (do not substitute without asking)
- Next.js 15 (App Router) + TypeScript strict; React Server Components where sensible
- Tailwind CSS + shadcn/ui (Radix) using tokens in /styles/tokens.css (light+dark)
- ECharts (echarts-for-react) for charts; TanStack Table + TanStack Virtual
- CodeMirror 6 for Boolean editor; Peggy for Boolean grammar
- PostgreSQL 16 + Drizzle ORM; pg-boss for jobs (release, backfill, alerts, reports, emails)
- Auth.js (credentials, magic link, simulated OAuth); Argon2
- Stripe TEST MODE only (or internal BillingService behind the same interface)
- Mailpit for SMTP in dev; EmailService writes to `emails` table
- Amplitude Browser SDK 2 (@amplitude/analytics-browser) + Node SDK (@amplitude/analytics-node)
- Vitest (unit), Playwright (e2e), axe-core (a11y), ESLint, Prettier
- Docker Compose: app, postgres, mailpit

## Project structure
/app/(marketing)/...        landing, pricing, compare, legal
/app/(auth)/...             signup, login, verify, forgot
/app/onboarding/...         5-step wizard
/app/w/[ws]/...             home, queries, mentions, dashboards, authors, topics, ask,
                            alerts, crisis, reports, exports
/app/settings/...           profile, notifications, appearance, workspace(s), members,
                            billing, usage, security, integrations
/app/share/[token]          public read-only dashboards/reports
/app/inbox                  simulated mailbox (route-guarded per user)
/components/ui              shadcn primitives (tokenized)
/components/listening       MentionCard, FilterBar, DateRangePicker, QueryBuilder,
                            Widget*, PaywallModal, QuotaMeter, EmptyState, ErrorState
/lib/analytics              track.ts (typed wrapper), events.ts (generated from tracking-plan.json),
                            mirror.ts (server tee to analytics_events)
/lib/entitlements           plans.ts (single source of truth), can(user, action)
/lib/query                  grammar.peggy, ast.ts, compile-to-sql.ts, lint.ts
/lib/billing, /lib/email, /lib/flags, /lib/simclock
/db/schema.ts, /db/migrations
/datagen                    world.ts, authors.ts, stories.ts, hawkes.ts, text.ts, noise.ts, seed.ts
/jobs                       release.ts, backfill.ts, stats.ts, alerts.ts, reports.ts, pqa.ts, health.ts
/docs/tracking-plan.json    event + property schema (source of truth)
/tests/e2e                  one spec per key flow

## Analytics architecture
- One `track()` wrapper fans out per `destinations` in /docs/tracking-plan.json:
  - Amplitude: all events.
  - GA4: lead/funnel events only, renamed via each event's `ga4_name`. Use a separate GA4 property
    for synthetic traffic; set GA4 `user_id` to the same UUID as Amplitude. Never send email/names.
  - Warehouse (BigQuery): Postgres `analytics_events` mirror batch-loaded, plus Amplitude Export API
    pulls and GA4 native BigQuery export. Account-level analysis happens here.
- On sign-up, persist `signup_attribution_fields` (ga_client_id, ga_session_id, UTMs, gclid, referrer)
  on the user row so leads join to product behavior.

## Non-negotiable rules
1. Entitlements enforced server-side AND reflected in UI (locks, tooltips, paywalls).
2. Every user-visible interaction listed in /docs/tracking-plan.json fires exactly one event
   via track(); events are typed; unknown events fail typecheck.
3. Global props on every event: account_id, workspace_id, plan_tier, trial_day, user_role,
   persona_archetype, is_synthetic, agent_run_id, app_version, route, ui_theme.
4. setUserId(uuid) on auth; setGroup('account', id); setGroup('workspace', id) on switch; reset() on logout.
   Never send email or names to Amplitude.
5. WCAG 2.2 AA: 24px min targets, visible focus not obscured, drag alternatives, no cognitive
   auth tests, consistent help location, chart table alternatives, reduced-motion support.
6. No dark patterns: cancel reachable from Billing in ≤3 steps; save offer max once; no pre-checked upsells.
7. Never scrape real platforms; all data from /datagen; all names/brands/URLs fictitious.
8. Every screen implements loading, empty, error, and permission states.

## Milestones & acceptance criteria
M0 Foundations: repo, Docker, tokens, theme toggle, layout shell (sidebar/topbar), axe CI.
   AC: light/dark pass contrast script; axe 0 serious violations on shell.
M1 Data generation: world, authors, stories (launch/news/crisis), Hawkes cascades, noise, 3M+ mentions seeded.
   AC: seeded run reproducible; ≥1 crisis/brand/quarter; sentiment_pred≈70% agreement; spam ≥5% on naive queries.
M2 Auth & onboarding: signup, verify via Mailpit/inbox, 5-step wizard, Home checklist.
   AC: e2e signup→verify→wizard→home passes; events fire in order.
M3 Query engine & builder: grammar, lint, guided/advanced modes, live preview, save, backfill job.
   AC: 40 grammar unit tests incl. NEAR/n, wildcards, fields; preview <1.5s on 1M rows.
M4 Mentions feed: filters (URL-synced), views, drawer, tag/sentiment/flag, bulk actions, shortcuts.
   AC: j/k/x/t/s/f work; overrides stored in mention_overrides only.
M5 Dashboards & widgets: 12 widget types, templates, edit mode w/ keyboard move, drill-down, share.
   AC: each widget has table alternative + loading/empty/error; drill-down applies filters.
M6 Alerts & crisis: rule builder w/ backtest preview, release job triggers, notifications, Crisis Room.
   AC: injected crisis fires spike alert within 1 release cycle on real-time plans.
M7 Reports & exports: builder, PDF/CSV export, scheduling, deliveries, open tracking.
   AC: scheduled report email arrives in /inbox with tracked open/click.
M8 Billing & plans: plans.ts, quota meters, 10 paywall placements, checkout (test), downgrade,
   dunning, trial lifecycle (grace→lock), cancellation flow.
   AC: sim clock can run trial end, renewal, failed payment; entitlements update instantly.
M9 Teams & workspaces: invites, roles, seats, workspace switcher, client viewer, white-label, audit log.
   AC: role matrix tests (Owner/Admin/Editor/Viewer/Client viewer) pass.
M10 AI features: Ask AI w/ citations + quota, AI summaries, AI query writer, peak explanation.
   AC: every AI answer cites ≥3 mentions; quota decrements; graceful failure states.
M11 Sales-assist & analytics jobs: contact sales, demo, quotes, contracts; nightly PQA + health
    scores → groupIdentify + group properties; analytics mirror table; flags + Experiment Exposed.
   AC: PQA≥60 shows in-app card + SDR email; health_band visible to admin.

## Definition of done (every PR)
Typecheck, lint, unit, e2e for touched flow, axe pass, events verified in Amplitude debugger,
screenshots light+dark, no console errors.
