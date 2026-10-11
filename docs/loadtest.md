# Load test: how many agents can one machine drive?

The agent programme plans about 80 accounts of 8–9 agents each. This is what `npm run loadtest` measured, and what it
means for sizing. Everything here is from one 4-core, 16 GB machine that also ran the load generator, the app and
Postgres, against the CI-sized corpus (a few brands, `--scale 0.25`). Treat the numbers as a floor for a dedicated host.

## Method

1. `npm run seed:agents -- --accounts 12 --run lt1 --onboard-owner --first-query --out lt.json` creates 100 agents in 12
   paid accounts through the real sign-up, invite and billing code, each workspace with a live, backfilled query.
2. `npm run loadtest -- --manifest lt.json --users N --duration 60 --think 1.5 [--base url1,url2,...]` starts N virtual
   users. Each logs in over HTTP exactly like the login form does (CSRF token, credentials callback, session cookie)
   and then loops over the heavy pages of its workspace, picking by weight: Mentions (plain, filtered, Boolean
   search), Home, Queries, Dashboards, Alerts, Tags & Categories, Authors, Topics. Between requests it waits
   0.5–1.5 × the think time. Latency is the full page load, body included. Production build (`next start`).
3. It prints percentiles per route, status codes, errors, throughput and peak memory. Page loads only: server actions
   (saving, tagging) were not exercised, and the browser's own rendering is not part of the numbers.

## Results (one app instance)

| Virtual users | Page loads/s | Home p50 | Mentions p50 | Mentions p95 | Authors p50 | Errors |
|---|---|---|---|---|---|---|
| 10 | 8.7 | 37 ms | 116 ms | 189 ms | 120 ms | 0 |
| 50 | 18.9 | 874 ms | 1.0 s | 1.6 s | 2.1 s | 0 |
| 100 | 19.1 | 2.9 s | 3.5 s | 4.8 s | 4.5 s | 0 |

- Throughput saturates near **19 page loads per second**. Past that, extra users only queue: latency grows linearly and
  nothing fails (every response was a 200; 100 logins at once all succeeded in under a second).
- The limit is the **single Node process**: `top` showed `next-server` pinned at 100% of one core while Postgres used
  well under one. `next start` runs one thread, so one instance cannot use more than one core.
- Roughly 50 ms of app CPU per page load, plus about the same in Postgres. Authors and Topics are the heaviest pages.

## Results (three app instances, round-robin)

| Virtual users | Page loads/s | Home p50 | Mentions p50 | Authors p50 | Errors |
|---|---|---|---|---|---|
| 50 | 24.3 | 262 ms | 454 ms | 608 ms | 0 |
| 100 | 27.0 | 1.6 s | 2.0 s | 2.9 s | 0 |

Three instances improved latency a lot at 50 users and throughput by about 40%, but on 4 cores shared with Postgres and
the load generator the whole machine was out of CPU, so this is the host's ceiling, not the app's.

## What it means

- **Capacity:** about 25 page loads/s per 4 cores (app plus database). An LLM agent that acts every 10–15 s of
  working time is roughly 0.07–0.1 loads/s, so one 4-core box carries on the order of 250–350 *concurrently active*
  agents. Eight agents in each of 80 accounts is 640 agents; they will not all be active at once, but a simulated year
  compressed into days can keep many busy. Plan for about 8–10 cores for the app tier and database together, with the
  app as several instances (one per core) behind a round-robin proxy.
- **Run several instances.** The app keeps no state in memory (sessions are JWT cookies; jobs go through Postgres), so
  extra instances are safe. Give all but one `RUN_JOBS_IN_PROCESS=false` so only one runs the pg-boss workers, or run
  `npm run worker` separately. Each instance has a pool of 10 database connections (`db/client.ts`), and Postgres
  allows 100 by default: raise `max_connections` or lower the pool beyond about eight instances.
- **No errors, no lost logins, memory stable:** peak app RSS was 0.8 GB for one instance, about 0.7 GB per instance for three.
- **Not covered:** server actions and mutations, the AI endpoints, report generation, the full 4.1M-mention corpus
  (queries are heavier there; the CI corpus is smaller), and long soak runs.
- **Cheap wins if more headroom is needed:** cache the account plan lookup that most pages repeat, and give Authors and
  Topics a short-lived cache keyed by workspace and filters.
