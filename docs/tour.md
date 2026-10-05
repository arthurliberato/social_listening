# A guided tour

About 20 minutes, in the order a new customer would meet the product. Everything here is exercised by an end-to-end test, so if a step doesn't behave as described, that is a bug worth reporting. Screens are in [docs/screenshots](screenshots).

**Setup:** follow the development steps in the README, then open http://localhost:3000. Mail never leaves the app: open `/inbox` any time to read what the product "sent" you. The background jobs (collecting mentions, alerts, reports) run inside the dev server.

## 1. Before signing up (3 min)

- **`/pricing`**: four plans, monthly or yearly, and an Enterprise tile that goes to "Talk to sales" instead of a price. *What it shows: the plan ladder is defined once and drives every limit and lock you meet later.*
- **`/login`**: password, "email me a login link", and "Continue with Northstar ID". Northstar is a simulated provider and says so on its own screen. *Try:* five wrong passwords. The sixth attempt is refused for 15 minutes, with a way out (reset your password). The same happens for an email that has no account, so the lock never reveals who is registered.

## 2. Sign up and get to a first insight (4 min)

- Sign up, then open `/inbox` and follow the verification link.
- The five-step onboarding creates your first query from your brand and shows an estimate before saving. Use a fictitious brand from the data (for example *Skyharbor Air*, *Latte Lane* or *Orbit Lace*). *What it shows: the first query already excludes job-ad noise, and the estimate means you know roughly what you will get.*
- **Home** shows a "Get set up" checklist (query, exclusion, alert, dashboard, teammate) that ticks as you do things, plus headline numbers.

## 3. Understand the conversation (4 min)

- **Mentions:** every filter is in the URL, so any view can be shared. Try `j`/`k` to move, `x` to select, `t` to tag, `s` then a letter to set the sentiment (`s` `n` for neutral), `f` to flag. A line says how many likely-spam mentions are hidden, with a "Show" link: spam is hidden by default, not deleted. Changing a mention's sentiment stores your correction for your workspace only.
- **Dashboards:** create one from the "Brand health" template. Every chart has a "view as table" button, and every widget menu has "Open in Mentions": the count you land on matches the number on the tile. In edit mode you can move and resize widgets from the menu or the handle's arrow keys, so nothing needs a mouse drag.
- **Topics & Trends and Authors:** what is growing compared with the period before, and who is driving the conversation. Watch an author; add either page to a report with "Add to report".

## 4. Be told, and respond (4 min)

- **Alerts:** build a "volume spike" rule. While you tune the thresholds, the screen shows how often the rule would have fired over the last 30 days, so you can avoid a rule that cries wolf. Choosing a sentiment alert on the trial plan opens a paywall that can be closed with Esc, with equal-weight "Not now".
- **Crisis rooms** are on Growth and above. On the trial plan the page explains that and offers the upgrade instead of a dead button. On a higher plan, a fired alert opens a room with an hourly chart, the loudest voices, a response plan and a drafted stakeholder update. Use the demo account in `docs/screenshots` (made by `npm run screenshots`) to see one with a real spike in it.
- **Ask AI:** on the trial you get 10 questions a month. Every answer cites at least three real mentions and links to each. If it can't, the answer is withheld and the question isn't counted. The AI here is a labelled simulation.

## 5. Send it to someone (2 min)

- **Reports:** build one from a template, then "Email me a copy now". The message lands in `/inbox` with a tracked open and click. Scheduling is a paid feature; on the trial it shows why.

## 6. Run it as a team and a business (3 min)

- **Settings → Members:** invite someone as Viewer, Editor or Client viewer. Seats are counted once per person; client viewers are free and only see dashboards and reports. Log in as each to see the role matrix. **Settings → Audit log** (Enterprise) records who changed what; it records from day one on every plan.
- **Settings → Billing:** upgrade with a test card, downgrade, then start a cancellation: it takes three steps or fewer, a retention offer appears at most once, and nothing is pre-ticked. To see time-based behaviour (trial end, grace period, renewal, a failed payment), start the app with `SIM_CLOCK_OFFSET_MS` set to a number of milliseconds to fast-forward the clock.
- **Settings → Usage** shows every limit as a meter, and, for owners and admins, an account health panel.
- **Talk to sales:** request a quote (or book a demo). About ten minutes later the simulated sales team's quote arrives in `/inbox`. Accept and sign it as an owner or admin and the account becomes Enterprise immediately.

## What to look for

- The same number never changes between screens.
- Every limit has a visible reason and a way forward.
- Nothing is silently dropped (spam, withheld AI answers, locked features) and each says why.
- Every simulated thing is labelled where you meet it.
