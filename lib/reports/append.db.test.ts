import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { accounts, db, pool, reports, users, workspaces } from "@/db/client";
import { appendSection, getReport } from "./service";
import { MAX_SECTIONS, type Section } from "./types";

afterAll(() => pool.end());
const rnd = () => Math.random().toString(36).slice(2, 9);
const sec = (n: number | string): Section => ({
  id: `s${n}-${rnd()}`,
  type: "kpi",
  title: `Section ${n}`,
  config: {},
});

async function ws() {
  const [a] = await db.insert(accounts).values({ name: "ap", planTier: "agency" }).returning();
  const [w] = await db
    .insert(workspaces)
    .values({ accountId: a!.id, name: "ap", slug: `a-${rnd()}` })
    .returning();
  const [u] = await db
    .insert(users)
    .values({ email: `ap-${rnd()}@example.test`, passwordHash: "x", name: "ap" })
    .returning();
  return { w: w!, u: u! };
}
async function report(workspaceId: string, userId: string, sections: Section[] = []) {
  const [r] = await db
    .insert(reports)
    .values({ workspaceId, name: "R", description: "", range: "30d", sections, createdBy: userId })
    .returning();
  return r!;
}

describe("appending a section to a report", () => {
  it("adds to the end and reports the new count", async () => {
    const { w, u } = await ws();
    const r = await report(w.id, u.id, [sec(1)]);
    expect(await appendSection(w.id, r.id, sec(2))).toEqual({ name: "R", sections: 2 });
    const got = await getReport(w.id, r.id);
    expect((got!.sections as Section[]).map((s) => s.title)).toEqual(["Section 1", "Section 2"]);
  });

  it("simultaneous additions all land, none overwrite another", async () => {
    const { w, u } = await ws();
    const r = await report(w.id, u.id);
    await Promise.all(Array.from({ length: 8 }, (_, i) => appendSection(w.id, r.id, sec(i))));
    const got = await getReport(w.id, r.id);
    expect((got!.sections as Section[]).length).toBe(8);
    expect(new Set((got!.sections as Section[]).map((s) => s.title)).size).toBe(8);
  });

  it("stops at the section limit even when many arrive at once", async () => {
    const { w, u } = await ws();
    const r = await report(
      w.id,
      u.id,
      Array.from({ length: MAX_SECTIONS - 3 }, (_, i) => sec(i)),
    );
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => appendSection(w.id, r.id, sec(`x${i}`))),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    const got = await getReport(w.id, r.id);
    expect((got!.sections as Section[]).length).toBe(MAX_SECTIONS);
    expect(await appendSection(w.id, r.id, sec("late"))).toBeNull();
  });

  it("never touches another workspace's report", async () => {
    const mine = await ws();
    const theirs = await ws();
    const r = await report(theirs.w.id, theirs.u.id, [sec(1)]);
    expect(await appendSection(mine.w.id, r.id, sec(2))).toBeNull();
    const [row] = await db.select().from(reports).where(eq(reports.id, r.id));
    expect((row!.sections as Section[]).length).toBe(1);
  });
});
