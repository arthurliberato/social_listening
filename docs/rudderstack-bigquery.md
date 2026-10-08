# RudderStack to BigQuery

Every product event goes to RudderStack, which delivers it to BigQuery. This page is the setup checklist, what lands
where, and how to check that what arrives is right. Amplitude, Mixpanel or anything else can be added later as another
RudderStack destination with no change to the app.

**What is verified and what is not.** What the app sends is tested against a stand-in for RudderStack's data plane
(`tests/e2e/mock-dataplane.mjs`): the Postgres mirror and what arrives agree, once each, with the global properties and
nothing personal. The tracking plan is checked against the naming rules below, and `npm run audit:warehouse` checks the
events actually recorded. **Nothing has been sent to a real RudderStack or BigQuery yet.** The RudderStack and BigQuery
steps below are written from their documentation, not from the live dashboard, so screen and option names may differ
slightly; the first live run should be read against this page.

## 1. Connect the app

1. In RudderStack, create a **source** for server-side events (a Node.js or HTTP API source is the right kind: the app
   sends from its server). Copy its **write key**, and the **data plane URL** shown on the source's page.
2. Give them to the app as environment variables (never in the repository):

   | Variable | Value |
   |---|---|
   | `RUDDERSTACK_WRITE_KEY` | the source's write key |
   | `RUDDERSTACK_DATA_PLANE_URL` | the data plane URL, for example `https://yourname.dataplane.rudderstack.com` |

   With either missing the app sends nothing to RudderStack and still records every event in Postgres. With Docker, put
   them in a `.env` file next to `docker-compose.yml` (compose passes them to the app).
3. **Nothing is sent from the browser.** Browser events pass through the app's own `/api/track`, which adds the
   properties only the server knows and sends the event on. So no browser keys, no content-security-policy change, and
   an ad blocker cannot drop events.

The server batches events (up to 20 or every 5 seconds) and a failed delivery is logged, never shown to a customer.

## 2. Connect BigQuery in RudderStack

In RudderStack, add a **BigQuery destination** and connect the source to it. What it asks for, in plain terms:

- **A Google Cloud project**, a **dataset** (RudderStack calls it the namespace; for example `ripplewise_events`), and a
  **Cloud Storage bucket**. RudderStack loads through the bucket.
- **A service account key** whose account can create and write tables in that dataset (BigQuery Data Editor), run load
  jobs (BigQuery Job User) and read and write objects in the bucket (Storage Object Admin on that bucket). Create the
  service account for this only, and give it nothing broader.
- **A sync schedule.** BigQuery receives data in batches on this schedule, not instantly.
- Keep the **`tracks`** table on unless you are sure you do not want one table of everything (see below).

Because data arrives in batches, a test event can take the length of the schedule to show up.

## 3. What lands where

RudderStack creates tables itself, named after what was sent:

| Table | What is in it |
|---|---|
| one per event, such as `creator_invitation_sent` | one row per event: its properties as columns, plus the global properties |
| `tracks` | one row per event of any kind, with only the common columns (who, when, which event: `event_text` is the original name, `event` its table form). **Event properties are not here; they are in the per-event tables** |
| `identifies`, `users` | each person: `user_type` (`member` or `creator`) and `account_id`. `users` keeps the latest. No names, no emails |
| `groups` | accounts and workspaces. For an account: `group_type`, plus the nightly scores (health band, PQA, `products_used`, allowance percentages). For a workspace: `group_type` and `account_id` |
| `rudder_discards` | anything RudderStack could not fit into a table. **Check it after the first live run; it should stay empty** |

Event names become table names in snake_case ("Creator Invitation Sent" is `creator_invitation_sent`); properties become
columns. Every event row carries the global properties: `account_id`, `workspace_id`, `plan_tier`, `trial_day`,
`user_role`, `persona_archetype`, `is_synthetic`, `agent_run_id`, `app_version`, `route`, `ui_theme`, `product`,
`actor_type`. Plus RudderStack's own columns (`id`, `user_id`, `anonymous_id`, `timestamp`, `received_at`,
`original_timestamp`, `sent_at`, and `context_*`).

- **`timestamp` vs `received_at`.** `timestamp` is when the event happened, and for simulated agents that is the agent's
  own clock; `received_at` is when RudderStack got it. Use `timestamp` for behaviour and `received_at` to check loads.
- **People.** A member is their UUID (`user_id`). A creator is `creator_<directory id>` and has no account of their own
  (`actor_type = 'creator'`). An event with no person (the system settling a payout, a visitor on a marketing page) has
  `anonymous_id`: the browser's device id for browser events, `server` for the app's own.
- **Synthetic traffic.** Filter on `is_synthetic` and `agent_run_id` to separate or study agent sessions.
- **Lists.** The two list properties on `Query Saved` (`languages`, `sources`) become one column of JSON text.
- **Privacy.** No emails or names are sent. `route` contains the workspace's URL slug, which comes from the company
  name; treat it as business data, not personal data.

## 4. Rules the data must follow (checked automatically)

RudderStack merges or discards data that breaks these, silently. They are tested on every change
(`lib/analytics/warehouse.test.ts`), and `npm run audit:warehouse` checks events already recorded.

- Two event names must not become the same table, and none may be named like RudderStack's own tables (`tracks`,
  `users`, `groups`, `identifies`, `pages`, `screens`, `aliases`, `rudder_discards`).
- A property must not be named like a column RudderStack already creates on every event table: `id`, `user_id`,
  `anonymous_id`, `timestamp`, `event`, `channel`, `sent_at`, `received_at`, `original_timestamp`, `event_text`,
  `uuid_ts`, or anything starting `context_`. (`channel` was in the plan on three events and is now `delivery_channel`.)
- Two properties must not tidy to the same column, and names are lowercase letters, digits and underscores, at most 63
  characters.
- **A property keeps one type.** If `amount` is a number on one event and text on the next, the warehouse splits or drops
  it. The audit reports any property seen with two types.
- Every property sent must be declared in the tracking plan, so no unplanned column appears. Browser events are filtered
  to the plan's properties before they are sent.

```bash
npm run audit:warehouse                      # every recorded event
npm run audit:warehouse -- --since 2026-10-08   # only newer ones
```

It exits with an error when it finds a problem, so it can run in a pipeline.

## 5. Checking a live run

1. Set the two variables, start the app, sign up and click through a few screens (or run a seeded agent).
2. In RudderStack's live events view for the source, confirm `track`, `identify` and `group` calls arrive, with the
   global properties on tracks and no email or name anywhere.
3. After the BigQuery sync, compare counts for the same window. In BigQuery (adjust the dataset name):

   ```sql
   SELECT event_text AS name, COUNT(*) AS in_bigquery
   FROM `your-project.ripplewise_events.tracks`
   WHERE timestamp >= TIMESTAMP('2026-10-08')
   GROUP BY name ORDER BY name;
   ```

   and against the app's mirror:

   ```sql
   SELECT name, COUNT(*) FROM analytics_events WHERE ts >= '2026-10-08' GROUP BY name ORDER BY name;
   ```

   The two should match, apart from events still in the current batch.
4. Look at `rudder_discards`. Anything in it is an event or property that did not fit; fix the cause, not the table.

An account-level starting point. Properties live in the per-event tables, so this joins two of them and then the
account's latest traits from `groups` (column names such as `group_id` and `health_band` are from RudderStack's
documentation: confirm them on the first live run):

```sql
-- Accounts that both searched for creators and looked at mentions in the last 30 days, with their health band.
WITH recent AS (
  SELECT DISTINCT account_id FROM `your-project.ripplewise_events.creator_search_run`
  WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY) AND NOT is_synthetic
), listening AS (
  SELECT DISTINCT account_id FROM `your-project.ripplewise_events.mentions_feed_viewed`
  WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY) AND NOT is_synthetic
)
SELECT r.account_id, g.health_band
FROM recent r
JOIN listening l USING (account_id)
LEFT JOIN `your-project.ripplewise_events.groups` g ON g.group_id = r.account_id;
```

(Today every sign-up is flagged synthetic, because the environment exists for synthetic users; drop `NOT is_synthetic`
until a deployment has real users.)

## 6. Adding Amplitude, Mixpanel or others later

Add the destination in RudderStack and connect the same source. No change to the app. Two things to know when the time
comes: Mixpanel's account-level (group) analysis is a separate paid feature as far as I know, though `account_id` and
`workspace_id` are on every event so you can still break results down by account; and creators have no account, so they
appear as users named `creator_<id>`, tagged `user_type = creator`.
