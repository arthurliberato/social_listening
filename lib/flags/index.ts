// Feature flags and experiments. Assignment is a pure function of (flag, person): hash them, take a
// bucket, walk the weighted variants. No lookup table, so a person always sees the same variant, on
// the server and in tests, and the split can be checked offline.
import { createHash } from "node:crypto";

export const FLAGS = {
  /** What the "talk to sales" call to action says. */
  sales_cta_copy: {
    variants: [
      { key: "control", weight: 50, label: "Talk to sales" },
      { key: "expert", weight: 50, label: "Talk to an Enterprise expert" },
    ],
  },
  /**
   * Whether the first-run wizard offers a way out when the plan's query limit is already reached (step 4). Assigned
   * per account, so everyone in an account sees the same wizard. The escape variant has weight 0 on purpose: the
   * Starter dead end is kept as behavior to analyse until an experiment is launched, by raising this weight.
   */
  wizard_escape_hatch: {
    variants: [
      { key: "control", weight: 100, label: "No way past the limit" },
      { key: "escape", weight: 0, label: "Continue without a new query" },
    ],
  },
} as const;

export type FlagKey = keyof typeof FLAGS;
export type VariantOf<K extends FlagKey> = (typeof FLAGS)[K]["variants"][number]["key"];

/** Bucket 0–9999, stable for a (flag, subject) pair. */
export function bucket(flag: string, subjectId: string): number {
  const h = createHash("sha256").update(`${flag}:${subjectId}`).digest();
  return h.readUInt32BE(0) % 10_000;
}

/**
 * Variant weights, with any override from the FLAG_WEIGHTS setting applied, e.g.
 * `FLAG_WEIGHTS={"wizard_escape_hatch":{"control":50,"escape":50}}`. That is how an experiment is launched or stopped
 * without a code change; a flag or variant not named there keeps its default.
 */
function weightsOf(flag: FlagKey): { key: string; weight: number }[] {
  let override: Record<string, Record<string, number>> = {};
  try {
    override = JSON.parse(process.env.FLAG_WEIGHTS || "{}") as typeof override;
  } catch {
    /* malformed setting: use the defaults rather than break every page */
  }
  return (FLAGS[flag].variants as readonly { key: string; weight: number }[]).map((v) => {
    const w = override[flag]?.[v.key];
    return { key: v.key, weight: typeof w === "number" && w >= 0 ? w : v.weight };
  });
}

export function variantFor<K extends FlagKey>(flag: K, subjectId: string): VariantOf<K> {
  const vs = weightsOf(flag);
  const total = vs.reduce((a, v) => a + v.weight, 0);
  const b = (bucket(flag, subjectId) / 10_000) * total;
  let acc = 0;
  for (const v of vs) {
    acc += v.weight;
    if (b < acc) return v.key as VariantOf<K>;
  }
  return vs[0]!.key as VariantOf<K>;
}

export function variantLabel<K extends FlagKey>(flag: K, variant: string): string {
  const vs = FLAGS[flag].variants as readonly { key: string; label: string }[];
  return (vs.find((v) => v.key === variant) ?? vs[0]!).label;
}
