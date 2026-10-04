import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  accounts,
  alertRules,
  analyticsEvents,
  dashboards,
  db,
  memberships,
  pool,
  queries,
  users,
  workspaces,
} from "@/db/client";
import { checklist, itemCompleted } from "./checklist";

afterAll(() => pool.end());
const rnd = () => Math.random().toString(36).slice(2, 9);

async function ws() {
  const [a] = await db.insert(accounts).values({ name: "cl", planTier: "growth" }).returning();
  const [w] = await db
    .insert(workspaces)
    .values({ accountId: a!.id, name: "cl", slug: `c-${rnd()}` })
    .returning();
  const [u] = await db
    .insert(users)
    .values({ email: `c-${rnd()}@example.test`, passwordHash: "x", name: "c" })
    .returning();
  await db
    .insert(memberships)
    .values({ userId: u!.id, workspaceId: w!.id, accountId: a!.id, role: "owner" });
  return { w: w!, u: u!, a: a! };
}
const completedEvents = async (workspaceId: string, item: string) =>
  (
    await db
      .select()
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.workspaceId, workspaceId),
          eq(analyticsEvents.name, "Checklist Item Completed"),
        ),
      )
  ).filter((e) => (e.props as { item_id?: string }).item_id === item);

describe("home checklist", () => {
  it("starts empty and reflects real alerts and dashboards", async () => {
    const { w, u } = await ws();
    expect((await checklist(w.id)).doneCount).toBe(0);
    const [q] = await db
      .insert(queries)
      .values({
        workspaceId: w.id,
        name: "q",
        booleanText: '"a" NOT "b"',
        status: "live",
        createdBy: u.id,
      })
      .returning();
    let c = await checklist(w.id);
    expect(c.items.filter((i) => i.done).map((i) => i.id)).toEqual([
      "create_query",
      "refine_query",
    ]);
    await db
      .insert(alertRules)
      .values({
        workspaceId: w.id,
        queryId: q!.id,
        name: "a",
        type: "volume_spike",
        params: {},
        channels: ["in_app"],
        createdBy: u.id,
      });
    await db.insert(dashboards).values({ workspaceId: w.id, name: "d", createdBy: u.id });
    c = await checklist(w.id);
    expect(c.items.find((i) => i.id === "set_alert")!.done).toBe(true);
    expect(c.items.find((i) => i.id === "build_dashboard")!.done).toBe(true);
    expect(c.doneCount).toBe(4);
  });

  it("another workspace's alerts and dashboards don't count", async () => {
    const mine = await ws();
    const other = await ws();
    await db
      .insert(dashboards)
      .values({ workspaceId: other.w.id, name: "d", createdBy: other.u.id });
    expect((await checklist(mine.w.id)).doneCount).toBe(0);
  });

  it("the completion event fires for the first dashboard only, with the running count", async () => {
    const { w, u } = await ws();
    await db.insert(dashboards).values({ workspaceId: w.id, name: "d1", createdBy: u.id });
    await itemCompleted({ userId: u.id, workspaceId: w.id }, "build_dashboard");
    await db.insert(dashboards).values({ workspaceId: w.id, name: "d2", createdBy: u.id });
    await itemCompleted({ userId: u.id, workspaceId: w.id }, "build_dashboard");
    const ev = await completedEvents(w.id, "build_dashboard");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.props).toMatchObject({ completed_count: 1 });
  });
});
