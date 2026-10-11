import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runBackfill } from "@/jobs/backfill";
import { accounts, db, memberships, pool, queries, users, workspaces } from "@/db/client";
import { loadCase, loadTruth } from "./cases";
import { evaluate } from "./evaluate";

afterAll(() => pool.end());

describe("evaluator", () => {
  let queryId = "";
  const exact = async (text: string) => {
    const [q] = await db
      .insert(queries)
      .values({ workspaceId: wsId, name: text, booleanText: text, status: "live" })
      .returning();
    await runBackfill(q!.id);
    return q!.id;
  };
  let wsId = "";
  beforeAll(async () => {
    const [a] = await db.insert(accounts).values({ name: "ev", planTier: "agency" }).returning();
    const [w] = await db
      .insert(workspaces)
      .values({
        accountId: a!.id,
        name: "ev",
        slug: `ev-${Math.random().toString(36).slice(2, 8)}`,
      })
      .returning();
    wsId = w!.id;
    const [u] = await db
      .insert(users)
      .values({
        email: `ev-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: "x",
        name: "Ev",
      })
      .returning();
    await db
      .insert(memberships)
      .values({ userId: u!.id, workspaceId: wsId, accountId: a!.id, role: "owner" });
    queryId = await exact('"Juniper Roast"');
  }, 180_000);

  const d = {
    title: "Juniper Roast",
    findings: ["a", "b"],
    recommendations: ["x", "y"],
    numbers: { total: 0, negative_share: 0, positive_share: 0 },
    categories: [],
  };

  it("scores precision and recall as plain counts that match the corpus", async () => {
    const c = loadCase("CS-001");
    const e = await evaluate({
      assignment: c,
      truth: loadTruth("CS-001"),
      queryId,
      deliverable: d,
      categories: 0,
    });
    expect(e.query.matched).toBeGreaterThan(100);
    expect(e.query.precision).toBeCloseTo(e.query.true_positive / e.query.matched, 2);
    expect(e.query.recall).toBeCloseTo(e.query.true_positive / e.query.truth_total, 2);
    expect(e.query.precision).toBeGreaterThan(0.7);
    expect(e.query.recall).toBeLessThan(1); // the exact phrase misses hashtags, short forms and logos
    expect(e.deliverable.rubric_pass).toBe(true);
  }, 60_000);

  it("a broader query finds more of the truth, and a bare homonym-prone word is less precise than the phrase", async () => {
    const c = loadCase("CS-001");
    const phrase = await evaluate({
      assignment: c,
      truth: loadTruth("CS-001"),
      queryId,
      deliverable: d,
      categories: 0,
    });
    const bare = await evaluate({
      assignment: c,
      truth: loadTruth("CS-001"),
      queryId: await exact("juniper"),
      deliverable: d,
      categories: 0,
    });
    expect(bare.query.recall).toBeGreaterThan(phrase.query.recall);
    expect(bare.query.precision).toBeLessThan(phrase.query.precision);
  }, 120_000);

  it("fails the rubric for a deliverable that never names the brand or gives no recommendations", async () => {
    const e = await evaluate({
      assignment: loadCase("CS-001"),
      truth: loadTruth("CS-001"),
      queryId,
      deliverable: { ...d, title: "A report", findings: ["a", "b"], recommendations: [] },
      categories: 0,
    });
    expect(e.deliverable.rubric_pass).toBe(false);
    void sql;
  }, 60_000);
});
