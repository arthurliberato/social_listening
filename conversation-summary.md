# Ripplewise: conversation summary

A readable record of this working session: what was asked, what was built, what was verified, and what is still open.
It is a summary written from the session's history (the early part from a summary of it, the later part from the live
conversation), not a verbatim transcript. Nothing secret appears in it.

Repository: `arthurliberato/social_listening`, branch `claude/add-build-brief`. Pull request: #1 (open).

---

## 1. The project

**Ripplewise** is a fictitious B2B social-listening SaaS, built as a production-quality web app that autonomous browser
agents will use the way agency staff do. The brief and milestones M0–M11 are in `CLAUDE.md`. Stack: Next.js 15,
TypeScript, Postgres + Drizzle, pg-boss jobs, Auth.js, Amplitude and GA4 tracking, Vitest, Playwright, axe.
All data is synthetic (`/datagen`). Payments are out of scope beyond a simulated test-mode provider; the owner's interest
is showcasing product skills.

## 2. Timeline

### Phase A: the platform (before this transcript's later part)

Everything in M0–M11 plus extras was built and pushed: AI features (Ask AI with citations, summaries, query writer, peak
explanation), sales-assist and scoring, feature flags, Authors and Topics, password reset / magic link / simulated OAuth,
login throttling, Home checklist, audit coverage, "Add to report", screenshots and docs (`docs/product.md`,
`tour.md`, `analytics.md`, and others).

### Phase B: making CI green and opening the PR

- CI had been red on every push. Causes found and fixed: tests that hard-coded brands missing from CI's smaller corpus
  (now `lib/testing/corpus.ts` picks the busiest brands), a stale billing test, slow dev-server e2e (CI now serves a
  production build, one retry), and a real production-only bug class: **a page refresh started right after a server action
  is sometimes dropped by the browser**, so results did not show. Fixed with a plain busy flag (`useBusy`), local state in
  alert rows and the crisis-room status, and a URL re-sync on back/forward in the Mentions feed.
- PR #1 was opened after the user said CI was green. **That was wrong**: runs 48 and 49 were still red, and CI only
  turned green at run 56. Two further CI-only problems were then fixed (`tests/.auth/` missing on a fresh checkout, which
  skipped 107 tests; and chart-animation and hydration timing in two specs). The correction was reported to the user.

### Phase C: preparing for the agents (the spec the user pasted)

The user pasted an **Autonomous Agents Specification v0.1** and its M0 prompt (inspect the platform and write
`platform-interface.md`). Work done, in order:

| Item | Result |
|---|---|
| `platform-interface.md` | Screens, actions, auth, roles, tracking, capabilities, quotas, time, reset, and 15 gaps with suggested changes. |
| Per-agent simulated clock | `rw_sim` cookie `clock`; stamps events, rows, trial, token lifetimes, product "now". Gated by `ALLOW_SIM_CLOCK=true`. |
| Agent seeding | `npm run seed:agents`: paid teams of 8–9 through the real sign-up, invite and billing code, with persona labels and a login manifest. |
| Tags & Categories | Named Boolean searches with counts at `/w/[ws]/tags` (replaced a placeholder screen). |
| `replyto:` operator | Replies to a post URL or to a handle's posts. |
| Load test | `npm run loadtest`; one app instance saturates near 19 page loads/s (single Node thread), three reach ~27/s on 4 shared cores; no errors to 100 users. `docs/loadtest.md`. |
| Help center | `/w/[ws]/help`: ten searchable topics and an "ask us" form (reference, email, events), open to every role. |
| Query copy | Copy a query to another workspace or duplicate it in place. |
| History pack add-on | One-time $49, another year of history for one query, outside the monthly allowance; owner/admin on paid plans. |
| Agents M1 | `agents/`: profile sampling, scripted and Claude brains, skill/error layer, UI action layer, analyst policy, ledger, evaluator, runner `npm run agent:case`, case CS-001, `docs/agents.md`. |
| Vision mode | `--shots` saves a screenshot per key screen; `--vision` (Claude brain) sends it as an image block and records what the agent saw and any visual problems. |

Gap status in `platform-interface.md`: done or mostly done are G2 (seeding), G4 (`replyto`), G5 (categories, auto-tag rules
still absent), G6 (history pack, no overage), G8 (query copy), G10 (load test, page loads only), G11 (clock), G12 (Help).
Still open: **G1 API access** and **G7 custom source upload** (both large; neither needed for the first agent cases).

## 3. Verified state (as of the last checks in this session)

- **CI:** green on runs 56, 57, 58, 59, 60, 62, 63 and 64; run 61 failed once on a unit test (audit-log vocabulary) that was
  pushed past by mistake and fixed in the next commit. Run 65 (vision mode) was in progress at the last look and has not
  been confirmed since.
- **Local tests at the last full run:** unit 393/393 (CI-sized corpus); full browser suite 205/205 before vision mode; both
  agent specs pass.
- **Tracking plan:** 110 events. **Migrations:** up to `0018`.
- The agent has **never run against the live Claude model**; the Claude brain and vision mode are tested with a mocked API
  and a stand-in brain only.

## 4. Things worth remembering

- **How a scripted agent behaves (CS-001, CI-sized corpus):** a senior analyst gets precision ~0.83 and recall ~0.74; a
  junior who does not know exclusions ends with lower precision, no categories, and a ledger line saying why.
- **Agents see page text by default**, not pixels. Vision is opt-in.
- **Clock caveat:** `--clock` changes an agent's requests but not background jobs; the orchestrator (M3) is meant to drive both.
- **Case file:** `cases-seed-v0.yaml` from the spec is not in the repo. `CS-001` is a stand-in in JSON (public brief and
  hidden truth in separate files).
- **Test-environment gotchas that cost time:** Postgres stops between turns (restart with `pg_ctl`); a `pkill -f` pattern
  that appears in your own command line kills the shell; `useTransition` plus a refresh after a server action can drop the
  result in production builds; production builds paint buttons before React attaches, so specs wait for `networkidle`.
- **Process mistakes made and corrected:** told the user CI was green when it was not; pushed once past a failing unit test
  because a command chain did not stop on failure. Both were reported.

## 5. Open items and what is waiting on the user

1. **Live agent run.** Needs an `ANTHROPIC_API_KEY` in the environment settings (a new key with a low spend limit, added as an
   environment variable since no separate secrets section was offered; the user confirmed no one else uses the
   environment), network access to `api.anthropic.com`, and **a new session** (existing sessions do not see environment
   changes). Then: `npm run seed:agents -- --accounts 1 --run live1 --onboard-owner --out agents.json`, start the platform,
   `npm run agent:case -- --manifest agents.json --agent acc001_u05 --case CS-001 --provider claude --vision`.
2. **Child session `session_01NCTYr1xfevakJWKuv8BztT`** ("Live agent run"): exists, was idle, was sent step-by-step live-run
   instructions (check key without printing it, stand up the stack like CI, run, report, do not push). It started before
   the key was saved, so it will most likely report the key missing. Its origin could not be confirmed from this side
   (its parent id differs from this session's).
3. **M2 of the agent programme:** other roles (strategist, account executive, leader, technical contributor) and
   submitting deliverables as reports in the platform. Then M3 orchestrator, M4 richer skill/awareness, M5 cross-case
   evaluator, M6 scale and cost, M7 calibration with a full-LLM browser agent.
4. **Case file:** supply the real `cases-seed-v0.yaml` to convert further cases.
5. **Not built:** custom source upload, API access, overage pricing, auto-tagging rules, deliverables as platform objects,
   attention limits and misreads in perception.
6. **Unconfirmed:** the latest CI run (vision mode), and a `.env.example` branch the user mentioned that this session has
   no record of.

## 6. Files worth opening

| File | What it is |
|---|---|
| `CLAUDE.md` | The original brief and milestones. |
| `platform-interface.md` | What the platform offers agents; gaps and their status. |
| `docs/agents.md` | Agent architecture, how to run, vision mode, limits. |
| `docs/loadtest.md` | Load-test method, numbers and sizing advice. |
| `docs/billing.md` | Plans, billing, the history-pack add-on. |
| `docs/query-language.md` | Boolean language including `replyto:` and query copy. |
| `docs/tracking-plan.json` | The 110 tracked events. |
| `agents/` | The agent code. |
