// Reading the discovery table the way a person does, and the rules that turn it into choices. No browser here, so it
// can be tested directly.
import type { Candidate, SearchPlan } from "./types";

/** "2.1M" → 2100000, "592K" → 592000, "980" → 980. */
export function parseCompact(s: string): number {
  const m = /([\d.,]+)\s*([KMB])?/i.exec(s.trim());
  if (!m) return 0;
  const n = Number(m[1]!.replace(/,/g, ""));
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(n * mult);
}
export const parseUsd = (s: string) => Number(s.replace(/[^0-9.]/g, "")) || 0;

/** The visible text of one creator row: its link, handle line and table cells. */
export interface RawRow {
  href: string;
  name: string;
  handleLine: string;
  cells: string[]; // niche, followers, engagement, avg views, authenticity, brand safety, rate, ...
}

export function parseRow(r: RawRow, readsAuthenticity: boolean): Candidate | null {
  const id = Number(r.href.split("/").pop());
  if (!Number.isInteger(id) || r.cells.length < 7) return null;
  const [niche, followers, engagement, views, auth, safety, rate] = r.cells as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const handle = /@([\w.]+)/.exec(r.handleLine)?.[1] ?? "";
  const platform = (r.handleLine.split("·")[1] ?? "").trim().toLowerCase();
  return {
    id,
    name: r.name,
    handle,
    platform,
    niche: niche.trim().toLowerCase(),
    followers: parseCompact(followers),
    engagement: Number.parseFloat(engagement),
    avgViews: parseCompact(views),
    authenticity: readsAuthenticity ? Number(/\d+/.exec(auth)?.[0] ?? NaN) : null,
    brandSafe: /^safe$/i.test(safety.trim()),
    rateUsd: parseUsd(rate),
  };
}

/** Which platform and niche a brief means, from the names the product itself uses. */
export function planFromBrief(brief: string, platforms: string[], niches: string[]): SearchPlan {
  const text = ` ${brief.toLowerCase()} `;
  const hit = (xs: string[]) => xs.find((x) => text.includes(` ${x.toLowerCase()}`));
  const platform = hit(platforms) ?? null;
  // A brief about coffee or lattes is a food-and-drink brief; the directory calls that niche "food".
  const alias: Record<string, string> = { coffee: "food", latte: "food", restaurant: "food" };
  const niche = hit(niches) ?? Object.entries(alias).find(([w]) => text.includes(w))?.[1] ?? null;
  return {
    platform,
    niche,
    rationale: `brief mentions ${platform ?? "no platform"} and ${niche ?? "no niche"}`,
  };
}

/** Expected engaged views: the audience that actually watches, weighted by how real the audience looks. */
export function score(c: Candidate): number {
  const trust = c.authenticity === null ? 0.7 : c.authenticity / 100;
  return c.avgViews * (c.engagement / 100) * trust;
}

export function pickBest(
  candidates: Candidate[],
  wanted: number,
  o: { sizeBias: boolean; budgetUsd: number },
): Candidate[] {
  const pool = candidates.filter((c) => c.brandSafe);
  const ranked = [...pool].sort((a, b) =>
    o.sizeBias ? b.followers - a.followers : score(b) - score(a),
  );
  const cheapest = [...pool].map((c) => c.rateUsd).sort((a, b) => a - b);
  const picked: Candidate[] = [];
  let ask = 0;
  for (const c of ranked) {
    if (picked.length === wanted) break;
    if (!o.sizeBias) {
      // A careful pick leaves room in the budget for the others it still has to find; a size-chaser doesn't look.
      const slotsAfter = wanted - picked.length - 1;
      const reserve = cheapest.slice(0, slotsAfter).reduce((a, b) => a + b, 0);
      if (ask + c.rateUsd + reserve > o.budgetUsd) continue;
    }
    picked.push(c);
    ask += c.rateUsd;
  }
  return picked;
}

/** What to offer: a budget-aware agent splits what is left; one who doesn't track it offers the asking rate. */
export function offerFor(
  c: Candidate,
  o: { tracksBudget: boolean; remainingUsd: number; slotsLeft: number },
): number {
  if (!o.tracksBudget) return c.rateUsd;
  const share = Math.floor(o.remainingUsd / Math.max(o.slotsLeft, 1));
  return Math.max(1, Math.min(c.rateUsd, share));
}
