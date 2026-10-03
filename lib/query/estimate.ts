import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { simNow } from "@/lib/simclock";

/**
 * Rough match count for brand terms over the last `days` days — enough for the onboarding preview.
 * (The full Boolean engine arrives in M3; this uses phrase search with a job-ad exclusion.)
 */
export async function estimateMentions(terms: string[], days = 30): Promise<number> {
  const clean = terms
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!clean.length) return 0;
  const end = simNow();
  const start = new Date(end.getTime() - days * 86_400_000);
  const positive = sql.join(
    clean.map((t) => sql`phraseto_tsquery('simple', ${t})`),
    sql` || `,
  );
  const res = await db.execute(sql`
    SELECT count(*)::int AS n FROM mentions
    WHERE published_at >= ${start} AND published_at < ${end}
      AND tsv @@ (${positive})
      AND NOT (tsv @@ to_tsquery('simple', 'job | hiring'))`);
  return (res.rows[0] as { n: number }).n;
}
