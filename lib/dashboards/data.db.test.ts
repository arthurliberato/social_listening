import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runBackfill } from "@/jobs/backfill";
import { accounts, db, memberships, pool, queries, users, workspaces } from "@/db/client";
import { loadFeed } from "@/lib/mentions/feed";
import { parseFilters } from "@/lib/mentions/filters";
import { readOverrides, writeOverrides } from "@/lib/mentions/overrides";
import { WIDGET_TYPES, type WidgetType } from "./catalog";
import { loadWidget, type DataCtx } from "./data";

afterAll(() => pool.end());

describe("widget data", () => {
  let wsId = "";
  let userId = "";
  let q1 = "";
  let q2 = "";
  let ctx: DataCtx;

  beforeAll(async () => {
    const [a] = await db.insert(accounts).values({ name: "dash", planTier: "agency" }).returning();
    const [w] = await db
      .insert(workspaces)
      .values({
        accountId: a!.id,
        name: "dash",
        slug: `dash-${Math.random().toString(36).slice(2, 8)}`,
      })
      .returning();
    wsId = w!.id;
    const [u] = await db
      .insert(users)
      .values({
        email: `dash-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: "x",
        name: "Dash",
      })
      .returning();
    userId = u!.id;
    await db
      .insert(memberships)
      .values({ userId, workspaceId: wsId, accountId: a!.id, role: "owner" });
    const mk = async (name: string, text: string) =>
      (
        await db
          .insert(queries)
          .values({ workspaceId: wsId, name, booleanText: text, status: "live" })
          .returning()
      )[0]!.id;
    q1 = await mk("Kickforge", "kickforge");
    q2 = await mk("Tallyfy", "tallyfy");
    await runBackfill(q1);
    await runBackfill(q2);
    ctx = { workspaceId: wsId, historyDays: 730, range: new URLSearchParams("range=90d") };
  }, 180_000);

  const load = (t: WidgetType, cfg = {}) => loadWidget(ctx, t, cfg);

  it("every widget type loads, with a period and scope", async () => {
    for (const t of WIDGET_TYPES) {
      const p = await load(t, t === "kpi" ? { metric: "mentions" } : {});
      expect(p.data.kind, t).toBe(t === "volume" ? "volume" : t);
      expect(p.period.days).toBeGreaterThan(80);
      expect(p.scope.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it("totals agree across widgets and with the Mentions feed (so drill-down matches)", async () => {
    const [vol, donut, bar, geo, heat, kpi, area] = await Promise.all([
      load("volume"),
      load("sentiment_donut"),
      load("bar"),
      load("geo"),
      load("heatmap"),
      load("kpi"),
      load("sentiment_area"),
    ]);
    const total = (vol.data as { total: number }).total;
    expect(total).toBeGreaterThan(100);
    expect((donut.data as { total: number }).total).toBe(total);
    expect((bar.data as { total: number }).total).toBe(total);
    expect((geo.data as { total: number }).total).toBe(total);
    expect((heat.data as { total: number }).total).toBe(total);
    expect((area.data as { total: number }).total).toBe(total);
    expect((kpi.data as { value: number }).value).toBe(total);
    const feed = await loadFeed({
      workspaceId: wsId,
      userId,
      filters: parseFilters(new URLSearchParams("range=90d")),
      historyDays: 730,
    });
    expect(feed.total).toBe(total);
  }, 60_000);

  it("scopes to a single query and fills missing days with zeros", async () => {
    const all = (await load("volume")).data as {
      total: number;
      days: { day: string; value: number }[];
    };
    const one = (await load("volume", { queryId: q1 })).data as {
      total: number;
      days: { day: string; value: number }[];
    };
    expect(one.total).toBeLessThan(all.total);
    expect(one.days).toHaveLength(all.days.length);
    expect(one.days.every((d) => d.value >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(d.day))).toBe(true);
    expect(one.days.reduce((a, d) => a + d.value, 0)).toBe(one.total);
  }, 60_000);

  it("computes KPI deltas against the equal-length previous period", async () => {
    const k = (await load("kpi", { metric: "mentions" })).data as {
      value: number;
      previous: number;
      deltaPct: number | null;
      spark: number[];
    };
    expect(k.previous).toBeGreaterThan(0);
    expect(k.deltaPct).toBeCloseTo(((k.value - k.previous) / k.previous) * 100, 0);
    expect(k.spark.length).toBeGreaterThan(5);
    const net = (await load("kpi", { metric: "net_sentiment" })).data as {
      value: number;
      format: string;
    };
    expect(net.format).toBe("points");
    expect(net.value).toBeGreaterThanOrEqual(-100);
    expect(net.value).toBeLessThanOrEqual(100);
  }, 60_000);

  it("share of voice sums to ~100% across the workspace's queries", async () => {
    const sov = (await load("share_of_voice")).data as {
      rows: { share: number; count: number; name: string }[];
      total: number;
    };
    expect(sov.rows.map((r) => r.name).sort()).toEqual(["Kickforge", "Tallyfy"]);
    expect(sov.rows.reduce((a, r) => a + r.share, 0)).toBeGreaterThan(99);
    expect(sov.rows.reduce((a, r) => a + r.share, 0)).toBeLessThan(101);
  }, 60_000);

  it("reflects team sentiment edits in sentiment widgets", async () => {
    const before = (await load("sentiment_donut", { queryId: q1 })).data as {
      parts: { sentiment: string; count: number }[];
    };
    const feed = await loadFeed({
      workspaceId: wsId,
      userId,
      filters: parseFilters(new URLSearchParams("range=90d&q=" + q1 + "&sentiment=positive")),
      historyDays: 730,
      limit: 3,
    });
    const ids = feed.rows.map((r) => r.id);
    expect(ids.length).toBe(3);
    const prev = await readOverrides(wsId, ids);
    await writeOverrides(
      wsId,
      userId,
      prev.map((p) => ({ ...p, sentiment: "negative", exists: true })),
    );
    const after = (await load("sentiment_donut", { queryId: q1 })).data as {
      parts: { sentiment: string; count: number }[];
    };
    const n = (d: typeof before, s: string) => d.parts.find((p) => p.sentiment === s)!.count;
    expect(n(after, "negative")).toBe(n(before, "negative") + 3);
    expect(n(after, "positive")).toBe(n(before, "positive") - 3);
    await writeOverrides(wsId, userId, prev);
  }, 60_000);

  it("ranks authors and mentions by reach and honours topN", async () => {
    const authors = (await load("top_authors", { topN: 5 })).data as {
      rows: { reach: number; mentions: number }[];
    };
    expect(authors.rows).toHaveLength(5);
    expect(authors.rows.map((r) => r.reach)).toEqual(
      [...authors.rows.map((r) => r.reach)].sort((a, b) => b - a),
    );
    const top = (await load("top_mentions", { topN: 4 })).data as { rows: { reach: number }[] };
    expect(top.rows).toHaveLength(4);
    expect(top.rows[0]!.reach).toBeGreaterThanOrEqual(top.rows[3]!.reach);
  }, 60_000);

  it("groups beyond topN into Other", async () => {
    const bar = (await load("bar", { breakdown: "source", topN: 3 })).data as {
      rows: { key: string; count: number }[];
      total: number;
    };
    expect(bar.rows.length).toBeLessThanOrEqual(4);
    expect(bar.rows.reduce((a, r) => a + r.count, 0)).toBe(bar.total);
    if (bar.rows.length === 4) expect(bar.rows[3]!.key).toBe("other");
  }, 60_000);

  it("clamps windows to the plan's history", async () => {
    const trial = await loadWidget(
      { ...ctx, historyDays: 30, range: new URLSearchParams("range=12m") },
      "volume",
      {},
    );
    expect(trial.period.days).toBeLessThanOrEqual(31);
  }, 60_000);

  it("only sees its own workspace", async () => {
    const [a] = await db.insert(accounts).values({ name: "empty" }).returning();
    const [w] = await db
      .insert(workspaces)
      .values({ accountId: a!.id, name: "e", slug: `e-${Math.random().toString(36).slice(2, 8)}` })
      .returning();
    const p = await loadWidget({ ...ctx, workspaceId: w!.id }, "volume", {});
    expect((p.data as { total: number }).total).toBe(0);
    void eq;
  }, 60_000);
});
