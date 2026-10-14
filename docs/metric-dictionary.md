# Metric dictionary

One row per metric: what it is, who is counted, the window, and what is left out. Changes go through
`docs/analytics-decisions.md`.

| Metric | Formula | Who is counted (denominator) | Window | Excluded |
|---|---|---|---|---|
| Setup completion rate | Owners with an `Onboarding Completed` event / owners with at least one `Onboarding Step Viewed` | Account owners (`user_role = owner`) | From their first step view to the end of the run | Rows with `is_synthetic = false` unless stated; invited members, who skip setup |
| Step pass rate (step N) | Owners who completed or skipped step N / owners who viewed step N | Owners who viewed step N | Same | A step that is required cannot be skipped |
| Plan-limit block rate (step N) | Owners with a `Onboarding Step Blocked` event where `block_reason = plan_limit` on step N / owners who viewed step N | Owners who viewed step N | Same | Blocks with `block_reason = validation` |
| Exit rate (step N) | Owners with an `Onboarding Exited` event on step N / owners who viewed step N | Owners who viewed step N | Same | Read as a lower bound: the event can be lost |
| Step time | Median `duration_ms` of `Onboarding Step Completed` for step N | Owners who completed step N | Same | Fast-mode runs (no human pacing); a run with `--pace fast` has times near zero by design |

Time-based metrics are only meaningful for agents run at human pace (see `docs/agents.md`, "Human pacing").
