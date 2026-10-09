import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runBackfill } from "@/jobs/backfill";
import {
  accounts,
  categories,
  db,
  memberships,
  pool,
  queries,
  users,
  workspaces,
} from "@/db/client";
import { loadFeed } from "@/lib/mentions/feed";
import { parseFilters } from "@/lib/mentions/filters";
import { brandQuery, busiestBrands } from "@/lib/testing/corpus";
import { countFor, listCategories, tagCounts } from "./service";

afterAll(() => pool.end());

describe("categories", () => {
  let wsId = "";
  let userId = "";
  let brand = "";

  beforeAll(async () => {
    const [a] = await db.insert(accounts).values({ name: "cat", planTier: "agency" }).returning();
    const [w] = await db
      .insert(workspaces)
      .values({
        accountId: a!.id,
        name: "cat",
        slug: `cat-${Math.random().toString(36).slice(2, 8)}`,
      })
      .returning();
    wsId = w!.id;
    const [u] = await db
      .insert(users)
      .values({
        email: `cat-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: "x",
        name: "Cat",
      })
      .returning();
    userId = u!.id;
    await db
      .insert(memberships)
      .values({ userId, workspaceId: wsId, accountId: a!.id, role: "owner" });
    brand = (await busiestBrands(1))[0]!;
    const [q] = await db
      .insert(queries)
      .values({ workspaceId: wsId, name: brand, booleanText: brandQuery(brand), status: "live" })
      .returning();
    await runBackfill(q!.id);
  }, 180_000);

  it("counts what the Mentions feed shows for the same search", async () => {
    const text = brandQuery(brand);
    const n = await countFor({ workspaceId: wsId, booleanText: text, historyDays: 730 });
    if ("error" in n) throw new Error(n.error);
    const feed = await loadFeed({
      workspaceId: wsId,
      userId,
      filters: parseFilters(new URLSearchParams({ search: text, range: "30d" })),
      historyDays: 730,
      limit: 1,
    });
    expect(n.total).toBe(feed.total);
    expect(n.total).toBeGreaterThan(0);
    expect(n.negative + n.positive).toBeLessThanOrEqual(n.total);
  }, 60_000);

  it("a narrower search never matches more, and nothing matches nothing", async () => {
    const all = await countFor({
      workspaceId: wsId,
      booleanText: brandQuery(brand),
      historyDays: 730,
    });
    const narrow = await countFor({
      workspaceId: wsId,
      booleanText: `${brandQuery(brand)} AND zzzqqxnotaword`,
      historyDays: 730,
    });
    if ("error" in all || "error" in narrow) throw new Error("unexpected error");
    expect(narrow.total).toBe(0);
    expect(all.total).toBeGreaterThan(narrow.total);
  }, 60_000);

  it("reports an invalid search instead of throwing", async () => {
    const r = await countFor({ workspaceId: wsId, booleanText: "(unclosed", historyDays: 730 });
    expect("error" in r).toBe(true);
  });

  it("lists categories with counts, scoped to the workspace, names unique case-insensitively", async () => {
    await db
      .insert(categories)
      .values({ workspaceId: wsId, name: "Core", booleanText: brandQuery(brand) });
    await expect(
      db.insert(categories).values({ workspaceId: wsId, name: "core", booleanText: "x" }),
    ).rejects.toThrow();
    const rows = await listCategories(wsId, 730);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total).toBeGreaterThan(0);
    expect(rows[0]!.error).toBeNull();
    const [other] = await db.insert(accounts).values({ name: "other" }).returning();
    const [ow] = await db
      .insert(workspaces)
      .values({
        accountId: other!.id,
        name: "o",
        slug: `o-${Math.random().toString(36).slice(2, 8)}`,
      })
      .returning();
    expect(await listCategories(ow!.id, 730)).toEqual([]);
    expect(await tagCounts(ow!.id)).toEqual([]);
    await db.delete(categories).where(eq(categories.workspaceId, wsId));
  }, 60_000);
});
