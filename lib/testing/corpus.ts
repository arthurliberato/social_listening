// For database tests: pick test data from the corpus that is actually loaded, instead of naming brands.
// CI loads a small corpus (a few brands at a fraction of the scale); local runs load all 40 brands. Tests that
// hardcode a brand pass on one and silently fail on the other. Never import this from application code.
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { simNow } from "@/lib/simclock";

/** The brands with the most mentions in the 90 days before the sim clock, busiest first. */
export async function busiestBrands(n: number): Promise<string[]> {
  const now = simNow();
  const from = new Date(now.getTime() - 90 * 86_400_000);
  const rows = (
    await db.execute(sql`
      SELECT b.name FROM brands b
      JOIN mentions m ON m.brand_id = b.id
      WHERE m.published_at >= ${from} AND m.published_at < ${now}
      GROUP BY b.name ORDER BY count(*) DESC, b.name LIMIT ${n}`)
  ).rows as { name: string }[];
  if (rows.length < n)
    throw new Error(`The corpus has fewer than ${n} brands with recent mentions.`);
  return rows.map((r) => r.name);
}

/** A Boolean query that matches a brand by its exact name, whatever characters it contains. */
export const brandQuery = (name: string) => `"${name.replace(/"/g, "")}"`;
