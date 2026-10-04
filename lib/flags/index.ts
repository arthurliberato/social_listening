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
} as const;

export type FlagKey = keyof typeof FLAGS;
export type VariantOf<K extends FlagKey> = (typeof FLAGS)[K]["variants"][number]["key"];

/** Bucket 0–9999, stable for a (flag, subject) pair. */
export function bucket(flag: string, subjectId: string): number {
  const h = createHash("sha256").update(`${flag}:${subjectId}`).digest();
  return h.readUInt32BE(0) % 10_000;
}

export function variantFor<K extends FlagKey>(flag: K, subjectId: string): VariantOf<K> {
  const vs = FLAGS[flag].variants;
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
