# AI features (M10)

**Provider.** `lib/ai/provider.ts` defines `AiProvider`. Ripplewise ships a *simulated* provider: deterministic and extractive, it only restates the mentions it is given, and every answer says so ("Simulated AI…"). No API key and no network. A real provider implements the same one-method interface and is returned from `getProvider()`.

**Evidence.** `lib/ai/retrieve.ts` reads the same visible, non-spam, override-aware mentions as the feed (reusing `FROM`, `SPAM_SQL`, `EFFECTIVE_SENTIMENT`). Ground-truth columns are never read. Questions are reduced to search terms, a sentiment lean and a look-back window (clamped to the plan's history). If no term matches, it widens to the most visible mentions and says so in the answer's scope line.

**Citation rule.** An answer is only returned if it cites at least 3 distinct mentions that were actually in its evidence (`[n]` markers are checked, unknown numbers don't count). Otherwise it is withheld and refunded.

**Allowance.** One counter per account per month (`usage_counters`, metric `ai_questions`), limit `askAiPerMonth`. A unit is taken with a single conditional `UPDATE` (no overspend under concurrency) and handed back on any failure: no queries, too little evidence, provider error, invalid answer. At the limit the UI opens the standard paywall (`ai_quota`); the largest plan is told the allowance resets on the 1st. Read-only (locked/cancelled) accounts can't use AI.

**Surfaces.** Ask AI (`/w/[ws]/ask`, with history), crisis-room "Summarize this room" and "Explain the peak", and the query builder's "Describe it in words" (drafted Boolean is validated with the real parser/linter and placed in the Advanced editor for review).

**Events.** `Ask AI Question Submitted`, `Ask AI Citation Opened`, `AI Summary Generated` (surface `crisis_room` | `peak_explanation`), `AI Query Generated`.
