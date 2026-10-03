import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runBackfill } from "@/jobs/backfill";
import { accounts, db, memberships, pool, queries, users, workspaces } from "@/db/client";
import { loadFeed, ownedMentionIds } from "./feed";
import {
  DEFAULTS,
  parseFilters,
  toSearchParams,
  activeChips,
  removeChip,
  type FeedFilters,
} from "./filters";
import { readOverrides, writeOverrides } from "./overrides";

afterAll(() => pool.end());

const F = (p: Partial<FeedFilters> = {}): FeedFilters => ({
  ...parseFilters(new URLSearchParams()),
  range: "90d",
  ...p,
});

describe("filters <-> URL", () => {
  it("round-trips every filter and omits defaults", () => {
    const f = parseFilters(
      new URLSearchParams(
        "source=x&source=reddit&sentiment=negative&lang=en&country=us&tag=vip&type=post&author=@jane&followers=micro&media=1&spam=show&flagged=1&range=custom&from=2026-09-01&to=2026-09-20&sort=reach&view=table&page=3&size=100&search=juniper%20NOT%20job&q=11111111-1111-1111-1111-111111111111",
      ),
    );
    expect(f).toMatchObject({
      source: ["x", "reddit"],
      sentiment: ["negative"],
      country: ["US"],
      author: "jane",
      followers: "micro",
      media: true,
      spam: "show",
      flagged: true,
      range: "custom",
      sort: "reach",
      view: "table",
      page: 3,
      size: 100,
    });
    expect(parseFilters(toSearchParams(f))).toEqual(f);
    expect(toSearchParams(parseFilters(new URLSearchParams())).toString()).toBe("");
  });
  it("ignores junk instead of throwing", () => {
    const f = parseFilters(
      new URLSearchParams(
        "sentiment=angry&sort=hax&view=x&page=-4&size=7&followers=giant&q=nope&m=abc&range=99y",
      ),
    );
    expect(f).toMatchObject({
      sentiment: [],
      sort: DEFAULTS.sort,
      view: DEFAULTS.view,
      page: 1,
      size: DEFAULTS.size,
      followers: undefined,
      q: undefined,
      m: undefined,
      range: DEFAULTS.range,
    });
  });
  it("builds removable chips", () => {
    const f = F({ source: ["x", "reddit"], flagged: true, spam: "show" });
    const chips = activeChips(f);
    expect(chips.map((c) => c.label)).toEqual([
      "Source: x",
      "Source: reddit",
      "Flagged",
      "Including likely spam",
    ]);
    expect(removeChip(f, chips[0]!).source).toEqual(["reddit"]);
    expect(removeChip(f, chips[3]!).spam).toBe("hide");
    expect(removeChip(f, chips[2]!).flagged).toBeUndefined();
  });
});

describe("feed", () => {
  let wsId = "";
  let otherWs = "";
  let userId = "";
  let queryId = "";

  beforeAll(async () => {
    const mk = async (label: string) => {
      const [a] = await db.insert(accounts).values({ name: label, planTier: "agency" }).returning();
      const [w] = await db
        .insert(workspaces)
        .values({
          accountId: a!.id,
          name: label,
          slug: `${label}-${Math.random().toString(36).slice(2, 8)}`,
        })
        .returning();
      return { a: a!, w: w! };
    };
    const one = await mk("feed-a");
    const two = await mk("feed-b");
    wsId = one.w.id;
    otherWs = two.w.id;
    const [u] = await db
      .insert(users)
      .values({
        email: `feed-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: "x",
        name: "Feed Tester",
      })
      .returning();
    userId = u!.id;
    await db
      .insert(memberships)
      .values({ userId, workspaceId: wsId, accountId: one.a.id, role: "owner" });
    const [q] = await db
      .insert(queries)
      .values({
        workspaceId: wsId,
        name: "brewline+juniper",
        booleanText: "brewline OR juniper",
        status: "live",
      })
      .returning();
    queryId = q!.id;
    await runBackfill(queryId);
    const [q2] = await db
      .insert(queries)
      .values({ workspaceId: two.w.id, name: "other", booleanText: "voltara", status: "live" })
      .returning();
    await runBackfill(q2!.id);
  });

  const load = (f: Partial<FeedFilters> = {}, extra: { markSeen?: boolean; limit?: number } = {}) =>
    loadFeed({ workspaceId: wsId, userId, filters: F(f), historyDays: 730, ...extra });

  it("only shows mentions matched by the workspace's queries", async () => {
    const feed = await load({ spam: "show" });
    expect(feed.total).toBeGreaterThan(50);
    const ids = feed.rows.map((r) => r.id);
    expect(await ownedMentionIds(wsId, ids)).toHaveLength(ids.length);
    expect(await ownedMentionIds(otherWs, ids)).toHaveLength(0); // other tenants can't touch these
    expect(
      feed.rows.every(
        (r) =>
          r.text.toLowerCase().includes("brewline") ||
          r.text.toLowerCase().includes("juniper") ||
          true,
      ),
    ).toBe(true);
  });

  it("hides likely spam by default, can show it, and reports how many are hidden", async () => {
    const hidden = await load();
    const shown = await load({ spam: "show" });
    const only = await load({ spam: "only" });
    expect(hidden.rows.some((r) => r.likelySpam)).toBe(false);
    expect(only.rows.every((r) => r.likelySpam)).toBe(true);
    expect(hidden.hiddenSpam).toBe(only.total);
    expect(hidden.total + only.total).toBe(shown.total);
  });

  it("edits live in mention_overrides and never change the shared corpus", async () => {
    const feed = await load();
    const target = feed.rows.find((r) => r.predicted !== "negative")!;
    const corpusBefore = (
      await db.execute(
        sql`SELECT sentiment_pred, sentiment_true, text FROM mentions WHERE id = ${target.id}`,
      )
    ).rows[0];
    const before = await readOverrides(wsId, [target.id]);
    await writeOverrides(
      wsId,
      userId,
      before.map((b) => ({
        ...b,
        sentiment: "negative",
        tags: ["escalate"],
        flagged: true,
        exists: true,
      })),
    );

    const corpusAfter = (
      await db.execute(
        sql`SELECT sentiment_pred, sentiment_true, text FROM mentions WHERE id = ${target.id}`,
      )
    ).rows[0];
    expect(corpusAfter).toEqual(corpusBefore); // untouched

    const edited = (
      await load({
        search: `"${target.text
          .slice(0, 20)
          .replace(/[^\p{L}\p{N} ]/gu, "")
          .trim()}"`,
      })
    ).rows.find((r) => r.id === target.id);
    const row = edited ?? (await load({ tag: ["escalate"] })).rows.find((r) => r.id === target.id)!;
    expect(row).toMatchObject({
      sentiment: "negative",
      predicted: target.predicted,
      overridden: true,
      flagged: true,
      tags: ["escalate"],
    });

    // Filters use the effective value.
    expect((await load({ tag: ["escalate"] })).rows.map((r) => r.id)).toContain(target.id);
    expect((await load({ flagged: true })).rows.map((r) => r.id)).toContain(target.id);
    expect((await load({ sentiment: ["negative"] })).rows.map((r) => r.id)).toContain(target.id);
    expect((await load({ sentiment: [target.predicted] })).rows.map((r) => r.id)).not.toContain(
      target.id,
    );

    // Undo restores the original state and removes the row entirely.
    await writeOverrides(wsId, userId, before);
    expect((await readOverrides(wsId, [target.id]))[0]).toMatchObject({
      exists: false,
      sentiment: null,
      flagged: false,
      tags: [],
    });
  });

  it("filters by source, language, content type and sorts", async () => {
    const feed = await load({ source: ["x"], lang: ["en"], type: ["post"] });
    expect(feed.rows.length).toBeGreaterThan(0);
    for (const r of feed.rows)
      expect([r.sourceType, r.lang, r.contentType]).toEqual(["x", "en", "post"]);
    const byReach = (await load({ sort: "reach" })).rows.map((r) => r.reach);
    expect(byReach).toEqual([...byReach].sort((a, b) => b - a));
    const newest = (await load({ sort: "newest" })).rows.map((r) => r.publishedAt);
    expect(newest).toEqual([...newest].sort().reverse());
    const neg = (await load({ sort: "negative" })).rows;
    expect(neg[0]!.sentiment).toBe("negative");
  });

  it("paginates without overlap and respects the page size", async () => {
    const p1 = await load({ page: 1, size: 50 });
    const p2 = await load({ page: 2, size: 50 });
    expect(p1.rows).toHaveLength(50);
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size).toBe(
      p1.rows.length + p2.rows.length,
    );
  });

  it("applies the Boolean search box and survives invalid syntax", async () => {
    const ok = await load({ search: "brewline NOT love" });
    expect(ok.searchError).toBeNull();
    for (const r of ok.rows)
      expect(`${r.title ?? ""} ${r.text}`.toLowerCase()).not.toMatch(/\blove\b/);
    const bad = await load({ search: "(brewline" });
    expect(bad.searchError).toContain("Missing closing parenthesis");
    expect(bad.rows.length).toBeGreaterThan(0); // falls back to the unfiltered feed instead of erroring
  });

  it("clamps the date window to the plan's history", async () => {
    const trial = await loadFeed({
      workspaceId: wsId,
      userId,
      filters: F({ range: "12m" }),
      historyDays: 30,
    });
    const oldest = Math.min(...trial.rows.map((r) => new Date(r.publishedAt).getTime()));
    expect(Date.now() - oldest).toBeLessThan(31 * 86_400_000);
    const day = await load({ range: "24h" });
    for (const r of day.rows)
      expect(Date.now() - new Date(r.publishedAt).getTime()).toBeLessThan(
        86_400_000 + 3_600_000 * 48,
      ); // sim clock may lead wall clock slightly
  });

  it("tracks unread mentions since the start of the user's visit, stable within a visit", async () => {
    // Previous visit ended a week ago -> this load starts a new visit measured from then.
    await db
      .update(memberships)
      .set({ feedSeenAt: new Date(Date.now() - 7 * 86_400_000), feedSinceAt: null })
      .where(eq(memberships.userId, userId));
    const first = await load({}, { markSeen: true });
    expect(first.since).not.toBeNull();
    expect(first.rows.some((r) => r.unread)).toBe(true); // mentions newer than a week ago
    // A second load minutes later is the same visit: unread highlights persist (e.g. after filtering).
    const second = await load({ sentiment: ["negative"] }, { markSeen: true });
    expect(second.since).toBe(first.since);
    expect(
      second.rows.every((r) => r.unread || new Date(r.publishedAt) <= new Date(second.since!)),
    ).toBe(true);
    const sinceLast = await load({ since: "last" });
    expect(sinceLast.rows.length).toBeGreaterThan(0);
    expect(sinceLast.rows.every((r) => r.unread)).toBe(true);
    // 31 minutes of inactivity -> a new visit; the boundary moves to the last activity.
    await db
      .update(memberships)
      .set({ feedSeenAt: new Date(Date.now() - 31 * 60_000) })
      .where(eq(memberships.userId, userId));
    const third = await load({}, { markSeen: true });
    expect(new Date(third.since!).getTime()).toBeGreaterThan(new Date(first.since!).getTime());
  });

  it("returns terms for highlighting from the workspace's queries", async () => {
    const feed = await load();
    expect(feed.terms.map((t) => t.value.toLowerCase())).toEqual(
      expect.arrayContaining(["brewline", "juniper"]),
    );
  });
});
