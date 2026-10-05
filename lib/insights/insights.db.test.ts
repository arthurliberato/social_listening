// Authors and Topics must agree with the Mentions feed they drill into.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accounts,
  authorWatchlist,
  db,
  memberships,
  pool,
  queries,
  users,
  workspaces,
} from "@/db/client";
import { runRelease } from "@/jobs/release";
import { loadFeed } from "@/lib/mentions/feed";
import { parseFilters } from "@/lib/mentions/filters";
import { simNow } from "@/lib/simclock";
import { authorProfile, topAuthors, topicStats } from "./service";

afterAll(() => pool.end());
const rnd = () => Math.random().toString(36).slice(2, 9);
const HIST = 365;
let f: { ws: string; userId: string; empty: string };

async function workspace(withQuery: boolean) {
  const [a] = await db.insert(accounts).values({ name: "ins", planTier: "agency" }).returning();
  const [w] = await db
    .insert(workspaces)
    .values({ accountId: a!.id, name: "ins", slug: `i-${rnd()}` })
    .returning();
  const [u] = await db
    .insert(users)
    .values({ email: `i-${rnd()}@example.test`, passwordHash: "x", name: "i" })
    .returning();
  await db
    .insert(memberships)
    .values({ userId: u!.id, workspaceId: w!.id, accountId: a!.id, role: "owner" });
  if (withQuery) {
    const brand = (
      await db.execute(sql`
        SELECT b.name FROM mentions m JOIN brands b ON b.id = m.brand_id
        WHERE m.published_at > ${new Date(simNow().getTime() - 60 * 86_400_000)} AND m.published_at <= ${simNow()}
        GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`)
    ).rows[0] as { name: string };
    const [q] = await db
      .insert(queries)
      .values({
        workspaceId: w!.id,
        name: brand.name,
        booleanText: `"${brand.name}"`,
        status: "live",
        backfillStatus: "done",
        releasedThrough: new Date(simNow().getTime() - 75 * 86_400_000),
        createdBy: u!.id,
      })
      .returning();
    await runRelease(q!.id, simNow());
  }
  return { ws: w!.id, userId: u!.id };
}

beforeAll(async () => {
  const main = await workspace(true);
  const empty = await workspace(false);
  f = { ...main, empty: empty.ws };
}, 240_000);

describe("authors", () => {
  const filters = parseFilters({ range: "30d" });

  it("ranks by reach, hides likely spam, and its totals equal the feed's", async () => {
    const { rows } = await topAuthors({
      workspaceId: f.ws,
      filters,
      historyDays: HIST,
      sort: "reach",
      watchedOnly: false,
      limit: 100_000,
    });
    expect(rows.length).toBeGreaterThan(3);
    const top = rows.slice(0, 50).map((r) => r.reach);
    expect(top).toEqual([...top].sort((a, b) => b - a));
    const feed = await loadFeed({
      workspaceId: f.ws,
      userId: f.userId,
      filters,
      historyDays: HIST,
      limit: 1,
    });
    expect(rows.reduce((a, r) => a + r.mentions, 0)).toBe(feed.total);
    const bots = await db.execute(
      sql`SELECT count(*)::int AS n FROM authors WHERE bot_score >= 0.8 AND id IN (${sql.join(
        rows.map((r) => sql`${r.id}`),
        sql`, `,
      )})`,
    );
    expect((bots.rows[0] as { n: number }).n).toBe(0);
  }, 60_000);

  it("can rank by mentions or negative mentions, and filter to the watchlist", async () => {
    const base = { workspaceId: f.ws, filters, historyDays: HIST, watchedOnly: false, limit: 20 };
    const byM = (await topAuthors({ ...base, sort: "mentions" })).rows.map((r) => r.mentions);
    expect(byM).toEqual([...byM].sort((a, b) => b - a));
    const byN = (await topAuthors({ ...base, sort: "negative" })).rows.map((r) => r.negative);
    expect(byN).toEqual([...byN].sort((a, b) => b - a));
    const first = (await topAuthors({ ...base, sort: "reach" })).rows[0]!;
    await db
      .insert(authorWatchlist)
      .values({ workspaceId: f.ws, authorId: first.id })
      .onConflictDoNothing();
    const watched = await topAuthors({ ...base, sort: "reach", watchedOnly: true });
    expect(watched.rows.map((r) => r.id)).toEqual([first.id]);
    expect(watched.rows[0]!.watched).toBe(true);
  }, 60_000);

  it("a workspace with no queries has an honest empty result", async () => {
    expect(
      await topAuthors({
        workspaceId: f.empty,
        filters,
        historyDays: HIST,
        sort: "reach",
        watchedOnly: false,
      }),
    ).toEqual({ rows: [], hasQueries: false });
  });

  it("a profile only counts mentions that match this workspace's queries", async () => {
    const { rows } = await topAuthors({
      workspaceId: f.ws,
      filters,
      historyDays: HIST,
      sort: "mentions",
      watchedOnly: false,
      limit: 1,
    });
    const mine = await authorProfile({
      workspaceId: f.ws,
      authorId: rows[0]!.id,
      filters,
      historyDays: HIST,
    });
    expect(mine!.total).toBe(rows[0]!.mentions);
    expect(mine!.recent.length).toBeGreaterThan(0);
    const other = await authorProfile({
      workspaceId: f.empty,
      authorId: rows[0]!.id,
      filters,
      historyDays: HIST,
    });
    expect(other!.total).toBe(0);
    expect(other!.recent).toEqual([]);
    expect(
      await authorProfile({ workspaceId: f.ws, authorId: -1, filters, historyDays: HIST }),
    ).toBeNull();
  }, 60_000);
});

describe("topics", () => {
  const filters = parseFilters({ range: "30d" });
  it("ranks topics, and the change is measured against the previous period", async () => {
    const r = await topicStats({ workspaceId: f.ws, filters, historyDays: HIST });
    expect(r.hasQueries).toBe(true);
    expect(r.rows.length).toBeGreaterThan(2);
    const counts = r.rows.map((x) => x.mentions);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const t = r.rows[0]!;
    const span = r.to.getTime() - r.from.getTime();
    const prev = await db.execute(sql`
      SELECT count(*)::int AS n FROM query_matches qm JOIN mentions m ON m.id = qm.mention_id
      JOIN authors a ON a.id = m.author_id
      WHERE qm.query_id IN (SELECT id FROM queries WHERE workspace_id = ${f.ws}::uuid)
        AND m.published_at >= ${new Date(r.from.getTime() - span)} AND m.published_at <= ${r.from}
        AND ${t.topic} = ANY(m.topics) AND a.bot_score < 0.8 AND m.text !~* 'giveaway|crypto|airdrop|dm me|click here'`);
    // The independent count uses a coarser spam test, so allow a little slack.
    expect(Math.abs(t.previous - (prev.rows[0] as { n: number }).n)).toBeLessThanOrEqual(
      Math.max(3, t.previous * 0.15),
    );
    if (t.previous > 0)
      expect(t.growthPct).toBe(Math.round(((t.mentions - t.previous) / t.previous) * 100));
    else expect(t.growthPct).toBeNull();
  }, 60_000);
  it("no queries, no topics", async () => {
    const r = await topicStats({ workspaceId: f.empty, filters, historyDays: HIST });
    expect(r).toMatchObject({ rows: [], hasQueries: false });
  });
});
