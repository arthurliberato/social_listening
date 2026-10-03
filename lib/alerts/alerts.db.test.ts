// M6 acceptance: an injected crisis fires a spike alert within one release cycle on real-time plans.
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  accounts,
  alertEvents,
  alertRules,
  db,
  emails,
  memberships,
  pool,
  queries,
  users,
  workspaces,
} from "@/db/client";
import { HISTORY_START, WORLD_END } from "@/datagen/config";
import { runRelease } from "@/jobs/release";
import { evaluateAlerts, observe } from "./engine";
import { evaluate, HOUR_MS, type Params } from "./rules";

afterAll(() => pool.end());

const CYCLE = 5 * 60_000;

/** The biggest crisis in the corpus that has a full week of normal history before it. */
async function pickCrisis() {
  const rows = (
    await db.execute(sql`
    SELECT b.name AS brand, m.crisis_id AS id, min(m.published_at) AS start, count(*)::int AS n
    FROM mentions m JOIN brands b ON b.id = m.brand_id
    WHERE m.crisis_id IS NOT NULL
    GROUP BY 1, 2
    HAVING min(m.published_at) > ${new Date(HISTORY_START + 10 * 86_400_000)}
       AND min(m.published_at) < ${new Date(WORLD_END - 3 * 86_400_000)}
    ORDER BY n DESC LIMIT 1`)
  ).rows as { brand: string; id: number; start: string; n: number }[];
  return { brand: rows[0]!.brand, id: rows[0]!.id, start: new Date(rows[0]!.start) };
}

async function fixture(plan: "agency" | "growth", brand: string, from: Date) {
  const [a] = await db.insert(accounts).values({ name: "alerts", planTier: plan }).returning();
  const [w] = await db
    .insert(workspaces)
    .values({
      accountId: a!.id,
      name: "alerts",
      slug: `al-${Math.random().toString(36).slice(2, 9)}`,
    })
    .returning();
  const mk = async (role: string) => {
    const [u] = await db
      .insert(users)
      .values({
        email: `${role}-${Math.random().toString(36).slice(2, 8)}@example.test`,
        passwordHash: "x",
        name: role,
      })
      .returning();
    await db
      .insert(memberships)
      .values({ userId: u!.id, workspaceId: w!.id, accountId: a!.id, role });
    return u!;
  };
  const owner = await mk("owner");
  const viewer = await mk("viewer");
  const [q] = await db
    .insert(queries)
    .values({
      workspaceId: w!.id,
      name: brand,
      booleanText: `"${brand}"`,
      status: "live",
      backfillStatus: "done",
      releasedThrough: from,
      createdBy: owner.id,
    })
    .returning();
  return { a: a!, w: w!, q: q!, owner, viewer };
}

async function addRule(
  f: Awaited<ReturnType<typeof fixture>>,
  over: Partial<typeof alertRules.$inferInsert> = {},
) {
  const [r] = await db
    .insert(alertRules)
    .values({
      workspaceId: f.w.id,
      queryId: f.q.id,
      name: "Volume spike",
      type: "volume_spike",
      params: { multiple: 3, minVolume: 20 },
      channels: ["in_app", "email"],
      createdBy: f.owner.id,
      ...over,
    })
    .returning();
  return r!;
}

/** Run release cycles from `from` to `to`; return the first cycle at which the condition holds on its own. */
async function replay(
  f: Awaited<ReturnType<typeof fixture>>,
  from: number,
  to: number,
  step: number,
) {
  let firstTrue: number | null = null;
  for (let t = from; t <= to; t += step) {
    await runRelease(f.q.id, new Date(t));
    if (firstTrue === null) {
      const until = new Date(Math.floor(t / step) * step);
      const v = evaluate(
        "volume_spike",
        { multiple: 3, minVolume: 20 } as Params["volume_spike"],
        await observe(f.w.id, f.q.id, until),
      );
      if (v.fired) firstTrue = until.getTime();
    }
  }
  return firstTrue;
}

describe("alerts on an injected crisis", () => {
  it("fires within one release cycle on a real-time plan, and notifies by email", async () => {
    const crisis = await pickCrisis();
    const start = crisis.start.getTime();
    const f = await fixture("agency", crisis.brand, new Date(start - 8 * 86_400_000));
    // Catch up on the quiet week first (before the rule exists), then watch cycle by cycle.
    await runRelease(f.q.id, new Date(start - 3 * HOUR_MS));
    const rule = await addRule(f);

    const firstTrue = await replay(f, start - 3 * HOUR_MS + CYCLE, start + 12 * HOUR_MS, CYCLE);
    expect(firstTrue, "the crisis should trip the condition on its own").not.toBeNull();

    const events = await db.select().from(alertEvents).where(eq(alertEvents.ruleId, rule.id));
    expect(events.length).toBeGreaterThanOrEqual(1);
    const first = events.sort((x, y) => x.firedAt.getTime() - y.firedAt.getTime())[0]!;
    // Same cycle the condition became true — not a cycle later.
    expect(first.firedAt.getTime() - firstTrue!).toBeLessThanOrEqual(CYCLE);
    expect(first.firedAt.getTime()).toBeGreaterThanOrEqual(firstTrue!);
    // ...and early in the crisis, not after it has already peaked and passed.
    expect(first.firedAt.getTime() - start).toBeLessThan(12 * HOUR_MS);
    expect(first.status).toBe("new");
    expect(first.summary).toMatch(/× the usual/);

    // Cooldown (60 min): firings are at least an hour apart.
    const times = events.map((e) => e.firedAt.getTime()).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++)
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(60 * 60_000);

    // Editors/owners are emailed; viewers are not.
    const mail = await db.select().from(emails).where(eq(emails.type, "alert"));
    const ownerMail = mail.filter((m) => m.toUserId === f.owner.id);
    expect(ownerMail.length).toBe(events.length);
    expect(ownerMail[0]!.bodyText).toContain(`/w/${f.w.slug}/alerts/events/`);
    expect(mail.some((m) => m.toUserId === f.viewer.id)).toBe(false);
  }, 180_000);

  it("a slower plan sees the same crisis later, never earlier", async () => {
    const crisis = await pickCrisis();
    const start = crisis.start.getTime();
    const fast = await fixture("agency", crisis.brand, new Date(start - 8 * 86_400_000));
    const slow = await fixture("growth", crisis.brand, new Date(start - 8 * 86_400_000));
    for (const f of [fast, slow]) await runRelease(f.q.id, new Date(start - 3 * HOUR_MS));
    const rf = await addRule(fast);
    const rs = await addRule(slow);
    for (let t = start - 3 * HOUR_MS + CYCLE; t <= start + 12 * HOUR_MS; t += CYCLE) {
      await runRelease(fast.q.id, new Date(t));
      await runRelease(slow.q.id, new Date(t));
    }
    const firstAt = async (id: string) =>
      (await db.select().from(alertEvents).where(eq(alertEvents.ruleId, id)))
        .map((e) => e.firedAt.getTime())
        .sort((a, b) => a - b)[0];
    const tf = await firstAt(rf.id);
    const ts = await firstAt(rs.id);
    expect(tf).toBeDefined();
    expect(ts).toBeDefined();
    expect(ts!).toBeGreaterThanOrEqual(tf!);
    expect(ts! % HOUR_MS).toBe(0); // hourly plan: fires on the hour
    expect(ts! - tf!).toBeLessThanOrEqual(HOUR_MS + CYCLE);
  }, 240_000);

  it("a muted rule never fires, even in the middle of a crisis", async () => {
    const crisis = await pickCrisis();
    const start = crisis.start.getTime();
    const f = await fixture("agency", crisis.brand, new Date(start - 8 * 86_400_000));
    await runRelease(f.q.id, new Date(start - 3 * HOUR_MS));
    const muted = await addRule(f, { status: "muted" });
    // Jump into the crisis, then evaluate directly as the release job would.
    await runRelease(f.q.id, new Date(start + 6 * HOUR_MS));
    expect(await evaluateAlerts(f.q.id, new Date(start + 6 * HOUR_MS))).toEqual([]);
    expect(await db.select().from(alertEvents).where(eq(alertEvents.ruleId, muted.id))).toEqual([]);
  }, 180_000);
});
