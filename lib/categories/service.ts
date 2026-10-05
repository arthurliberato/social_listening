// Categories: named Boolean searches over a workspace's mentions, with counts. A category is a theme ("pricing
// complaints", "delivery delays"), defined with the same query language as queries and applied to what the queries
// already collect, so it never uses collection quota.
import { and, asc, eq, sql } from "drizzle-orm";
import { categories, db } from "@/db/client";
import { analyze } from "@/lib/query/lint";
import { buildFeedWhere, EFFECTIVE_SENTIMENT, FROM } from "@/lib/mentions/feed";
import { parseFilters } from "@/lib/mentions/filters";

export const MAX_CATEGORIES = 20;

export interface CategoryRow {
  id: string;
  name: string;
  booleanText: string;
  total: number;
  negative: number;
  positive: number;
  /** Set when the stored text no longer parses (it never should). */
  error: string | null;
}

/** Counts over the workspace's period, the same mentions the feed shows for `search=<text>`. */
export async function countFor(o: {
  workspaceId: string;
  booleanText: string;
  historyDays: number;
  range?: string;
}): Promise<{ total: number; negative: number; positive: number } | { error: string }> {
  const a = analyze(o.booleanText);
  if (!a.ok) return { error: a.issues.find((i) => i.severity === "error")?.message ?? "Invalid" };
  const b = await buildFeedWhere({
    workspaceId: o.workspaceId,
    filters: parseFilters(new URLSearchParams({ search: o.booleanText, range: o.range ?? "30d" })),
    historyDays: o.historyDays,
    since: null,
  });
  if (!b.scoped.length) return { total: 0, negative: 0, positive: 0 };
  const r = (
    await db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE ${EFFECTIVE_SENTIMENT} = 'negative')::int AS negative,
             count(*) FILTER (WHERE ${EFFECTIVE_SENTIMENT} = 'positive')::int AS positive
      ${FROM(o.workspaceId)} WHERE ${b.where} AND ${b.spamPart}`)
  ).rows[0] as { total: number; negative: number; positive: number };
  return { total: r.total, negative: r.negative, positive: r.positive };
}

export async function listCategories(workspaceId: string, historyDays: number) {
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId))
    .orderBy(asc(categories.name));
  return Promise.all(
    rows.map(async (c): Promise<CategoryRow> => {
      const n = await countFor({ workspaceId, booleanText: c.booleanText, historyDays });
      const base = { id: c.id, name: c.name, booleanText: c.booleanText };
      return "error" in n
        ? { ...base, total: 0, negative: 0, positive: 0, error: n.error }
        : { ...base, ...n, error: null };
    }),
  );
}

/** Tags people have put on mentions in this workspace, with how many mentions carry each. */
export async function tagCounts(workspaceId: string) {
  const r = await db.execute(
    sql`SELECT t AS tag, count(*)::int AS n FROM mention_overrides o, unnest(o.tags) t WHERE o.workspace_id = ${workspaceId}::uuid GROUP BY t ORDER BY n DESC, t LIMIT 100`,
  );
  return r.rows as { tag: string; n: number }[];
}

export async function categoryCount(workspaceId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId));
  return r?.n ?? 0;
}

export const categoryOwnedBy = (workspaceId: string, id: string) =>
  db
    .select()
    .from(categories)
    .where(and(eq(categories.workspaceId, workspaceId), eq(categories.id, id)))
    .then((r) => r[0]);
