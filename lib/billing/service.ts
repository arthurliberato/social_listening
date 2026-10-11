// Subscriptions: subscribe, change plan, cancel, resume, update card. All amounts are cents.
// Every state change updates the account row in one place, so entitlements follow immediately.
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  accounts,
  db,
  invoices,
  memberships,
  paymentMethods,
  users,
  workspaces,
} from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { sendEmail } from "@/lib/email/service";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { simNow } from "@/lib/simclock";
import { checkCard, type CardInput } from "./cards";
import { canceledEmail, receiptEmail } from "./emails";
import {
  addPeriod,
  daysBetween,
  isPaidTier,
  isUpgrade,
  money,
  mrrCents,
  periodPriceCents,
  SAVE_OFFER,
  TRIAL_DAYS,
  unusedCreditCents,
  type Interval,
} from "./pricing";
import { getProvider } from "./provider";
import { downgradeBlockers } from "./usage";

export type Account = typeof accounts.$inferSelect;
type Fail = { ok: false; error: string; field?: string; blockers?: string[] };

export async function getAccount(id: string): Promise<Account | undefined> {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, id));
  return a;
}

/** Owners and admins: who gets billing emails and who the events are attributed to. */
export async function billingContacts(accountId: string) {
  return db
    .selectDistinct({ id: users.id, email: users.email, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(eq(memberships.accountId, accountId), inArray(memberships.role, ["owner", "admin"])),
    );
}

export async function eventCtx(accountId: string) {
  const contacts = await billingContacts(accountId);
  const owner = contacts.find((c) => c.role === "owner") ?? contacts[0];
  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.accountId, accountId))
    .limit(1);
  return { userId: owner?.id ?? null, workspaceId: ws?.id ?? null, accountId };
}

export async function emailContacts(
  accountId: string,
  type: "receipt" | "dunning" | "trial" | "billing",
  msg: { subject: string; text: string },
) {
  for (const c of await billingContacts(accountId))
    await sendEmail({ toUserId: c.id, to: c.email, type, subject: msg.subject, text: msg.text });
}

export const defaultMethod = async (accountId: string) =>
  (
    await db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.accountId, accountId), eq(paymentMethods.isDefault, true)))
  )[0];

const invoiceNumber = (seq: number) => `RW-${String(seq).padStart(6, "0")}`;

export async function recordInvoice(o: {
  accountId: string;
  kind: "subscription" | "upgrade" | "renewal" | "retry" | "addon";
  description: string;
  amountCents: number;
  discountCents?: number;
  status: "paid" | "failed";
  failureReason?: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  paymentMethodId?: string | null;
  now: Date;
}) {
  const [row] = await db
    .insert(invoices)
    .values({
      accountId: o.accountId,
      kind: o.kind,
      description: o.description,
      amountCents: o.amountCents,
      discountCents: o.discountCents ?? 0,
      status: o.status,
      failureReason: o.failureReason ?? null,
      periodStart: o.periodStart ?? null,
      periodEnd: o.periodEnd ?? null,
      paymentMethodId: o.paymentMethodId ?? null,
      createdAt: o.now,
    })
    .returning();
  return { ...row!, number: invoiceNumber(row!.seq) };
}

export async function sendReceipt(
  inv: { number: string; description: string; amountCents: number; discountCents: number },
  acct: { id: string },
  tier: PlanTier,
  next: Date | null,
) {
  await emailContacts(
    acct.id,
    "receipt",
    receiptEmail({ ...inv, plan: PLANS[tier].label, nextChargeOn: next }),
  );
}

export async function saveCard(
  accountId: string,
  card: CardInput,
  now: Date,
): Promise<
  { ok: true; id: string; behavior: "ok" | "fail_renewal"; brand: string; last4: string } | Fail
> {
  const c = checkCard(card, now);
  if (!c.ok) return { ok: false, error: c.error, field: c.field };
  await db
    .update(paymentMethods)
    .set({ isDefault: false })
    .where(eq(paymentMethods.accountId, accountId));
  const year = card.expYear < 100 ? 2000 + card.expYear : card.expYear;
  const [pm] = await db
    .insert(paymentMethods)
    .values({
      accountId,
      brand: c.brand,
      last4: c.last4,
      expMonth: card.expMonth,
      expYear: year,
      holderName: card.name.trim().slice(0, 80),
      behavior: c.behavior,
      isDefault: true,
    })
    .returning();
  return { ok: true, id: pm!.id, behavior: c.behavior, brand: c.brand, last4: c.last4 };
}

const activeQueryCount = async (accountId: string) =>
  Number(
    (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM queries q JOIN workspaces w ON w.id = q.workspace_id WHERE w.account_id = ${accountId}::uuid AND q.status = 'live'`,
      )
    ).rows[0]!.n,
  );

/** Start a paid plan from a trial, a lapsed account or a cancelled one. */
export async function subscribe(
  o: {
    accountId: string;
    tier: string;
    interval: Interval;
    card?: CardInput;
  },
  now: Date = simNow(),
): Promise<{ ok: true; invoiceNumber: string } | Fail> {
  const acct = await getAccount(o.accountId);
  if (!acct) return { ok: false, error: "We couldn't find that account." };
  if (!isPaidTier(o.tier))
    return {
      ok: false,
      error: "Choose Starter, Growth or Agency. Enterprise is arranged with our team.",
    };
  if (acct.billingStatus === "active" || acct.billingStatus === "past_due")
    return { ok: false, error: "You already have a plan. Change it from Billing." };
  const tier = o.tier as PlanTier;
  const price = periodPriceCents(tier, o.interval)!;

  const method = await defaultMethod(o.accountId);
  let methodId: string | null = method?.id ?? null;
  let behavior = (method?.behavior ?? "ok") as "ok" | "fail_renewal";
  let newCard = false;
  if (o.card) {
    const saved = await saveCard(o.accountId, o.card, now);
    if (!saved.ok) return saved;
    methodId = saved.id;
    behavior = saved.behavior;
    newCard = true;
  } else if (!method) return { ok: false, error: "Add a card to continue.", field: "number" };

  const res = await getProvider().charge({
    accountId: o.accountId,
    amountCents: price,
    description: `${PLANS[tier].label} plan, first ${o.interval === "yearly" ? "year" : "month"}`,
    method: { id: methodId!, behavior },
    kind: "first",
  });
  if (!res.ok) {
    if (newCard) await db.delete(paymentMethods).where(eq(paymentMethods.id, methodId!));
    return { ok: false, error: res.message, field: "number" };
  }

  const end = addPeriod(now, o.interval);
  const wasTrial = acct.billingStatus === "trialing" || acct.billingStatus === "grace";
  await db
    .update(accounts)
    .set({
      planTier: tier,
      billingInterval: o.interval,
      billingStatus: "active",
      currentPeriodStart: now,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      cancelReason: null,
      pendingTier: null,
      pendingInterval: null,
      dunningAttempts: 0,
      nextRetryAt: null,
    })
    .where(eq(accounts.id, o.accountId));
  const inv = await recordInvoice({
    accountId: o.accountId,
    kind: "subscription",
    description: `${PLANS[tier].label} plan, ${o.interval === "yearly" ? "yearly" : "monthly"}`,
    amountCents: price,
    status: "paid",
    periodStart: now,
    periodEnd: end,
    paymentMethodId: methodId,
    now,
  });
  await sendReceipt(inv, acct, tier, end);

  const ctx = await eventCtx(o.accountId);
  if (wasTrial && acct.trialStartAt)
    await trackServer("Trial Ended", ctx, {
      converted: true,
      queries_count: await activeQueryCount(o.accountId),
      trial_day_reached: Math.min(TRIAL_DAYS, daysBetween(acct.trialStartAt, now) + 1),
    });
  await trackServer("Subscription Started", ctx, {
    plan_tier: tier,
    billing_interval: o.interval,
    motion: acct.motion,
    mrr: mrrCents(tier, o.interval) / 100,
  });
  return { ok: true, invoiceNumber: inv.number };
}

/** The unused part of what this period actually cost (a discounted renewal credits less than list price). */
async function periodCredit(acct: Account, now: Date): Promise<number> {
  if (!acct.currentPeriodStart || !acct.currentPeriodEnd) return 0;
  const from = { tier: acct.planTier as PlanTier, interval: acct.billingInterval as Interval };
  const [paid] = await db
    .select({ net: invoices.amountCents })
    .from(invoices)
    .where(
      and(
        eq(invoices.accountId, acct.id),
        eq(invoices.status, "paid"),
        eq(invoices.periodStart, acct.currentPeriodStart),
      ),
    )
    .orderBy(sql`${invoices.createdAt} DESC`)
    .limit(1);
  const list = periodPriceCents(from.tier, from.interval) ?? 0;
  return unusedCreditCents({
    ...from,
    periodStart: acct.currentPeriodStart,
    periodEnd: acct.currentPeriodEnd,
    now,
    discountPct: paid && list ? Math.max(0, Math.round((1 - paid.net / list) * 100)) : 0,
  });
}

export type ChangePreview =
  | { ok: true; kind: "same" }
  | { ok: true; kind: "upgrade"; creditCents: number; chargeCents: number; newPriceCents: number }
  | { ok: true; kind: "downgrade"; effectiveOn: Date; blockers: string[] }
  | Fail;

/** What a plan change would do, without doing it. */
export async function previewChange(
  o: { accountId: string; tier: string; interval: Interval },
  now: Date = simNow(),
): Promise<ChangePreview> {
  const acct = await getAccount(o.accountId);
  if (!acct || acct.billingStatus !== "active" || !acct.currentPeriodEnd)
    return { ok: false, error: "You don't have an active plan to change." };
  if (!isPaidTier(o.tier)) return { ok: false, error: "Choose Starter, Growth or Agency." };
  const from = { tier: acct.planTier as PlanTier, interval: acct.billingInterval as Interval };
  const to = { tier: o.tier as PlanTier, interval: o.interval };
  if (from.tier === to.tier && from.interval === to.interval) return { ok: true, kind: "same" };
  if (isUpgrade(from, to)) {
    const credit = await periodCredit(acct, now);
    const price = periodPriceCents(to.tier, to.interval)!;
    return {
      ok: true,
      kind: "upgrade",
      creditCents: credit,
      newPriceCents: price,
      chargeCents: Math.max(0, price - credit),
    };
  }
  return {
    ok: true,
    kind: "downgrade",
    effectiveOn: acct.currentPeriodEnd,
    blockers: await downgradeBlockers(acct.id, to.tier),
  };
}

export type ChangeResult =
  | { ok: true; applied: "now"; invoiceNumber: string; chargedCents: number; creditCents: number }
  | { ok: true; applied: "scheduled"; on: Date }
  | Fail;

/** Move between paid plans. Upgrades start immediately (prorated); downgrades wait for the renewal. */
export async function changePlan(
  o: { accountId: string; tier: string; interval: Interval },
  now: Date = simNow(),
): Promise<ChangeResult> {
  const acct = await getAccount(o.accountId);
  if (!acct) return { ok: false, error: "We couldn't find that account." };
  if (acct.billingStatus === "past_due")
    return {
      ok: false,
      error: "Your last payment failed. Update your card first, then change plan.",
    };
  if (acct.billingStatus !== "active" || !acct.currentPeriodStart || !acct.currentPeriodEnd)
    return { ok: false, error: "You don't have an active plan to change." };
  if (!isPaidTier(o.tier)) return { ok: false, error: "Choose Starter, Growth or Agency." };
  const from = { tier: acct.planTier as PlanTier, interval: acct.billingInterval as Interval };
  const to = { tier: o.tier as PlanTier, interval: o.interval };
  if (from.tier === to.tier && from.interval === to.interval) {
    if (acct.pendingTier || acct.pendingInterval) {
      await db
        .update(accounts)
        .set({ pendingTier: null, pendingInterval: null })
        .where(eq(accounts.id, acct.id));
      return { ok: true, applied: "scheduled", on: acct.currentPeriodEnd };
    }
    return { ok: false, error: "You're already on that plan." };
  }

  if (isUpgrade(from, to)) {
    const method = await defaultMethod(acct.id);
    if (!method) return { ok: false, error: "Add a card first." };
    const credit = await periodCredit(acct, now);
    const price = periodPriceCents(to.tier, to.interval)!;
    const charge = Math.max(0, price - credit);
    const res = await getProvider().charge({
      accountId: acct.id,
      amountCents: charge,
      description: `Upgrade to ${PLANS[to.tier].label}`,
      method: { id: method.id, behavior: method.behavior as "ok" | "fail_renewal" },
      kind: "upgrade",
    });
    if (!res.ok) return { ok: false, error: res.message };
    const end = addPeriod(now, to.interval);
    await db
      .update(accounts)
      .set({
        planTier: to.tier,
        billingInterval: to.interval,
        currentPeriodStart: now,
        currentPeriodEnd: end,
        pendingTier: null,
        pendingInterval: null,
      })
      .where(eq(accounts.id, acct.id));
    const inv = await recordInvoice({
      accountId: acct.id,
      kind: "upgrade",
      description: `Upgrade to ${PLANS[to.tier].label} (${to.interval}), less ${money(credit)} unused credit`,
      amountCents: charge,
      status: "paid",
      periodStart: now,
      periodEnd: end,
      paymentMethodId: method.id,
      now,
    });
    await sendReceipt(inv, acct, to.tier, end);
    await trackServer("Plan Upgraded", await eventCtx(acct.id), {
      from_plan: from.tier,
      to_plan: to.tier,
      billing_interval: to.interval,
      mrr_delta: (mrrCents(to.tier, to.interval) - mrrCents(from.tier, from.interval)) / 100,
    });
    return {
      ok: true,
      applied: "now",
      invoiceNumber: inv.number,
      chargedCents: charge,
      creditCents: credit,
    };
  }

  // A downgrade must fit the smaller plan before it can be scheduled.
  const blockers = await downgradeBlockers(acct.id, to.tier);
  if (blockers.length)
    return {
      ok: false,
      error: `Before moving to ${PLANS[to.tier].label}, you'll need to bring your account within its limits.`,
      blockers,
    };
  await db
    .update(accounts)
    .set({ pendingTier: to.tier, pendingInterval: to.interval })
    .where(eq(accounts.id, acct.id));
  return { ok: true, applied: "scheduled", on: acct.currentPeriodEnd };
}

export async function cancelScheduledChange(accountId: string) {
  await db
    .update(accounts)
    .set({ pendingTier: null, pendingInterval: null })
    .where(eq(accounts.id, accountId));
}

/** Show the one-time save offer. Returns true only the first time it is ever shown to this account. */
export async function showSaveOffer(accountId: string, now: Date = simNow()): Promise<boolean> {
  const done = await db
    .update(accounts)
    .set({ saveOfferShownAt: now })
    .where(and(eq(accounts.id, accountId), sql`${accounts.saveOfferShownAt} IS NULL`))
    .returning({ id: accounts.id });
  return done.length > 0;
}

export async function acceptSaveOffer(accountId: string): Promise<{ ok: true } | Fail> {
  const acct = await getAccount(accountId);
  if (!acct || acct.billingStatus !== "active")
    return { ok: false, error: "There's no active plan to apply this to." };
  const lc = (acct.lifecycle ?? {}) as Record<string, unknown>;
  if (!acct.saveOfferShownAt || lc.saveOfferAccepted)
    return { ok: false, error: "That offer isn't available." };
  await db
    .update(accounts)
    .set({
      discountPct: SAVE_OFFER.pct,
      discountCyclesLeft: SAVE_OFFER.cycles,
      cancelAtPeriodEnd: false,
      lifecycle: sql`${accounts.lifecycle} || '{"saveOfferAccepted": true}'::jsonb`,
    })
    .where(eq(accounts.id, accountId));
  return { ok: true };
}

export const CANCEL_REASONS = [
  "too_expensive",
  "missing_feature",
  "not_using",
  "switched_tool",
  "temporary",
  "other",
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export async function confirmCancel(
  o: { accountId: string; reason: CancelReason },
  now: Date = simNow(),
): Promise<{ ok: true; endsOn: Date } | Fail> {
  const acct = await getAccount(o.accountId);
  if (
    !acct ||
    (acct.billingStatus !== "active" && acct.billingStatus !== "past_due") ||
    !acct.currentPeriodEnd
  )
    return { ok: false, error: "There's no active plan to cancel." };
  if (acct.cancelAtPeriodEnd) return { ok: true, endsOn: acct.currentPeriodEnd };
  await db
    .update(accounts)
    .set({
      cancelAtPeriodEnd: true,
      canceledAt: now,
      cancelReason: o.reason,
      pendingTier: null,
      pendingInterval: null,
    })
    .where(eq(accounts.id, o.accountId));
  await emailContacts(o.accountId, "billing", canceledEmail(acct.currentPeriodEnd));
  await trackServer("Subscription Canceled", await eventCtx(o.accountId), {
    reason: o.reason,
    tenure_days: daysBetween(acct.createdAt, now),
  });
  return { ok: true, endsOn: acct.currentPeriodEnd };
}

export async function resumeSubscription(accountId: string): Promise<{ ok: true } | Fail> {
  const acct = await getAccount(accountId);
  if (
    !acct ||
    !acct.cancelAtPeriodEnd ||
    acct.billingStatus === "canceled" ||
    acct.billingStatus === "locked"
  )
    return { ok: false, error: "There's no pending cancellation to undo." };
  await db
    .update(accounts)
    .set({ cancelAtPeriodEnd: false, canceledAt: null, cancelReason: null })
    .where(eq(accounts.id, accountId));
  return { ok: true };
}
