# Demo deployment (Vercel + Neon free plan)

How to put a small, realistic copy of Ripplewise on Vercel with a Neon Postgres database that stays inside the free
plan's **1 GB** limit. The numbers below were measured on Postgres 16 with exactly the commands in this page.

## What you get

| | Amount |
|---|---|
| Mentions | about 392,000 (8,000 authors, 40 brands, scale 0.04) |
| Creators (Influencers product) | 10,000 |
| Accounts | 90, in three tiers (below) |
| Users | 198 |
| **Database size after setup** | **about 455 MB**, so about 570 MB is left for growth |

Breakdown: the corpus (mentions, authors, stories, creators) is about 243 MB; the 90 accounts, their queries and their
collected results add about 210 MB, almost all of it saved-query results.

## The three account tiers

Seeded with `--mix starter-limit:50,growth:25,agency-low:15`. Each account is created through the product's own
sign-up, invite, subscription and backfill code, then given queries on the corpus.

| Tier | Accounts | Plan | Users each | Queries | What it shows (measured) |
|---|---|---|---|---|---|
| `starter-limit` | 50 | Starter | 1 (the plan has one seat) | 3 of 3 slots: one brand query and two broad ones | **All 50 sit at the 10,000-mention monthly allowance** (collection stopped), so paywalls, the quota meter and upgrade prompts are in play |
| `growth` | 25 | Growth | 3–5 | 4–8 brand queries | A normal workload: 4,000–24,000 mentions, about a third of the 50,000 allowance on average |
| `agency-low` | 15 | Agency | 2–4 | 1–2 brand queries | The top self-serve plan, barely used: about 4% of the 200,000 allowance on average (7,400 mentions) |

The manifest (`agents-demo.json`) records `account_profile` and `usage_profile` (`at_limits`, `typical`, `low`) for
every user, so analysis can compare the segments. Ongoing behavior (Ask AI use, alerts, logging in) is not simulated by
the seeder; it comes from agents acting over time.

## Where to run the commands

On **your own computer**, in a terminal, not in a cloud sandbox: the load needs a direct Postgres connection (port
5432), which some sandboxes block. You need Node 22, git and the PostgreSQL command-line client (`psql`). On Windows use
WSL or Git Bash.

```
git clone <repo url> && cd social_listening
git checkout <branch>
npm ci
export DATABASE_URL='postgres://USER:PASSWORD@HOST/DBNAME?sslmode=require'   # Neon; PowerShell: $env:DATABASE_URL='...'
export AUTH_SECRET='<a long random string>'
npm run demo:setup
```

`demo:setup` runs, in order: `db:migrate` (creates the tables), `datagen:demo` (generates the corpus into `data/`),
`db:load:demo` (loads it, then 10,000 creators) and `seed:demo` (the 90 accounts). Use Neon's **direct** connection
string for this if it offers both a direct and a pooled one. It writes the logins, with passwords, to
`agents-demo.json`, which is git-ignored; keep it private.

Check the size afterwards in Neon's SQL editor:

```
select pg_size_pretty(pg_database_size(current_database()));
```

If the load stops for lack of space, lower `--scale` in `datagen:demo` (for example 0.025), empty the database and start
again. Mentions shrink more slowly than the scale because every brand has a minimum volume.

## Vercel settings

Environment variables on the Vercel project, then redeploy:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string. Neon's pooled string is the usual choice on Vercel, but this app has not been tested with it; switch to the direct string if you see connection errors |
| `AUTH_SECRET` | the same kind of long random string |
| `AUTH_TRUST_HOST` | `true` |
| `APP_URL` | the site's public address |

Without `DATABASE_URL` the app falls back to `localhost` and every page that reads the database fails with a server
error. An empty database (no tables) fails the same way, which is why the setup above runs first. RudderStack, GA4 and
BigQuery are optional; see `docs/rudderstack-bigquery.md`.

## Keeping inside the limit

- **Saved queries are the main growth.** Each query stores one row (about 200 bytes) per matching mention, inside the
  plan's history window and monthly allowance. Starter queries are small (30-day window); Growth and Agency store a year
  or two. Worst case per account if it fills its allowance: Starter about 2 MB, Growth about 10 MB, Agency about 41 MB.
  With brand-specific queries the real figures are far lower, as the table above shows.
- **History pack** is capped at 10,000 older mentions per purchase (about 2 MB), not 50,000.
- **Events** are small (about 3 KB each) and are also sent to RudderStack and BigQuery. The Postgres copy exists for
  reconciliation (`npm run audit:warehouse`); only that script reads it, so older rows can be deleted once BigQuery has
  them. No pruning job exists yet.
- **Creators** default to 50,000 (about 60 MB); the demo loads 10,000 (about 13 MB).
