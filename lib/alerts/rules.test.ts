import { describe, expect, it } from "vitest";
import {
  backtest,
  denseBuckets,
  describeRule,
  evaluate,
  HOUR_MS,
  parseParams,
  type Bucket,
  type Observation,
} from "./rules";

const hours = (n: number, count: number, negative = 0, maxReach = 0): Bucket[] =>
  Array.from({ length: n }, (_, i) => ({ t: i * HOUR_MS, count, negative, maxReach }));
const obs = (o: Partial<Observation> & { baseline?: Bucket[] }): Observation => ({
  count: 0,
  negative: 0,
  maxReach: 0,
  baseline: hours(48, 10, 1),
  ...o,
});
const vol = { multiple: 3, minVolume: 20 };
const sent = { negativeShare: 0.4, minVolume: 15 };

describe("volume spike", () => {
  it("fires at the multiple and the volume floor, not below", () => {
    expect(evaluate("volume_spike", vol, obs({ count: 30 })).fired).toBe(true);
    expect(evaluate("volume_spike", vol, obs({ count: 29 })).fired).toBe(false); // 2.9x
    expect(evaluate("volume_spike", { multiple: 3, minVolume: 50 }, obs({ count: 40 })).fired).toBe(
      false,
    );
  });
  it("grades severity by how far past the threshold it is", () => {
    expect(evaluate("volume_spike", vol, obs({ count: 40 })).severity).toBe("warning");
    expect(evaluate("volume_spike", vol, obs({ count: 70 })).severity).toBe("critical");
  });
  it("needs a day of history before judging", () => {
    expect(evaluate("volume_spike", vol, obs({ count: 500, baseline: hours(10, 10) })).fired).toBe(
      false,
    );
  });
  it("treats a silent baseline as 1/hour so a quiet brand can still alert", () => {
    expect(evaluate("volume_spike", vol, obs({ count: 25, baseline: hours(48, 0) })).fired).toBe(
      true,
    );
  });
});

describe("sentiment drop", () => {
  it("must beat the threshold and be clearly worse than usual", () => {
    expect(evaluate("sentiment_drop", sent, obs({ count: 30, negative: 15 })).fired).toBe(true);
    expect(evaluate("sentiment_drop", sent, obs({ count: 30, negative: 11 })).fired).toBe(false); // 37%
    // A permanently negative topic (usually 45%) doesn't alert at 48%.
    const grumpy = hours(48, 10, 4.5);
    expect(
      evaluate("sentiment_drop", sent, obs({ count: 30, negative: 14.5, baseline: grumpy })).fired,
    ).toBe(false);
  });
  it("ignores tiny samples", () => {
    expect(evaluate("sentiment_drop", sent, obs({ count: 5, negative: 5 })).fired).toBe(false);
  });
});

describe("influencer", () => {
  it("fires on a single large-reach mention without needing history", () => {
    const v = evaluate(
      "influencer",
      { minReach: 100_000 },
      obs({ maxReach: 250_000, baseline: [] }),
    );
    expect(v.fired).toBe(true);
    expect(evaluate("influencer", { minReach: 100_000 }, obs({ maxReach: 99_999 })).fired).toBe(
      false,
    );
  });
});

describe("params", () => {
  it("applies defaults and rejects out-of-range thresholds", () => {
    expect(parseParams("volume_spike", {})).toEqual({ ok: true, params: vol });
    expect(parseParams("volume_spike", { multiple: 1 }).ok).toBe(false);
    expect(parseParams("sentiment_drop", { negativeShare: 1.5 }).ok).toBe(false);
    expect(parseParams("influencer", { minReach: 5 }).ok).toBe(false);
  });
  it("describes a rule in plain words", () => {
    expect(describeRule("volume_spike", vol)).toBe(
      "≥ 3× usual hourly volume and at least 20 mentions",
    );
  });
});

describe("backtest", () => {
  it("counts an episode once however many hours it lasts", () => {
    const h = hours(100, 10);
    for (const i of [60, 61, 62, 80]) h[i] = { ...h[i]!, count: 60 };
    const r = backtest("volume_spike", vol, h);
    expect(r.fires).toBe(2);
    expect(r.at[0]).toBe(80 * HOUR_MS); // newest first
    expect(r.skippedHours).toBe(24);
  });
  it("reports zero on a flat series", () => {
    expect(backtest("volume_spike", vol, hours(100, 10)).fires).toBe(0);
  });
});

describe("denseBuckets", () => {
  it("fills empty hours with zeros", () => {
    const d = denseBuckets(
      [{ t: 2 * HOUR_MS, count: 5, negative: 1, maxReach: 9 }],
      0,
      4 * HOUR_MS,
    );
    expect(d.map((b) => b.count)).toEqual([0, 0, 5, 0]);
  });
});
