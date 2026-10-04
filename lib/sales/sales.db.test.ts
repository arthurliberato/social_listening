// M11: contact → quote → contract, and the nightly PQA/health job.
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  accountScores,
  accounts,
  alertRules,
  analyticsEvents,
  auditLog,
  contracts,
  dashboards,
  db,
  emails,
  memberships,
  pool,
  queries,
  quotes,
  salesRequests,
  usageCounters,
  users,
  workspaces,
} from "@/db/client";
import { runNightlyScoring, SDR_ADDRESS } from "@/jobs/pqa";
import { limits } from "@/lib/entitlements/plans";
import { periodOf } from "@/lib/usage";
import { runSalesDesk } from "./desk";
import { quoteValueCents } from "./pricing";
import {
  acceptQuote,
  demoSlots,
  findQuote,
  markViewed,
  signContract,
  submitRequest,
} from "./service";

afterAll(() => pool.end());
const rnd = () => Math.random().toString(36).slice(2, 9);

async function account(tier = "growth", roles: string[] = ["owner"]) {
  const [a] = await db
    .insert(accounts)
    .values({ name: `Co ${rnd()}`, planTier: tier, billingStatus: "active" })
    .returning();
  const [w] = await db
    .insert(workspaces)
    .values({ accountId: a!.id, name: "w", slug: `s-${rnd()}` })
    .returning();
  const people = [];
  for (const role of roles) {
    const [u] = await db
      .insert(users)
      .values({ email: `${role}-${rnd()}@example.test`, passwordHash: "x", name: `${role} person` })
      .returning();
    await db
      .insert(memberships)
      .values({ userId: u!.id, workspaceId: w!.id, accountId: a!.id, role });
    people.push(u!);
  }
  return { a: a!, w: w!, people };
}

const NOW = new Date("2026-09-01T10:00:00Z");
const form = (over: Record<string, unknown> = {}) => ({
  kind: "contact",
  name: "Dana Rep",
  email: "dana@example.test",
  company: "Acme",
  seats: 40,
  entryPoint: "pricing_enterprise",
  ...over,
});

async function quoteTokenFor(email: string): Promise<string> {
  const [m] = await db
    .select()
    .from(emails)
    .where(
      and(
        eq(emails.toAddress, email),
        sql`${emails.subject} LIKE 'Your Ripplewise Enterprise quote%'`,
      ),
    );
  return /\/quote\/([0-9a-f]{48})/.exec(m!.bodyText)![1]!;
}

describe("quotes", () => {
  it("prices seats and term, with longer terms cheaper per month", () => {
    expect(quoteValueCents(40, 12)).toBe(Math.round((150_000 + 4_000 * 40) * 12 * 0.9));
    expect(quoteValueCents(40, 36) / 36).toBeLessThan(quoteValueCents(40, 12) / 12);
  });
});

describe("contact → quote → contract", () => {
  it("runs the whole path and upgrades the account exactly once", async () => {
    const { a, w, people } = await account("growth", ["owner", "viewer"]);
    const [owner, viewer] = people as [(typeof people)[0], (typeof people)[0]];
    const email = `lead-${rnd()}@example.test`;
    const r = await submitRequest(
      form({ email }),
      { userId: owner.id, accountId: a.id, workspaceId: w.id },
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The rep answers after ten minutes, not before.
    expect(await runSalesDesk(new Date(NOW.getTime() + 5 * 60_000), [r.id])).toEqual([]);
    expect(await runSalesDesk(new Date(NOW.getTime() + 11 * 60_000), [r.id])).toHaveLength(1);
    expect(await runSalesDesk(new Date(NOW.getTime() + 30 * 60_000), [r.id])).toEqual([]); // once only

    const token = await quoteTokenFor(email);
    const f = await findQuote(token);
    expect(f?.quote).toMatchObject({ status: "sent", seats: 40, termMonths: 12 });
    expect(await markViewed(f!.quote.id, NOW)).toBe(true);
    expect(await markViewed(f!.quote.id, NOW)).toBe(false);

    // Can't sign before accepting.
    expect(await signContract(token, owner, "Owner Person", NOW)).toMatchObject({ ok: false });
    expect(await acceptQuote(token, NOW)).toEqual({ ok: true });
    // A viewer can't sign for the account.
    expect(await signContract(token, viewer, "Viewer Person", NOW)).toMatchObject({
      ok: false,
      error: expect.stringContaining("owner or admin"),
    });
    expect((await signContract(token, owner, "x", NOW)).ok).toBe(false); // signature too short

    const [s1, s2] = await Promise.all([
      signContract(token, owner, "Owner Person", NOW),
      signContract(token, owner, "Owner Person", NOW),
    ]);
    expect([s1.ok, s2.ok].sort()).toEqual([false, true]);
    const [acct] = await db.select().from(accounts).where(eq(accounts.id, a.id));
    expect(acct).toMatchObject({
      planTier: "enterprise",
      motion: "sales_assisted",
      billingStatus: "active",
    });
    expect(acct!.currentPeriodEnd!.toISOString().slice(0, 10)).toBe("2027-09-01");
    expect(await db.select().from(contracts).where(eq(contracts.accountId, a.id))).toHaveLength(1);
    const [q] = await db.select().from(quotes).where(eq(quotes.id, f!.quote.id));
    expect(q!.status).toBe("signed");
    expect(
      await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.accountId, a.id), eq(auditLog.action, "contract.signed"))),
    ).toHaveLength(1);
    const ev = await db
      .select()
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.accountId, a.id), eq(analyticsEvents.name, "Contract Signed")));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.props).toMatchObject({ contract_months: 12, plan_tier: "enterprise" });
    // Enterprise limits apply immediately.
    expect(limits("enterprise").seats).toBeGreaterThan(limits("growth").seats);
  }, 60_000);

  it("an expired quote can be neither accepted nor signed", async () => {
    const { a, people } = await account("growth");
    const email = `old-${rnd()}@example.test`;
    const r = await submitRequest(form({ email }), { userId: people[0]!.id, accountId: a.id }, NOW);
    if (!r.ok) throw new Error("setup");
    await runSalesDesk(new Date(NOW.getTime() + 11 * 60_000), [r.id]);
    const token = await quoteTokenFor(email);
    const late = new Date(NOW.getTime() + 40 * 86_400_000);
    expect(await acceptQuote(token, late)).toMatchObject({ ok: false });
    expect(await signContract(token, people[0]!, "Owner Person", late)).toMatchObject({
      ok: false,
    });
    expect((await db.select().from(accounts).where(eq(accounts.id, a.id)))[0]!.planTier).toBe(
      "growth",
    );
  });

  it("validates the form and never stores a bad request", async () => {
    const before = (await db.select().from(salesRequests)).length;
    expect(await submitRequest(form({ email: "nope" }), {}, NOW)).toMatchObject({ ok: false });
    expect(await submitRequest(form({ seats: 0 }), {}, NOW)).toMatchObject({ ok: false });
    expect(await submitRequest(form({ kind: "demo" }), {}, NOW)).toMatchObject({ ok: false });
    expect(
      await submitRequest(form({ kind: "demo", demoAt: "2026-09-01T03:00:00.000Z" }), {}, NOW),
    ).toMatchObject({ ok: false });
    expect((await db.select().from(salesRequests)).length).toBe(before);
  });

  it("an anonymous visitor can ask, and a demo is booked, then followed up with a quote", async () => {
    const email = `anon-${rnd()}@example.test`;
    const slot = demoSlots(NOW)[0]!;
    const r = await submitRequest(
      form({ kind: "demo", email, demoAt: slot.toISOString() }),
      {},
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      (await db.select().from(salesRequests).where(eq(salesRequests.id, r.id)))[0]!.status,
    ).toBe("demo_booked");
    expect(await runSalesDesk(new Date(slot.getTime() - 1000), [r.id])).toEqual([]); // not before the demo
    expect(await runSalesDesk(new Date(slot.getTime() + 60_000), [r.id])).toHaveLength(1);
    expect(await quoteTokenFor(email)).toMatch(/^[0-9a-f]{48}$/);
    const ev = await db
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.name, "Demo Booked"));
    expect(ev.some((e) => (e.props as { seats_requested?: number }).seats_requested === 40)).toBe(
      true,
    );
  });

  it("demo slots are weekdays, in the future, at set hours", () => {
    for (const s of demoSlots(NOW, 10)) {
      expect(s.getTime()).toBeGreaterThan(NOW.getTime());
      expect([0, 6]).not.toContain(s.getUTCDay());
      expect([14, 16]).toContain(s.getUTCHours());
    }
  });
});

describe("nightly scoring", () => {
  async function powerAccount() {
    const { a, w, people } = await account("growth", ["owner", "editor", "viewer"]);
    for (let i = 0; i < 3; i++)
      await db.insert(queries).values({
        workspaceId: w.id,
        name: `q${i}`,
        booleanText: `"q${i}"`,
        status: "live",
        createdBy: people[0]!.id,
      });
    const [q] = await db.select().from(queries).where(eq(queries.workspaceId, w.id)).limit(1);
    await db.insert(alertRules).values({
      workspaceId: w.id,
      queryId: q!.id,
      name: "a",
      type: "volume_spike",
      params: {},
      channels: ["in_app"],
      createdBy: people[0]!.id,
    });
    for (let i = 0; i < 2; i++)
      await db
        .insert(dashboards)
        .values({ workspaceId: w.id, name: `d${i}`, createdBy: people[0]!.id });
    await db.insert(usageCounters).values({
      accountId: a.id,
      period: periodOf(NOW),
      metric: "mentions",
      value: Math.round(limits("growth").mentionsPerMonth * 0.9),
    });
    for (let d = 0; d < 9; d++)
      await db.insert(analyticsEvents).values({
        name: "Mention Viewed",
        side: "client",
        userId: people[d % 3]!.id,
        accountId: a.id,
        ts: new Date(NOW.getTime() - d * 86_400_000 - 3600_000),
        props: {},
      });
    return a;
  }

  it("scores, stores the day's row, and tells sales once about a qualified account", async () => {
    const a = await powerAccount();
    const [r1] = await runNightlyScoring(NOW, [a.id]);
    expect(r1!.pqa).toBeGreaterThanOrEqual(60);
    expect(r1!.band).toBe("healthy");
    expect(r1!.sdrNotified).toBe(true);
    const [row] = await db.select().from(accountScores).where(eq(accountScores.accountId, a.id));
    expect(row).toMatchObject({ day: "2026-09-01", healthBand: "healthy" });
    expect((row!.signals as { pqaReasons: string[] }).pqaReasons.length).toBeGreaterThan(3);
    const mail = await db
      .select()
      .from(emails)
      .where(
        and(eq(emails.toAddress, SDR_ADDRESS), sql`${emails.subject} LIKE ${"%" + a.name + "%"}`),
      );
    expect(mail).toHaveLength(1);
    expect(mail[0]!.bodyText).toContain("Why:");

    // Re-running the same night, or the next, doesn't re-notify or duplicate the row.
    const again = await runNightlyScoring(NOW, [a.id]);
    expect(again[0]!.sdrNotified).toBe(false);
    const next = await runNightlyScoring(new Date(NOW.getTime() + 86_400_000), [a.id]);
    expect(next[0]!.sdrNotified).toBe(false);
    expect(
      await db.select().from(accountScores).where(eq(accountScores.accountId, a.id)),
    ).toHaveLength(2);
    // Once the quiet period has passed it may notify again (the stamp is wound back rather than the clock,
    // because activity and usage windows move with the clock too).
    await db
      .update(accounts)
      .set({
        lifecycle: sql`jsonb_set(lifecycle, '{pqaAlertedAt}', to_jsonb(${new Date(NOW.getTime() - 31 * 86_400_000).toISOString()}::text))`,
      })
      .where(eq(accounts.id, a.id));
    const later = await runNightlyScoring(NOW, [a.id]);
    expect(later[0]!.sdrNotified).toBe(true);
  }, 60_000);

  it("an account already talking to sales, or on Enterprise, is scored but never pinged", async () => {
    const a = await powerAccount();
    await submitRequest(form(), { accountId: a.id }, NOW);
    expect((await runNightlyScoring(NOW, [a.id]))[0]).toMatchObject({ sdrNotified: false });
    const b = await powerAccount();
    await db
      .update(accounts)
      .set({ planTier: "enterprise", motion: "sales_assisted" })
      .where(eq(accounts.id, b.id));
    expect((await runNightlyScoring(NOW, [b.id]))[0]).toMatchObject({ sdrNotified: false });
  }, 60_000);

  it("a silent account is at risk", async () => {
    const { a } = await account("starter");
    const [r] = await runNightlyScoring(NOW, [a.id]);
    expect(r).toMatchObject({ pqa: 0, band: "at_risk", sdrNotified: false });
  });
});
