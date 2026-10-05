import type { MentionRow } from "./generate";
import type { Brand } from "./generate";
import type { Story } from "./stories";

/** Streaming accumulator used by the seed CLI and tests to verify acceptance criteria. */
export class Stats {
  total = 0;
  spam = 0;
  sarcastic = 0;
  agree = 0;
  nonSpam = 0;
  agreeNonSpam = 0;
  neutralErrors = 0;
  errors = 0;
  naiveMatches = 0;
  naiveSpam = 0;
  naiveOffTopic = 0;
  byLang = new Map<string, { n: number; agree: number }>();
  bySource = new Map<number, number>();
  /** crisis story id -> [day-index -> {n, neg}] */
  crisisDays = new Map<number, Map<number, { n: number; neg: number }>>();
  brandTotals = new Map<number, number>();
  hash = 0x811c9dc5;

  constructor(
    private brandsById: Map<number, Brand>,
    private opts: { startMs: number },
  ) {}

  add(m: MentionRow): void {
    this.total++;
    this.brandTotals.set(m.brandId ?? 0, (this.brandTotals.get(m.brandId ?? 0) ?? 0) + 1);
    if (m.isSpam) this.spam++;
    if (m.isSarcastic) this.sarcastic++;
    const ok = m.sentimentPred === m.sentimentTrue;
    if (ok) this.agree++;
    else {
      // Bias toward neutral is measured on errors where the truth was not neutral.
      if (m.sentimentTrue !== "neutral") {
        this.errors++;
        if (m.sentimentPred === "neutral") this.neutralErrors++;
      }
    }
    if (!m.isSpam) {
      this.nonSpam++;
      if (ok) this.agreeNonSpam++;
    }
    const l = this.byLang.get(m.lang) ?? { n: 0, agree: 0 };
    l.n++;
    if (ok) l.agree++;
    this.byLang.set(m.lang, l);
    this.bySource.set(m.sourceId, (this.bySource.get(m.sourceId) ?? 0) + 1);

    // A naive query is just the brand's short name, case-insensitive.
    const brand = this.brandsById.get(m.brandId ?? -1);
    const lower = m.text.toLowerCase();
    const matched = brand ? lower.includes(brand.short.toLowerCase()) : false;
    if (matched) {
      this.naiveMatches++;
      if (m.isSpam) this.naiveSpam++;
    }
    if (m.brandId === null) this.naiveOffTopic++;

    if (m.crisisId !== null) {
      const day = Math.floor((m.publishedAt - this.opts.startMs) / 86_400_000);
      const days = this.crisisDays.get(m.crisisId) ?? new Map();
      const d = days.get(day) ?? { n: 0, neg: 0 };
      d.n++;
      if (m.sentimentTrue === "negative") d.neg++;
      days.set(day, d);
      this.crisisDays.set(m.crisisId, days);
    }
    // order-independent content hash for reproducibility checks
    this.hash = (this.hash ^ (Math.imul(m.id, 2654435761) + m.text.length + m.publishedAt)) >>> 0;
  }

  report(stories: Story[]) {
    const crises = stories.filter((s) => s.type === "crisis");
    const quarterKey = (ms: number) =>
      `${new Date(ms).getUTCFullYear()}Q${Math.floor(new Date(ms).getUTCMonth() / 3) + 1}`;
    const perBrandQuarter = new Map<string, number>();
    for (const c of crises) {
      const k = `${c.brandIdx}:${quarterKey(c.startMs)}`;
      perBrandQuarter.set(k, (perBrandQuarter.get(k) ?? 0) + 1);
    }
    // Peak-day vs first-day negative share per crisis (only crises with enough posts).
    const lifts: number[] = [];
    for (const [, days] of this.crisisDays) {
      const sorted = [...days.entries()].sort((a, b) => a[0] - b[0]);
      const peak = sorted.reduce((best, cur) => (cur[1].n > best[1].n ? cur : best), sorted[0]!);
      if (peak[1].n >= 50) lifts.push(peak[1].neg / peak[1].n);
    }
    lifts.sort((a, b) => a - b);
    return {
      total: this.total,
      spamShare: this.spam / this.total,
      naiveSpamShare: this.naiveMatches ? this.naiveSpam / this.naiveMatches : 0,
      naiveMatches: this.naiveMatches,
      offTopic: this.naiveOffTopic,
      sarcasmShare: this.sarcastic / this.total,
      sentimentAgreement: this.agree / this.total,
      sentimentAgreementNonSpam: this.agreeNonSpam / this.nonSpam,
      errorsToNeutral: this.errors ? this.neutralErrors / this.errors : 0,
      agreementByLang: Object.fromEntries(
        [...this.byLang].map(([k, v]) => [k, +(v.agree / v.n).toFixed(3)]),
      ),
      crisesPlanned: crises.length,
      brandQuartersWithCrisis: perBrandQuarter.size,
      crisisPeakNegShareMedian: lifts.length ? lifts[Math.floor(lifts.length / 2)]! : null,
      contentHash: this.hash.toString(16),
    };
  }
}
