// Spike detection on a daily series: rolling median + MAD z-score with a minimum-volume floor.
// Product-side (what the app can observe), deliberately independent of the generator's ground truth.

export interface Point {
  day: string;
  value: number;
}
export interface Spike {
  day: string;
  value: number;
  baseline: number;
  multiple: number;
  z: number;
}

export interface SpikeOptions {
  /** Trailing days that define "normal". */
  window?: number;
  /** Robust z-score threshold. */
  z?: number;
  /** Must be at least this multiple of the baseline median. */
  minMultiple?: number;
  /** Ignore spikes smaller than this absolute volume (noise floor). */
  minVolume?: number;
  /** Return at most this many, biggest first. */
  top?: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function detectSpikes(series: Point[], opts: SpikeOptions = {}): Spike[] {
  const { window = 14, z: zMin = 3.5, minMultiple = 2, minVolume = 20, top = 5 } = opts;
  const flagged: Spike[] = [];
  for (let i = 3; i < series.length; i++) {
    const hist = series.slice(Math.max(0, i - window), i).map((p) => p.value);
    const base = median(hist);
    const mad = median(hist.map((v) => Math.abs(v - base))) * 1.4826;
    const v = series[i]!.value;
    const z = (v - base) / Math.max(mad, Math.sqrt(Math.max(base, 1)), 1);
    if (v >= minVolume && v >= minMultiple * Math.max(base, 1) && z >= zMin) {
      flagged.push({
        day: series[i]!.day,
        value: v,
        baseline: base,
        multiple: v / Math.max(base, 1),
        z,
      });
    }
  }
  // Consecutive flagged days are one episode: keep its peak.
  const peaks: Spike[] = [];
  let group: Spike[] = [];
  const flush = () => {
    if (group.length) peaks.push(group.reduce((a, b) => (b.value > a.value ? b : a)));
    group = [];
  };
  const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  for (const s of flagged) {
    if (group.length && dayNum(s.day) - dayNum(group[group.length - 1]!.day) > 1) flush();
    group.push(s);
  }
  flush();
  return peaks.sort((a, b) => b.value - a.value).slice(0, top);
}
