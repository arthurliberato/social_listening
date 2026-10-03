// M8 acceptance: the simulated clock can run a trial to its end, a renewal, and a failed payment,
// and entitlements change the moment the plan does.
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  accounts,
  alertRules,
  db,
  emails,
  invoices,
  memberships,
  pool,
  queries,
  users,
  workspaces,
} from "@/db/client";
import { runRelease } from "@/jobs/release";
import { evaluateAlerts } from "@/lib/alerts/engine";
import { accountPlan } from "@/lib/queries";
import { isReadOnly, runBillingLifecycle as runAll, updateCard } from "./lifecycle";
import { addPeriod } from "./pricing";
import {
  acceptSaveOffer,
  changePlan,
  confirmCancel,
  getAccount,
  resumeSubscription,
  showSaveOffer,
  subscribe,
} from "./service";
import { downgradeBlockers } from "./usage";

afterAll(() => pool.end());

// Each test drives the clock for its own account only, so far-future dates can't touch anyone else's.
const scope: string[] = [];
const runBillingLifecycle = (now: Date) => runAll(now, [scope[scope.length - 1]!]);

const DAY = 86_400_000;
const T0 = new Date("2026-10-01T09:00:00Z");
const GOOD = {
  number: "4242 4242 4242 4242",
  expMonth: 12,
  expYear: 2030,
  cvc: "123",
  name: "Pat Owner",
};
const FAILS_LATER = { ...GOOD, number: "4000 0000 0000 0341" };

async function fixture(o: { liveQueries?: number } = {}) {
  const [a] = await db
    .insert(accounts)
    .values({
      name: "bill",
      trialStartAt: T0,
      trialEndAt: new Date(T0.getTime() + 14 * DAY),
      createdAt: T0,
    })
    .returning();
  const [w] = await db
    .insert(workspaces)
    .values({
      accountId: a!.id,
      name: "bill",
      slug: `bl-${Math.random().toString(36).slice(2, 9)}`,
    })
    .returning();
  const [u] = await db
    .insert(users)
    .values({
      email: `owner-${Math.random().toString(36).slice(2, 8)}@example.test`,
      passwordHash: "x",
      name: "Pat Owner",
    })
    .returning();
  await db
    .insert(memberships)
    .values({ userId: u!.id, workspaceId: w!.id, accountId: a!.id, role: "owner" });
  const qs = [];
  for (let i = 0; i < (o.liveQueries ?? 1); i++) {
    const [q] = await db
      .insert(queries)
      .values({
        workspaceId: w!.id,
        name: `q${i}`,
        booleanText: "voltara",
        status: "live",
        backfillStatus: "done",
        releasedThrough: T0,
        createdBy: u!.id,
      })
      .returning();
    qs.push(q!);
  }
  scope.push(a!.id);
  return { a: a!, w: w!, u: u!, qs };
}
const status = async (id: string) => (await getAccount(id))!;
const mail = async (userId: string, type?: string) =>
  (await db.select().from(emails).where(eq(emails.toUserId, userId))).filter(
    (m) => !type || m.type === type,
  );
const evCount = async (userId: string, name: string) =>
  Number(
    (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM analytics_events WHERE user_id = ${userId}::uuid AND name = ${name}`,
      )
    ).rows[0]!.n,
  );
const actions = (r: { action: string }[]) => r.map((x) => x.action);
const mine = (r: { accountId: string; action: string }[], id: string) =>
  actions(r.filter((x) => x.accountId === id));

describe("trial lifecycle", () => {
  it("reminds, ends into a grace period, then locks to read-only, and never repeats itself", async () => {
    const f = await fixture();
    const at = (days: number) => new Date(T0.getTime() + days * DAY);

    expect(mine(await runBillingLifecycle(at(5)), f.a.id)).toEqual([]);
    expect(mine(await runBillingLifecycle(at(11.5)), f.a.id)).toEqual(["trial_reminder_3d"]);
    expect(mine(await runBillingLifecycle(at(11.6)), f.a.id)).toEqual([]); // no duplicate
    expect(mine(await runBillingLifecycle(at(13.4)), f.a.id)).toEqual(["trial_reminder_1d"]);
    expect((await mail(f.u.id, "trial")).map((m) => m.subject)).toEqual([
      expect.stringContaining("3 days"),
      expect.stringContaining("tomorrow"),
    ]);

    // Day 14: the trial ends but nothing is switched off yet.
    expect(mine(await runBillingLifecycle(at(14.01)), f.a.id)).toEqual(["trial_ended"]);
    let a = await status(f.a.id);
    expect(a.billingStatus).toBe("grace");
    expect(isReadOnly(a.billingStatus)).toBe(false);
    expect(await evCount(f.u.id, "Trial Ended")).toBe(1);
    const ended = (
      await db.execute(
        sql`SELECT props FROM analytics_events WHERE user_id = ${f.u.id}::uuid AND name = 'Trial Ended'`,
      )
    ).rows[0]!.props as Record<string, unknown>;
    expect(ended).toMatchObject({ converted: false, queries_count: 1 });
    expect(mine(await runBillingLifecycle(at(15)), f.a.id)).toEqual([]);

    // Grace over: read-only, and the background work stops.
    expect(mine(await runBillingLifecycle(at(17.01)), f.a.id)).toEqual(["locked_trial"]);
    a = await status(f.a.id);
    expect(a.billingStatus).toBe("locked");
    expect(isReadOnly(a.billingStatus)).toBe(true);
    expect(await runRelease(f.qs[0]!.id, at(18))).toBeNull(); // no collection
    expect(await evaluateAlerts(f.qs[0]!.id, at(18))).toEqual([]);
    expect((await mail(f.u.id, "billing")).some((m) => /read-only/.test(m.subject))).toBe(true);
    expect(mine(await runBillingLifecycle(at(30)), f.a.id)).toEqual([]); // locked accounts stay put
  });

  it("subscribing during the trial converts it, and entitlements change the instant it succeeds", async () => {
    const f = await fixture();
    expect((await accountPlan(f.w.id)).tier).toBe("trial");
    const bad = await subscribe(
      {
        accountId: f.a.id,
        tier: "growth",
        interval: "monthly",
        card: { ...GOOD, number: "4242 4242 4242 4241" },
      },
      new Date(T0.getTime() + 3 * DAY),
    );
    expect(bad).toMatchObject({ ok: false, field: "number" });
    expect((await accountPlan(f.w.id)).tier).toBe("trial"); // nothing changed
    expect(
      await subscribe({
        accountId: f.a.id,
        tier: "growth",
        interval: "monthly",
        card: { ...GOOD, number: "4000000000000002" },
      }),
    ).toMatchObject({ ok: false });
    expect(
      await subscribe({ accountId: f.a.id, tier: "enterprise", interval: "monthly", card: GOOD }),
    ).toMatchObject({ ok: false });

    const now = new Date(T0.getTime() + 3 * DAY);
    const r = await subscribe(
      { accountId: f.a.id, tier: "growth", interval: "monthly", card: GOOD },
      now,
    );
    expect(r).toMatchObject({ ok: true });
    const p = await accountPlan(f.w.id);
    expect(p.tier).toBe("growth");
    expect(p.plan.alerts).toBe(20);
    expect(p.plan.features.crisisRoom).toBe(true);
    const a = await status(f.a.id);
    expect(a).toMatchObject({ billingStatus: "active", cancelAtPeriodEnd: false });
    expect(a.currentPeriodEnd!.toISOString()).toBe(addPeriod(now, "monthly").toISOString());

    const [inv] = await db.select().from(invoices).where(eq(invoices.accountId, f.a.id));
    expect(inv).toMatchObject({ kind: "subscription", amountCents: 24_900, status: "paid" });
    const receipt = (await mail(f.u.id, "receipt"))[0]!;
    expect(receipt.subject).toMatch(/Receipt RW-\d{6} from Ripplewise — \$249/);
    expect(receipt.bodyText).not.toMatch(/4242/); // no card number anywhere
    expect(await evCount(f.u.id, "Subscription Started")).toBe(1);
    const trialEnded = (
      await db.execute(
        sql`SELECT props FROM analytics_events WHERE user_id = ${f.u.id}::uuid AND name = 'Trial Ended'`,
      )
    ).rows[0]!.props as Record<string, unknown>;
    expect(trialEnded).toMatchObject({ converted: true, trial_day_reached: 4 });

    // Already subscribed: use "change plan" instead.
    expect(
      await subscribe({ accountId: f.a.id, tier: "agency", interval: "monthly", card: GOOD }),
    ).toMatchObject({ ok: false });
    // The lifecycle leaves a paid account alone until the period ends.
    expect(mine(await runBillingLifecycle(new Date(now.getTime() + 10 * DAY)), f.a.id)).toEqual([]);
  });

  it("a locked account can subscribe and comes straight back to life", async () => {
    const f = await fixture();
    await runBillingLifecycle(new Date(T0.getTime() + 14.01 * DAY));
    await runBillingLifecycle(new Date(T0.getTime() + 17.01 * DAY));
    expect((await status(f.a.id)).billingStatus).toBe("locked");
    const now = new Date(T0.getTime() + 20 * DAY);
    expect(
      await subscribe({ accountId: f.a.id, tier: "starter", interval: "yearly", card: GOOD }, now),
    ).toMatchObject({ ok: true });
    const a = await status(f.a.id);
    expect(a.billingStatus).toBe("active");
    expect(isReadOnly(a.billingStatus)).toBe(false);
    expect(a.currentPeriodEnd!.toISOString()).toBe("2027-10-21T09:00:00.000Z");
    const [inv] = await db.select().from(invoices).where(eq(invoices.accountId, f.a.id));
    expect(inv!.amountCents).toBe(79_000); // ten months
  });
});

describe("plan changes", () => {
  it("upgrades start now with the unused time credited; downgrades wait for the renewal", async () => {
    const f = await fixture();
    const t = new Date(T0.getTime() + 1 * DAY);
    await subscribe({ accountId: f.a.id, tier: "starter", interval: "monthly", card: GOOD }, t);
    const end = (await status(f.a.id)).currentPeriodEnd!;
    const half = new Date(t.getTime() + (end.getTime() - t.getTime()) / 2);

    const up = await changePlan({ accountId: f.a.id, tier: "growth", interval: "monthly" }, half);
    expect(up).toMatchObject({
      ok: true,
      applied: "now",
      creditCents: 3_950,
      chargedCents: 20_950,
    }); // $249 − half of $79
    expect((await accountPlan(f.w.id)).tier).toBe("growth"); // instantly
    expect(await evCount(f.u.id, "Plan Upgraded")).toBe(1);
    const props = (
      await db.execute(
        sql`SELECT props FROM analytics_events WHERE user_id = ${f.u.id}::uuid AND name = 'Plan Upgraded'`,
      )
    ).rows[0]!.props as Record<string, unknown>;
    expect(props).toMatchObject({ from_plan: "starter", to_plan: "growth", mrr_delta: 170 });
    expect((await status(f.a.id)).currentPeriodStart!.toISOString()).toBe(half.toISOString());

    // Downgrade: scheduled, not applied.
    const down = await changePlan(
      { accountId: f.a.id, tier: "starter", interval: "monthly" },
      half,
    );
    expect(down).toMatchObject({ ok: true, applied: "scheduled" });
    let a = await status(f.a.id);
    expect(a.planTier).toBe("growth");
    expect(a).toMatchObject({ pendingTier: "starter" });
    // Choosing the current plan again cancels the scheduled change.
    expect(
      await changePlan({ accountId: f.a.id, tier: "growth", interval: "monthly" }, half),
    ).toMatchObject({ ok: true });
    expect((await status(f.a.id)).pendingTier).toBeNull();

    // Schedule again and let the renewal apply it.
    await changePlan({ accountId: f.a.id, tier: "starter", interval: "monthly" }, half);
    a = await status(f.a.id);
    const r = await runBillingLifecycle(new Date(a.currentPeriodEnd!.getTime() + 60_000));
    expect(mine(r, f.a.id)).toEqual(["downgraded"]);
    a = await status(f.a.id);
    expect(a.planTier).toBe("starter");
    expect(await evCount(f.u.id, "Plan Downgraded")).toBe(1);
    const last = (
      await db
        .select()
        .from(invoices)
        .where(eq(invoices.accountId, f.a.id))
        .orderBy(sql`created_at DESC`)
    )[0]!;
    expect(last).toMatchObject({ kind: "renewal", amountCents: 7_900, status: "paid" });
  });

  it("refuses a downgrade the account doesn't fit, and says what to fix", async () => {
    const f = await fixture({ liveQueries: 5 });
    const t = new Date(T0.getTime() + DAY);
    await subscribe({ accountId: f.a.id, tier: "growth", interval: "monthly", card: GOOD }, t);
    const r = await changePlan({ accountId: f.a.id, tier: "starter", interval: "monthly" }, t);
    expect(r).toMatchObject({ ok: false });
    expect((r as { blockers: string[] }).blockers).toEqual([
      expect.stringContaining("Pause 2 active queries"),
    ]);
    expect((await status(f.a.id)).pendingTier).toBeNull();
    expect(await downgradeBlockers(f.a.id, "agency")).toEqual([]);
    // Fix it, and it schedules.
    await db.update(queries).set({ status: "paused" }).where(eq(queries.id, f.qs[0]!.id));
    await db.update(queries).set({ status: "paused" }).where(eq(queries.id, f.qs[1]!.id));
    expect(
      await changePlan({ accountId: f.a.id, tier: "starter", interval: "monthly" }, t),
    ).toMatchObject({ ok: true, applied: "scheduled" });
    // If they go over again before the renewal, the renewal keeps the current plan and says why.
    await db.update(queries).set({ status: "live" }).where(eq(queries.id, f.qs[0]!.id));
    await db.update(queries).set({ status: "live" }).where(eq(queries.id, f.qs[1]!.id));
    const a = await status(f.a.id);
    const out = await runBillingLifecycle(new Date(a.currentPeriodEnd!.getTime() + 60_000));
    expect(mine(out, f.a.id)).toEqual(["downgrade_blocked"]);
    expect((await status(f.a.id)).planTier).toBe("growth");
    expect(
      (await mail(f.u.id, "billing")).some((m) => /couldn't move you to Starter/.test(m.subject)),
    ).toBe(true);
  });

  it("a plan's switched-off features stop working the moment it's downgraded", async () => {
    const f = await fixture();
    await db
      .update(accounts)
      .set({
        planTier: "growth",
        billingStatus: "active",
        currentPeriodStart: T0,
        currentPeriodEnd: new Date(T0.getTime() + 30 * DAY),
      })
      .where(eq(accounts.id, f.a.id));
    await db.insert(alertRules).values({
      workspaceId: f.w.id,
      queryId: f.qs[0]!.id,
      name: "neg",
      type: "sentiment_drop",
      params: { negativeShare: 0.2, minVolume: 5 },
      createdBy: f.u.id,
    });
    await db.update(accounts).set({ planTier: "starter" }).where(eq(accounts.id, f.a.id));
    // (No observation can fire it now: the rule type isn't on Starter.)
    expect(await evaluateAlerts(f.qs[0]!.id, new Date(T0.getTime() + DAY))).toEqual([]);
  });
});

describe("renewal, failed payments and dunning", () => {
  it("renews on schedule, and a discounted renewal charges less", async () => {
    const f = await fixture();
    await subscribe({ accountId: f.a.id, tier: "growth", interval: "monthly", card: GOOD }, T0);
    let a = await status(f.a.id);
    const end1 = a.currentPeriodEnd!;
    expect(mine(await runBillingLifecycle(new Date(end1.getTime() - 60_000)), f.a.id)).toEqual([]);
    expect(mine(await runBillingLifecycle(new Date(end1.getTime() + 60_000)), f.a.id)).toEqual([
      "renewed",
    ]);
    a = await status(f.a.id);
    expect(a.currentPeriodStart!.toISOString()).toBe(end1.toISOString()); // no gap, no overlap
    expect(a.currentPeriodEnd!.toISOString()).toBe(addPeriod(end1, "monthly").toISOString());
    // Not twice.
    expect(mine(await runBillingLifecycle(new Date(end1.getTime() + 120_000)), f.a.id)).toEqual([]);
    expect(
      (await db.select().from(invoices).where(eq(invoices.accountId, f.a.id))).filter(
        (i) => i.kind === "renewal",
      ),
    ).toHaveLength(1);
  });

  it("a card that fails on renewal: retries on a schedule, keeps access, then suspends", async () => {
    const f = await fixture();
    await subscribe(
      { accountId: f.a.id, tier: "growth", interval: "monthly", card: FAILS_LATER },
      T0,
    );
    const due = (await status(f.a.id)).currentPeriodEnd!;
    const at = (d: number, extra = 60_000) => new Date(due.getTime() + d * DAY + extra);

    expect(mine(await runBillingLifecycle(at(0)), f.a.id)).toEqual(["renewal_failed"]);
    let a = await status(f.a.id);
    expect(a).toMatchObject({ billingStatus: "past_due", dunningAttempts: 1 });
    expect(a.nextRetryAt!.toISOString()).toBe(new Date(due.getTime() + 1 * DAY).toISOString());
    expect(isReadOnly(a.billingStatus)).toBe(false); // access continues while we retry
    expect(a.planTier).toBe("growth");
    expect((await mail(f.u.id, "dunning"))[0]!.subject).toMatch(
      /Payment failed — we'll try again on/,
    );
    const failed = (await db.select().from(invoices).where(eq(invoices.accountId, f.a.id))).filter(
      (i) => i.status === "failed",
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.failureReason).toMatch(/declined/);

    expect(mine(await runBillingLifecycle(at(0.5)), f.a.id)).toEqual([]); // not yet
    expect(mine(await runBillingLifecycle(at(1)), f.a.id)).toEqual(["retry_failed"]);
    expect(mine(await runBillingLifecycle(at(1.1)), f.a.id)).toEqual([]);
    expect(mine(await runBillingLifecycle(at(3)), f.a.id)).toEqual(["retry_failed"]);
    a = await status(f.a.id);
    expect(a).toMatchObject({ billingStatus: "past_due", dunningAttempts: 3 });
    expect(mine(await runBillingLifecycle(at(5)), f.a.id)).toEqual(["locked_payment"]);
    a = await status(f.a.id);
    expect(a.billingStatus).toBe("locked");
    expect(isReadOnly(a.billingStatus)).toBe(true);
    expect(await evCount(f.u.id, "Payment Failed")).toBe(4);
    const dunning = await mail(f.u.id, "dunning");
    expect(dunning).toHaveLength(4);
    expect(dunning[3]!.subject).toMatch(/Final notice/);
    expect((await mail(f.u.id, "billing")).some((m) => /suspended/.test(m.subject))).toBe(true);
  });

  it("updating the card fixes a past-due account at once", async () => {
    const f = await fixture();
    await subscribe(
      { accountId: f.a.id, tier: "growth", interval: "monthly", card: FAILS_LATER },
      T0,
    );
    const due = (await status(f.a.id)).currentPeriodEnd!;
    await runBillingLifecycle(new Date(due.getTime() + 60_000));
    expect((await status(f.a.id)).billingStatus).toBe("past_due");

    const bad = await updateCard(
      { accountId: f.a.id, card: { ...GOOD, number: "4000 0000 0000 0002" } },
      new Date(due.getTime() + 2 * 3_600_000),
    );
    expect(bad).toMatchObject({ ok: false });
    expect((await status(f.a.id)).billingStatus).toBe("past_due");

    const fixed = await updateCard(
      { accountId: f.a.id, card: GOOD },
      new Date(due.getTime() + 3 * 3_600_000),
    );
    expect(fixed).toEqual({ ok: true, retried: "retry_succeeded" });
    const a = await status(f.a.id);
    expect(a).toMatchObject({ billingStatus: "active", dunningAttempts: 0, nextRetryAt: null });
    expect(a.currentPeriodStart!.toISOString()).toBe(
      new Date(due.getTime() + 3 * 3_600_000).toISOString(),
    );
    // Only the new card is the default.
    const methods = (
      await db.execute(
        sql`SELECT is_default, last4 FROM payment_methods WHERE account_id = ${f.a.id}::uuid ORDER BY created_at`,
      )
    ).rows as { is_default: boolean; last4: string }[];
    expect(methods.filter((m) => m.is_default)).toHaveLength(1);
    expect(methods.filter((m) => m.is_default)[0]!.last4).toBe("4242");
  });
});

describe("cancellation", () => {
  it("the save offer is shown once, applies a discount, and a later cancel goes through", async () => {
    const f = await fixture();
    await subscribe({ accountId: f.a.id, tier: "growth", interval: "monthly", card: GOOD }, T0);
    // The offer can't be accepted before it has been shown.
    expect(await acceptSaveOffer(f.a.id)).toMatchObject({ ok: false });
    expect(await showSaveOffer(f.a.id)).toBe(true);
    expect(await showSaveOffer(f.a.id)).toBe(false); // never twice
    expect(await acceptSaveOffer(f.a.id)).toEqual({ ok: true });
    expect(await acceptSaveOffer(f.a.id)).toMatchObject({ ok: false }); // and not stackable
    let a = await status(f.a.id);
    expect(a).toMatchObject({ discountPct: 25, discountCyclesLeft: 2, cancelAtPeriodEnd: false });

    // Two discounted renewals, then full price.
    const charges: number[] = [];
    for (let i = 0; i < 3; i++) {
      a = await status(f.a.id);
      await runBillingLifecycle(new Date(a.currentPeriodEnd!.getTime() + 60_000));
      const inv = (
        await db
          .select()
          .from(invoices)
          .where(eq(invoices.accountId, f.a.id))
          .orderBy(sql`seq DESC`)
      )[0]!;
      charges.push(inv.amountCents);
    }
    expect(charges).toEqual([18_675, 18_675, 24_900]);
    expect((await status(f.a.id)).discountPct).toBe(0);
  });

  it("cancelling keeps access to the end of the period, can be undone, and then takes effect", async () => {
    const f = await fixture();
    await subscribe({ accountId: f.a.id, tier: "growth", interval: "monthly", card: GOOD }, T0);
    const end = (await status(f.a.id)).currentPeriodEnd!;
    const r = await confirmCancel(
      { accountId: f.a.id, reason: "too_expensive" },
      new Date(T0.getTime() + 10 * DAY),
    );
    expect(r).toEqual({ ok: true, endsOn: end });
    let a = await status(f.a.id);
    expect(a).toMatchObject({
      cancelAtPeriodEnd: true,
      cancelReason: "too_expensive",
      planTier: "growth",
    });
    expect(
      (await mail(f.u.id, "billing")).some((m) => /cancellation is confirmed/.test(m.subject)),
    ).toBe(true);
    const ev = (
      await db.execute(
        sql`SELECT props FROM analytics_events WHERE user_id = ${f.u.id}::uuid AND name = 'Subscription Canceled'`,
      )
    ).rows[0]!.props as Record<string, unknown>;
    expect(ev).toMatchObject({ reason: "too_expensive", tenure_days: 10 });

    // Changed my mind.
    expect(await resumeSubscription(f.a.id)).toEqual({ ok: true });
    expect((await status(f.a.id)).cancelAtPeriodEnd).toBe(false);
    expect(await resumeSubscription(f.a.id)).toMatchObject({ ok: false });

    await confirmCancel(
      { accountId: f.a.id, reason: "not_using" },
      new Date(T0.getTime() + 11 * DAY),
    );
    expect(mine(await runBillingLifecycle(new Date(end.getTime() - 60_000)), f.a.id)).toEqual([]); // still theirs
    expect(mine(await runBillingLifecycle(new Date(end.getTime() + 60_000)), f.a.id)).toEqual([
      "canceled",
    ]);
    a = await status(f.a.id);
    expect(a).toMatchObject({ billingStatus: "canceled", planTier: "trial" });
    expect(isReadOnly(a.billingStatus)).toBe(true);
    // No charge on the way out.
    expect(
      (await db.select().from(invoices).where(eq(invoices.accountId, f.a.id))).filter(
        (i) => i.kind === "renewal",
      ),
    ).toHaveLength(0);
    expect(await resumeSubscription(f.a.id)).toMatchObject({ ok: false });
    // They can come back any time.
    expect(
      await subscribe(
        { accountId: f.a.id, tier: "starter", interval: "monthly", card: GOOD },
        new Date(end.getTime() + 5 * DAY),
      ),
    ).toMatchObject({ ok: true });
  });
});
