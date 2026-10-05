# Autonomous agents (milestone M1)

Agents use the platform the way agency staff do: through the browser, with a profile that decides how skilled and how
thorough they are, and a brain that makes the content decisions. They produce the product-analytics dataset, and a
private ledger explains every action. This is the code for the agent specification (v0.1); `platform-interface.md`
says what the platform offers them.

## What exists (M1: one analyst, one case, end to end)

| Spec section | Where | What it does |
|---|---|---|
| 3 Profile | `agents/profile.ts` | Samples traits, competencies, awareness and state from role and seniority, deterministically from the agent id. One shared fluency factor drives most skills. |
| 4 Assignment | `agents/cases.ts`, `agents/cases/` | A case is two files: the public brief an agent receives, and a truth file only the evaluator reads (JSON, not YAML, to avoid a dependency). `CS-001` is a brand-perception case on Juniper Roast. |
| 5 Action space | `agents/workspace.ts` | login, create_query, edit_query, preview, open_mentions, override_sentiment, create_category: each drives the real UI. No database reads, no hidden endpoint. |
| 7 Policy | `agents/analyst.ts` | The analyst flow: write a query, collect, read a sample, refine, correct sentiments, name themes, write up. Effort comes from the profile. |
| 7 Brains | `agents/brain/` | `ScriptedBrain` (rules, no model, runs anywhere) and `ClaudeBrain` (Messages API, key from `ANTHROPIC_API_KEY`, every call reported to the ledger). Same interface, so a run can swap them. |
| 8 Awareness | `agents/skill.ts` | An unknown capability does not exist for the agent. A junior who does not know exclusions says so in the ledger and works around it. |
| 9 Errors | `agents/skill.ts` | `weak_query` (bare word instead of the exact phrase) and `premature_stop` (fewer refinement rounds than wanted), logged when injected. |
| 14 Ledger | `agents/ledger.ts` | JSONL per run: intent, known capabilities, skill and state snapshots, injected errors, observations. Never sent to the platform. |
| 15 Evaluation | `agents/evaluate.ts` | Query precision, recall and spam share against the corpus's own brand labels; sentiment override accuracy against the classifier; deliverable numbers against truth; a rubric check. |

Platform events carry the labels (`is_synthetic`, `agent_run_id`, `persona_archetype`) through the `rw_sim` cookie the
runner sets, so the dataset can be joined to the ledger afterwards.

## Run it

```bash
npm run seed:agents -- --accounts 1 --run r1 --onboard-owner --out agents.json   # accounts and logins
npm run start                                                                      # the platform (ALLOW_SIM_CLOCK=true if using --clock)
npm run agent:case -- --manifest agents.json --agent acc001_u05 --case CS-001 \
    [--provider scripted|claude] [--base http://localhost:3000] [--out agents/out] [--headed]
```

Output goes to `agents/out/<run>/<agent>/`: `ledger.jsonl`, `deliverable.md`, `evaluation.json`, `profile.json`.
Set `PW_CHROMIUM_PATH` to use a preinstalled Chromium. For the Claude brain set `ANTHROPIC_API_KEY` (and optionally
`AGENT_MODEL`); it has been tested against a mocked API only, not live.

## What the first runs show

On the CI-sized corpus, with the scripted brain, case CS-001:

- A senior analyst who writes the exact phrase and the short form gets precision about 0.83 and recall about 0.74.
- A junior without exclusions reads past the noise and ends with lower precision and no categories: the platform
  data shows a worse query and no refinement, and the ledger says why (`latent_need: exclusions`).
- Recall is below 1 for every agent: the corpus contains mentions found only by hashtag, logo or alternative spelling,
  which is what the naming-variant part of the evaluation is for.

## Limits and what comes next

- **One role, one case.** Strategist, account executive, leader and technical contributor (M2), the orchestrator,
  clock and message bus (M3), richer skill, awareness and discovery events (M4), the cross-case evaluator and ledger
  tables (M5), scale and cost controls (M6) and calibration against a full-LLM browser agent (M7) are not built.
- **The case file from the spec (`cases-seed-v0.yaml`) is not in this repository.** `CS-001` is a stand-in with the same
  shape (brief, deliverable, window, scope, requester, due date; hidden truth and rubric). Convert further cases to the
  two-file JSON form, or add a YAML reader, when that file is available.
- **Agent clocks:** `--clock` sets the agent's own simulated "now" for its requests, but background jobs (collection,
  release) use the process-wide clock, so a clock far from the corpus's present would make the agent's windows
  disagree with what the jobs collected. The orchestrator (M3) is meant to drive both.
- **Deliverables** are files, not platform objects; M2 can submit them as reports in the platform.
- **Reading the screen** is DOM text, not screenshots (spec 6). Attention limits and misreads are not injected yet.
