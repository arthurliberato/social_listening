import { RANGES } from "@/lib/mentions/filters";

/** The Mentions URL for a drill-down, carrying the page's period and query so counts line up. */
export function mentionsHref(
  ws: string,
  f: { range: string; q?: string },
  extra: Record<string, string>,
) {
  const p = new URLSearchParams();
  if ((RANGES as readonly string[]).includes(f.range)) p.set("range", f.range);
  if (f.q) p.set("q", f.q);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return `/w/${ws}/mentions?${p.toString()}`;
}
