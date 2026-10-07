# Analytics: how the product measures itself

The product is instrumented the way a real B2B SaaS would be: one plan for what is tracked, one path every event travels, one identity across tools, and account-level (not just user-level) signals. This page explains the design, shows the queries it supports, and is plain about what is not yet verified.

## 1. The plan is the source of truth

`docs/tracking-plan.json` defines **128 events** (86 sent from the browser, 42 from the server) in 19 areas, plus the properties each one may carry. Typed code is generated from it, so an event or property that is not in the plan fails the build. Events are named "Object Action" in the past tense (`Alert Created`, `Quote Accepted`), and the plan states up front that this is B2B SaaS: there are no cart or purchase events. A plan change is a subscription event (`Plan Upgraded`, `Subscription Started`), not a "purchase".

Every event carries the same global properties: account, workspace, plan tier, trial day, user role, persona archetype, whether the user is synthetic, the agent run, app version, route and theme, plus two that exist for cross-product analysis: `product` and `actor_type` (below). They are filled in on the server from the database, so a screen cannot forget one.

**Product.** The platform has two products behind one login: Social listening and Influencers. Every event has a `product`: `listening`, `influencers`, `creator_portal` (the creator's own page), `hub` (the post-login chooser) or `platform` (shared: auth, billing, onboarding, help). Each event in the plan declares its product; events that fire in more than one (paywalls, errors, theme changes) take the product of the screen they fired on, and a paywall raised from a server action takes it from its trigger (`outreach_quota` is Influencers). The rule is one small tested function (`lib/analytics/product.ts`) used by both the browser and the server, so Amplitude and the warehouse mirror always agree.

## 2. How an event travels

- **Browser events** go to Amplitude directly (when a key is set) *and* to our own `/api/track`, which drops any property the plan does not list for that event, records the event, and forwards it per the plan. A `forwarded` flag stops Amplitude counting it twice.
- **Server events** (sign-up completed, contract signed, alert triggered, and so on) are recorded where they happen, so they cannot be lost to an ad blocker or a closed tab.
- **Every event is also written to a Postgres table** (`analytics_events`): the warehouse feed, queryable today.
- **GA4 gets 10 funnel events only**, renamed to GA4 conventions (`sign_up`, `view_pricing`, `generate_lead`, `demo_booked`, `contract_signed`, and so on) and with almost nothing attached: plan tier, the synthetic flag and the account ID.
- Recording an event never throws into the request that caused it. An analytics failure is logged, not shown to a customer.

## 3. Identity and privacy

The same user UUID identifies a person in Amplitude and GA4. Account and workspace are Amplitude groups, set on login and on workspace switch, and the identity is reset on logout. **Emails and names are never sent to analytics**, and the plan whitelist means a stray property cannot slip through. Account-level properties pushed from the nightly job are scores and counts only.

**Creators are a second kind of actor.** A creator answering an invitation has no account, so their events (`Creator Portal Viewed`, `Creator Invitation Answered`, `Creator Content Submitted`) carry `actor_type: creator` and no member id. In Amplitude they appear as a stable synthetic user, `creator_<directory id>`, with a `user_type: creator` property, and they are attributed to the inviting brand's account and workspace groups. That gives the funnel invited, opened, answered, delivered, paid as one journey per creator, while a creator can never be counted as an active member of an account: the activity scores ignore events without a member id. The creator id is a synthetic directory number, not personal data.

`actor_type` is `member` (a signed-in person), `creator`, or `anonymous` (marketing visitors, signed-out screens, and the audience clicking a creator's tracking link or the brand's site reporting a conversion).

## 4. From a lead to behaviour in the product

Marketing questions need the lead and the product to be joined. At sign-up the product stores the GA client and session IDs, campaign tags, click ID and referrer on the user row. The lead events (`Marketing Page Viewed`, `Pricing Page Viewed`, `Sign Up Completed`, `Sales Contact Requested`, `Demo Booked`, `Contract Signed`) go to GA4; everything after sign-up lives in Amplitude and the warehouse. Joining on the stored attribution is what connects "this campaign" to "these accounts became healthy, or churned".

## 5. Questions it can answer today

These run against the mirror table (they were run against the development database; the numbers there are automated test traffic, so none are findings).

```sql
-- Funnel: distinct users reaching each step
WITH steps(n, name) AS (VALUES (1,'Sign Up Completed'),(2,'Email Verified'),
  (3,'Onboarding Completed'),(4,'Query Saved'),(5,'Alert Created'),(6,'Subscription Started'))
SELECT s.n, s.name, count(DISTINCT e.user_id) AS users
FROM steps s LEFT JOIN analytics_events e ON e.name = s.name AND e.user_id IS NOT NULL
GROUP BY s.n, s.name ORDER BY s.n;

-- Account level: which paywalls do accounts hit, and did those accounts later subscribe?
SELECT props->>'paywall_trigger' AS trigger, count(DISTINCT account_id) AS accounts,
       count(DISTINCT account_id) FILTER (WHERE account_id IN
         (SELECT account_id FROM analytics_events WHERE name = 'Subscription Started')) AS later_subscribed
FROM analytics_events WHERE name = 'Paywall Viewed' AND account_id IS NOT NULL
GROUP BY 1 ORDER BY accounts DESC;

-- Experiment: exposure by variant, and who then asked to talk to sales
WITH x AS (SELECT user_id, props->>'variant' AS variant, min(ts) AS t FROM analytics_events
  WHERE name = 'Experiment Exposed' AND props->>'flag_key' = 'sales_cta_copy' AND user_id IS NOT NULL GROUP BY 1,2)
SELECT variant, count(*) AS exposed,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events c WHERE c.user_id = x.user_id
         AND c.name = 'Sales Contact Requested' AND c.ts >= x.t)) AS contacted
FROM x GROUP BY variant;
```

**A lesson the data already teaches.** The time between sign-up and `Query Saved` comes out at about zero minutes. That is not a fast product: onboarding saves the first query for the user. So `Query Saved` is a poor *activation* event, and measuring activation against it would flatter the product. A better definition needs something the person chose to do after setup: a first alert, a first dashboard, a second visit, or a teammate invited. The Home checklist already emits `Checklist Item Completed` for exactly these, which is why the plan has it.

## 6. Account-level signals

B2B outcomes happen to accounts, not people, so the nightly job (`jobs/pqa.ts`) scores every account and keeps one row per account per day (`account_scores`), which gives the warehouse a time series.

- **PQA (product-qualified account), 0–100:** breadth of use, people on seats, quota pressure, repeated paywalls, activity days, and Influencers depth (three or more active campaigns, creator-profile and invitation allowances at 80%). Using both products is a signal on its own (+10). Accounts already on Enterprise, already talking to sales, or locked are never leads. At 60 or more the owner sees a dismissible card and sales gets one email (at most once in 30 days).
- **Health, 0–100, in three bands:** recency, breadth of features (five: queries, alerts, dashboards, scheduled reports, and Influencers, so an account that lives in Influencers reads as using what it pays for), people active, minus risks such as a failed payment or a scheduled cancellation. Admins see their own band and the reasons.
- Both are pushed to Amplitude as properties of the `account` group, so product analytics can be cut by health band or plan. The group also carries the product mix: `products_used` (`listening`, `influencers`, both, or `none`), `uses_both_products`, `creator_lists`, `active_campaigns`, and the creator-profile and invitation allowance percentages. That makes cross-product cohorts a filter, not a join: for example, accounts that started in listening and added Influencers, and whether they retain better.

Activity and recency already counted every member event, so Influencers work keeps an account "active"; what the earlier rules missed was breadth and depth.

Each score is a short list of explainable rules (`lib/scoring/score.ts`) with tests, not a model. For a product this size, being able to say *why* an account scored 64 matters more than a point of accuracy.

## 7. Experiments

Flags (`lib/flags`) assign a variant by hashing the flag and the person, so assignment is stable, needs no lookup and can be checked offline (the split is tested to be close to its weights). `Experiment Exposed` fires once per session when the variant is on screen, not when it is merely assigned, so the denominator is people who actually saw it. The first experiment changes the wording on the sales card's button.

## 8. Synthetic traffic

The product is built to be used by autonomous agents. Every event says whether its user is synthetic and carries the agent run, and users carry a persona archetype, so agent traffic can be filtered out of (or studied separately from) human analysis.

## What is not verified or not built

- **No analytics keys are set here**, so I checked events in the Postgres mirror, not in Amplitude's debugger or GA4's DebugView. The definition of done asks for the Amplitude check; it still needs doing with a real project key.
- **The mirror is not loaded into BigQuery yet.** The table exists and is shaped for it. A batch loader, the Amplitude Export API pull and GA4's native BigQuery export are the intended feeds and are not wired.
- **A separate GA4 property for synthetic traffic is a deployment choice** (point the measurement ID at it), not something the code switches.
- Today every sign-up is flagged synthetic, because the whole environment exists for synthetic users; the flag only becomes useful once a deployment also has human users.
- Only the `account` group gets properties; the `workspace` group is set but carries none.
- One experiment, with no significance testing built in.
