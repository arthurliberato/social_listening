// Comparing creators side by side: which ids to compare, the derived numbers, and which creator is best on each
// measure. Pure, so the rules can be tested without a database or a browser.

/** A comparison needs at least two creators; the plan decides the most (see PLANS[tier].compareSize). */
export const COMPARE_MIN = 2;
const HARD_CAP = 12;

export function parseCompareIds(
  raw: string | string[] | undefined,
  max: number,
): { ids: number[]; truncated: boolean } {
  const parts = (Array.isArray(raw) ? raw.join(",") : (raw ?? "")).split(",");
  const seen = new Set<number>();
  for (const p of parts) {
    const n = Number(p.trim());
    if (Number.isInteger(n) && n > 0 && n < 2_000_000_000) seen.add(n);
    if (seen.size >= HARD_CAP) break;
  }
  const all = [...seen];
  return { ids: all.slice(0, max), truncated: all.length > max };
}

export const compareHref = (ws: string, ids: number[]) =>
  `/w/${ws}/creators/compare?ids=${ids.join(",")}`;

/** What a thousand views cost at the creator's rate: the fairest single number for comparing across sizes. */
export function costPer1kViews(rateUsd: number, avgViews: number): number | null {
  return avgViews > 0 ? Math.round((rateUsd / avgViews) * 1000 * 100) / 100 : null;
}

/** Which measure is better when it is higher, lower, or has no better direction (it's a fact, not a score). */
export type Better = "high" | "low" | null;

/**
 * The positions holding the best value (ties share it). Nothing is marked when fewer than two creators have a value
 * or when they are all equal: a "best" among equals would only mislead.
 */
export function bestOf(values: (number | null)[], better: Better): number[] {
  if (!better) return [];
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return [];
  const target = better === "high" ? Math.max(...present) : Math.min(...present);
  if (present.every((v) => v === target)) return [];
  return values.flatMap((v, i) => (v === target ? [i] : []));
}

export interface Measure<T> {
  key: string;
  label: string;
  better: Better;
  value: (c: T) => number | null;
  show: (v: number | null) => string;
}
