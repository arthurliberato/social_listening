# Synthetic corpus (M1)

Everything is generated offline and deterministically by `datagen/` — no scraping, no real brands,
people, handles or URLs (hosts end in `.ripplewise.test`).

```
npx tsx datagen/seed.ts --out data/corpus      # ~1 min, ~230 MB, ~4.1M mentions (default --scale 1.4)
npx tsx db/load.ts --dir data/corpus           # migrate + COPY + build indexes
npm test                                       # acceptance checks (small scale)
```

Same `--seed` ⇒ identical output (`manifest.json` carries a content hash). The window is 30 months:
24 months of history to `2026-10-01`, then 6 "future" months the release job reveals on the sim clock.

## Model

- **World:** 40 fictitious brands in 6 verticals. Ten share their short name with another sense
  (plant, network vendor, cloud, wind…), so naive queries need exclusions.
- **Authors:** 200k, power-law followers; ~3% bots, ~1% journalists, ~2% influencers; six languages.
- **Baseline volume:** size × weekday × slow trend × seasonal windows × noise, with a diurnal curve in
  each author's timezone.
- **Cascades:** Hawkes-style branching (`hawkes.ts`): reach-driven, decaying over hours, heavy-tailed.
- **Stories:** launches, campaigns, news, memes, seasonal windows, and **≥1 crisis per brand per calendar
  quarter** (trigger post → influencer pickup → news pickup; peak ≈ 10–50× baseline; negative share rises
  from ~17% to 50–70%). Volume decays faster than sentiment, which lingers (3–10 day half-life).
  A peer's crisis lifts competitors' share of voice slightly.
- **Noise:** classifier agrees with truth ~70% (worse for sarcasm and non-English; errors lean neutral);
  ~5–7% spam (jobs, giveaways, crypto, coupons) and homonym posts that match naive queries; logo-only
  image posts that name no brand in text.

## Ground truth — never expose in the product

`sentiment_true`, `is_spam`, `is_sarcastic`, `brand_id`, `crisis_id` exist so analysts can score whether
agents (and the product's own heuristics) find the truth. Product surfaces use `sentiment_pred` only.
User edits go to `mention_overrides` and never mutate `mentions`.

## Deferred

An offline, cached LLM paraphrase pass for text variety (templates are the deterministic baseline).
