import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { creatorListItems, creatorLists, creatorProfileViews, creators, db } from "@/db/client";
import { TIER_BOUNDS, type CreatorAudience } from "@/datagen/creators";
import { limits, type PlanTier } from "@/lib/entitlements/plans";
import { periodOf } from "@/lib/usage";
import { PAGE_SIZE, type CreatorFilters, type CreatorSort } from "./filters";

export type CreatorRow = typeof creators.$inferSelect;
/** What the discovery table shows: no audience detail, which is a plan feature on the profile. */
export type CreatorSummary = Omit<CreatorRow, "audience" | "tsv" | "bio">;

const ORDER: Record<CreatorSort, SQL> = {
  followers: sql`${creators.followers} desc`,
  engagement: sql`${creators.engagementRate} desc`,
  authenticity: sql`${creators.authenticityScore} desc`,
  growth: sql`${creators.growth30d} desc`,
  rate: sql`${creators.ratePerPostUsd} desc`,
};

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function whereFor(f: CreatorFilters): SQL | undefined {
  const w: SQL[] = [];
  if (f.q) {
    const prefix = `${likeEscape(f.q.toLowerCase())}%`;
    w.push(
      sql`(${creators.tsv} @@ websearch_to_tsquery('simple', ${f.q})
        or lower(${creators.handle}) like ${prefix}
        or lower(${creators.displayName}) like ${`%${likeEscape(f.q.toLowerCase())}%`})`,
    );
  }
  if (f.platforms.length) w.push(inArray(creators.platform, f.platforms));
  if (f.niches.length) w.push(inArray(creators.niche, f.niches));
  if (f.countries.length) w.push(inArray(creators.country, f.countries));
  if (f.tiers.length) {
    const ors = f.tiers.map((t) => {
      const [lo, hi] = TIER_BOUNDS[t];
      return sql`(${creators.followers} >= ${lo} and ${creators.followers} < ${Math.min(hi, 2_000_000_000)})`;
    });
    w.push(sql`(${sql.join(ors, sql` or `)})`);
  }
  if (f.minEngagement != null) w.push(sql`${creators.engagementRate} >= ${f.minEngagement}`);
  if (f.minAuthenticity != null) w.push(sql`${creators.authenticityScore} >= ${f.minAuthenticity}`);
  if (f.safeOnly) w.push(eq(creators.brandSafety, "safe"));
  return w.length ? and(...w) : undefined;
}

const SUMMARY_COLUMNS = {
  id: creators.id,
  platform: creators.platform,
  handle: creators.handle,
  displayName: creators.displayName,
  niche: creators.niche,
  tags: creators.tags,
  country: creators.country,
  language: creators.language,
  followers: creators.followers,
  engagementRate: creators.engagementRate,
  avgViews: creators.avgViews,
  postsPerWeek: creators.postsPerWeek,
  growth30d: creators.growth30d,
  verified: creators.verified,
  sponsoredPct: creators.sponsoredPct,
  fakeFollowerPct: creators.fakeFollowerPct,
  authenticityScore: creators.authenticityScore,
  brandSafety: creators.brandSafety,
  ratePerPostUsd: creators.ratePerPostUsd,
  avatarSeed: creators.avatarSeed,
};

export async function searchCreators(f: CreatorFilters) {
  const where = whereFor(f);
  const [rows, [total]] = await Promise.all([
    db
      .select(SUMMARY_COLUMNS)
      .from(creators)
      .where(where)
      // id is the tiebreaker so pages never overlap or skip when many creators share a value.
      .orderBy(ORDER[f.sort], asc(creators.id))
      .limit(PAGE_SIZE)
      .offset((f.page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(creators).where(where),
  ]);
  const n = total?.n ?? 0;
  return { rows, total: n, pages: Math.max(1, Math.ceil(n / PAGE_SIZE)) };
}

/** Summaries for a set of ids, in the order asked for; ids that aren't in the directory are skipped. */
export async function creatorsByIds(ids: number[]): Promise<CreatorSummary[]> {
  if (!ids.length) return [];
  const rows = await db.select(SUMMARY_COLUMNS).from(creators).where(inArray(creators.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export async function getCreator(id: number): Promise<CreatorRow | null> {
  if (!Number.isInteger(id) || id < 1) return null;
  return (await db.select().from(creators).where(eq(creators.id, id)).limit(1))[0] ?? null;
}

export const audienceOf = (c: CreatorRow) => c.audience as CreatorAudience;

/**
 * Opening a creator's profile counts against the plan's monthly allowance, once per creator per month.
 * Re-opening one you've already seen is free, so the allowance measures breadth of research.
 */
export async function recordProfileView(accountId: string, tier: PlanTier, creatorId: number) {
  const limit = limits(tier).creatorProfilesPerMonth;
  const period = periodOf();
  const mine = and(
    eq(creatorProfileViews.accountId, accountId),
    eq(creatorProfileViews.period, period),
  );
  const [seen] = await db
    .select({ n: count() })
    .from(creatorProfileViews)
    .where(and(mine, eq(creatorProfileViews.creatorId, creatorId)));
  const [used] = await db.select({ n: count() }).from(creatorProfileViews).where(mine);
  const usedNow = used?.n ?? 0;
  if (seen?.n) return { allowed: true as const, used: usedNow, limit, firstView: false };
  if (usedNow >= limit) return { allowed: false as const, used: usedNow, limit, firstView: false };
  await db
    .insert(creatorProfileViews)
    .values({ accountId, creatorId, period })
    .onConflictDoNothing();
  return { allowed: true as const, used: usedNow + 1, limit, firstView: true };
}

export async function profileViewUsage(accountId: string, tier: PlanTier) {
  const [row] = await db
    .select({ n: count() })
    .from(creatorProfileViews)
    .where(
      and(eq(creatorProfileViews.accountId, accountId), eq(creatorProfileViews.period, periodOf())),
    );
  const limit = limits(tier).creatorProfilesPerMonth;
  const used = row?.n ?? 0;
  return { used, limit, pct: Math.min(100, Math.round((used / limit) * 100)) };
}

/** Lists in a workspace with their size. */
export async function workspaceLists(workspaceId: string) {
  return db
    .select({
      id: creatorLists.id,
      name: creatorLists.name,
      description: creatorLists.description,
      createdAt: creatorLists.createdAt,
      size: sql<number>`(select count(*)::int from creator_list_items i where i.list_id = ${creatorLists.id})`,
    })
    .from(creatorLists)
    .where(eq(creatorLists.workspaceId, workspaceId))
    .orderBy(desc(creatorLists.createdAt));
}

/** An account's lists across all of its workspaces, for plan-limit checks. */
export async function accountListCount(workspaceIds: string[]) {
  if (!workspaceIds.length) return 0;
  const [r] = await db
    .select({ n: count() })
    .from(creatorLists)
    .where(inArray(creatorLists.workspaceId, workspaceIds));
  return r?.n ?? 0;
}

export async function getList(workspaceId: string, listId: string) {
  if (!/^[0-9a-f-]{36}$/.test(listId)) return null;
  const [list] = await db
    .select()
    .from(creatorLists)
    .where(and(eq(creatorLists.id, listId), eq(creatorLists.workspaceId, workspaceId)));
  if (!list) return null;
  const items = await db
    .select({ ...SUMMARY_COLUMNS, note: creatorListItems.note, addedAt: creatorListItems.addedAt })
    .from(creatorListItems)
    .innerJoin(creators, eq(creators.id, creatorListItems.creatorId))
    .where(eq(creatorListItems.listId, list.id))
    .orderBy(desc(creatorListItems.addedAt), asc(creators.id));
  return { list, items };
}

/** Which of this workspace's lists already contain the creator(s), to show state in the "Add to list" menu. */
export async function listsContaining(workspaceId: string, creatorIds: number[]) {
  if (!creatorIds.length) return new Map<number, string[]>();
  const rows = await db
    .select({ creatorId: creatorListItems.creatorId, listId: creatorListItems.listId })
    .from(creatorListItems)
    .innerJoin(creatorLists, eq(creatorLists.id, creatorListItems.listId))
    .where(
      and(
        eq(creatorLists.workspaceId, workspaceId),
        inArray(creatorListItems.creatorId, creatorIds),
      ),
    );
  const m = new Map<number, string[]>();
  for (const r of rows) m.set(r.creatorId, [...(m.get(r.creatorId) ?? []), r.listId]);
  return m;
}
