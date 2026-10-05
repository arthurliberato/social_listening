import { describe, expect, it } from "vitest";
import { AuthorPool } from "./authors";
import { HISTORY_START, WORLD_END } from "./config";
import { cascade } from "./hawkes";
import { WORLD_BRANDS, generateBrand, planAll, type MentionRow } from "./generate";
import { rngFor } from "./rng";
import { seed } from "./seed";

const small = { out: "unused", seed: 7, authors: 30_000, scale: 1, brands: 5, endMs: WORLD_END };

describe("determinism", () => {
  it("same seed gives identical content; different seed does not", async () => {
    const a = await seed(small, false);
    const b = await seed(small, false);
    const c = await seed({ ...small, seed: 8 }, false);
    expect(a.report.contentHash).toBe(b.report.contentHash);
    expect(a.report.total).toBe(b.report.total);
    expect(c.report.contentHash).not.toBe(a.report.contentHash);
  });
});

describe("stories", () => {
  it("plans at least one crisis per brand per calendar quarter", () => {
    const opts = {
      seed: 7,
      pool: new AuthorPool(7, 10),
      startMs: HISTORY_START,
      endMs: WORLD_END,
      volumeScale: 1,
    };
    const plans = planAll(opts, WORLD_BRANDS);
    const quarters = new Set<string>();
    for (let t = HISTORY_START; t < WORLD_END; t += 86_400_000 * 30) {
      const d = new Date(t);
      quarters.add(`${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`);
    }
    for (const b of WORLD_BRANDS) {
      const have = new Set(
        plans
          .get(b.id)!
          .filter((s) => s.type === "crisis")
          .map((s) => {
            const d = new Date(s.startMs);
            return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
          }),
      );
      for (const q of quarters) expect(have.has(q), `${b.name} ${q}`).toBe(true);
    }
  });
});

describe("corpus properties", () => {
  it("meets acceptance thresholds", async () => {
    const { report } = await seed(small, false);
    expect(report.sentimentAgreement).toBeGreaterThan(0.66);
    expect(report.sentimentAgreement).toBeLessThan(0.74);
    expect(report.agreementByLang.en).toBeGreaterThan(report.agreementByLang.es!);
    expect(report.errorsToNeutral).toBeGreaterThan(0.5); // errors lean neutral
    expect(report.naiveSpamShare).toBeGreaterThanOrEqual(0.05);
    expect(report.crisisPeakNegShareMedian).toBeGreaterThan(0.45);
    expect(report.offTopic).toBeGreaterThan(0); // homonym noise exists
  });

  it("produces threaded, bursty, imperfect data", () => {
    const opts = {
      seed: 7,
      pool: new AuthorPool(7, 30_000),
      startMs: HISTORY_START,
      endMs: WORLD_END,
      volumeScale: 1,
    };
    const plans = planAll(opts, WORLD_BRANDS);
    const rows: MentionRow[] = [];
    generateBrand(opts, WORLD_BRANDS[0]!, plans, (m) => rows.push(m));
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.size).toBe(rows.length); // unique ids
    for (const r of rows) if (r.parentId !== null) expect(ids.has(r.parentId)).toBe(true);
    // logo-only mentions: brand detected in the image but absent from the text
    const b = WORLD_BRANDS[0]!;
    expect(
      rows.some(
        (r) => r.detectedLogos.length && !r.text.toLowerCase().includes(b.short.toLowerCase()),
      ),
    ).toBe(true);
    // volume spikes well above the median day
    const perDay = new Map<number, number>();
    for (const r of rows)
      perDay.set(
        Math.floor(r.publishedAt / 86_400_000),
        (perDay.get(Math.floor(r.publishedAt / 86_400_000)) ?? 0) + 1,
      );
    const v = [...perDay.values()].sort((x, y) => x - y);
    expect(v[v.length - 1]! / v[Math.floor(v.length / 2)]!).toBeGreaterThan(10);
    // all hosts fictitious
    expect(rows.every((r) => new URL(r.url).hostname.endsWith(".ripplewise.test"))).toBe(true);
  });

  it("cascades are heavy-tailed", () => {
    const rng = rngFor(1, "casc");
    const sizes = Array.from(
      { length: 4000 },
      () => cascade(rng, Math.round(rng.pareto(25, 0.85))).length,
    ).sort((a, b) => a - b);
    expect(sizes[Math.floor(sizes.length / 2)]).toBeLessThanOrEqual(2);
    expect(sizes[sizes.length - 1]).toBeGreaterThan(50);
  });
});
