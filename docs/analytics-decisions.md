# Analytics decisions log

Decisions about what is measured and how it is defined, with the reasons, so a number can be traced back to a choice.
Newest at the bottom. The owner of this log is the person doing the analysis.

## 2026-10-14: onboarding funnel (case study 1)

Context: the first run of all 90 seeded owners through the first-run wizard. All 50 Starter owners were refused at step 4
because every query slot was already used, and left. All 40 Growth and Agency owners finished.

### 1. Keep `Onboarding Step Blocked`: yes

Why: it is the only event that says why a step refused someone. Without it a drop-off at step 4 cannot be told apart
from a confusing screen. It also fires for ordinary typing mistakes (`validation`), so any analysis of plan limits
filters on `block_reason = plan_limit`.

### 2. Keep `Onboarding Exited`: yes, with a caveat

Why: it separates people who left from people still looking. It is sent from the page's close, so it can be lost to a
crash, a dropped connection or a phone locking its screen. Report it as a strong hint, and say so wherever a number
depends on it. Users who leave through an event that is lost still show up as "viewed a step, never finished".

### 3. Skipping an optional step counts as passing it, and "finished setup" means `Onboarding Completed`

- Optional steps are goals and invite. In the funnel chart a step is passed if it was completed or skipped. Skips are shown
  as a separate count beside the chart, so nothing is hidden.
- The headline number, **setup completion rate**, is the share of owners who viewed step 1 and have an
  `Onboarding Completed` event, by plan tier. It does not depend on how skips are treated.
- Required steps (role, brand, first query) are never counted as passed by skipping: they cannot be skipped.

These were the recommendations in the review and were accepted by the owner.
