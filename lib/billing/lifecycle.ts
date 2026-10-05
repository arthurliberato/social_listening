// The account lifecycle, driven by the clock: trial reminders, trial end, grace, lock, renewal,
// failed-payment retries and cancellation taking effect. `runBillingLifecycle(now)` is what the worker runs
// every five minutes; tests (and the simulated clock) pass any `now` they like.
import { and, eq, inArray, sql } from "drizzle-orm";
import { accounts, db, pool } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { simNow } from "@/lib/simclock";
import {
  downgradeBlockedEmail,
  lockedEmail,
  paymentFailedEmail,
  trialEndedEmail,
  trialEndingEmail,
} from "./emails";
import {
  addPeriod,
  applyDiscount,
  daysBetween,
  DUNNING_RETRY_DAYS,
  GRACE_DAYS,
  isPaidTier,
  mrrCents,
  periodPriceCents,
  TRIAL_DAYS,
  type Interval,
} from "./pricing";
import { getProvider } from "./provider";
import type { CardInput } from "./cards";
import {
  defaultMethod,
  emailContacts,
  eventCtx,
  recordInvoice,
  saveCard,
  sendReceipt,
  type Account,
} from "./service";
import { downgradeBlockers } from "./usage";

const DAY = 86_400_000;
export type LifecycleAction =
  | "trial_reminder_3d"
  | "trial_reminder_1d"
  | "trial_ended"
  | "locked_trial"
  | "renewed"
  | "renewal_failed"
  | "retry_succeeded"
  | "retry_failed"
  | "locked_payment"
  | "canceled"
  | "downgraded"
  | "downgrade_blocked";
export interface LifecycleResult {
  accountId: string;
  action: LifecycleAction;
}

/** Read-only statuses: viewing and exporting work, everything else is switched off. */
export const READ_ONLY = ["locked", "canceled"] as const;
export const isReadOnly = (status: string) => (READ_ONLY as readonly string[]).includes(status);

async function mark(accountId: string, flag: string) {
  await db
    .update(accounts)
    .set({ lifecycle: sql`${accounts.lifecycle} || ${JSON.stringify({ [flag]: true })}::jsonb` })
    .where(eq(accounts.id, accountId));
}
const flagged = (a: Account, flag: string) =>
  !!(a.lifecycle as Record<string, unknown> | null)?.[flag];

async function lock(a: Account, why: "trial" | "payment") {
  await db
    .update(accounts)
    .set({
      billingStatus: "locked",
      planTier: "trial",
      cancelAtPeriodEnd: false,
      pendingTier: null,
      pendingInterval: null,
      nextRetryAt: null,
    })
    .where(eq(accounts.id, a.id));
  await emailContacts(a.id, "billing", lockedEmail(why));
}

/** Charge one billing period. Applies a scheduled plan change first, and any save-offer discount. */
async function charge(a: Account, now: Date, kind: "renewal" | "retry"): Promise<LifecycleAction> {
  let tier = a.planTier as PlanTier;
  let interval = a.billingInterval as Interval;
  let result: LifecycleAction | null = null;

  if (kind === "renewal" && (a.pendingTier || a.pendingInterval)) {
    const target = (a.pendingTier ?? tier) as PlanTier;
    const blockers = isPaidTier(target) ? await downgradeBlockers(a.id, target) : ["Invalid plan"];
    if (blockers.length) {
      await emailContacts(a.id, "billing", downgradeBlockedEmail(PLANS[target].label, blockers));
      result = "downgrade_blocked";
    } else {
      const before = { tier, interval };
      tier = target;
      interval = (a.pendingInterval ?? interval) as Interval;
      await trackServer("Plan Downgraded", await eventCtx(a.id), {
        from_plan: before.tier,
        to_plan: tier,
        mrr_delta: (mrrCents(tier, interval) - mrrCents(before.tier, before.interval)) / 100,
      });
      result = "downgraded";
    }
    await db
      .update(accounts)
      .set({ pendingTier: null, pendingInterval: null })
      .where(eq(accounts.id, a.id));
  }

  const list = periodPriceCents(tier, interval) ?? 0;
  const pct = a.discountCyclesLeft > 0 ? a.discountPct : 0;
  const { charge: amount, discount } = applyDiscount(list, pct);
  const method = await defaultMethod(a.id);
  const start = kind === "renewal" ? (a.currentPeriodEnd ?? now) : now;
  const end = addPeriod(start, interval);
  const res = method
    ? await getProvider().charge({
        accountId: a.id,
        amountCents: amount,
        description: `${PLANS[tier].label} plan renewal`,
        method: { id: method.id, behavior: method.behavior as "ok" | "fail_renewal" },
        kind,
      })
    : ({ ok: false, code: "card_declined", message: "There's no card on file." } as const);

  const label = `${PLANS[tier].label} plan, ${interval}`;
  if (res.ok) {
    const left = Math.max(0, a.discountCyclesLeft - (pct ? 1 : 0));
    await db
      .update(accounts)
      .set({
        planTier: tier,
        billingInterval: interval,
        billingStatus: "active",
        currentPeriodStart: start,
        currentPeriodEnd: end,
        dunningAttempts: 0,
        nextRetryAt: null,
        discountCyclesLeft: left,
        discountPct: left ? a.discountPct : 0,
      })
      .where(eq(accounts.id, a.id));
    const inv = await recordInvoice({
      accountId: a.id,
      kind,
      description: label,
      amountCents: amount,
      discountCents: discount,
      status: "paid",
      periodStart: start,
      periodEnd: end,
      paymentMethodId: method?.id,
      now,
    });
    await sendReceipt(inv, a, tier, end);
    return result ?? (kind === "retry" ? "retry_succeeded" : "renewed");
  }

  // Failed: keep trying on a schedule, then suspend.
  const attempts = (kind === "renewal" ? 0 : a.dunningAttempts) + 1;
  const due = a.currentPeriodEnd ?? now;
  await recordInvoice({
    accountId: a.id,
    kind,
    description: label,
    amountCents: amount,
    discountCents: discount,
    status: "failed",
    failureReason: res.message,
    periodStart: start,
    periodEnd: end,
    paymentMethodId: method?.id,
    now,
  });
  await trackServer("Payment Failed", await eventCtx(a.id), { attempt_count: attempts });
  const retriesDone = attempts - 1;
  const retryOn =
    retriesDone < DUNNING_RETRY_DAYS.length
      ? new Date(due.getTime() + DUNNING_RETRY_DAYS[retriesDone]! * DAY)
      : null;
  await db
    .update(accounts)
    .set({
      planTier: tier,
      billingInterval: interval,
      billingStatus: "past_due",
      dunningAttempts: attempts,
      nextRetryAt: retryOn,
    })
    .where(eq(accounts.id, a.id));
  await emailContacts(
    a.id,
    "dunning",
    paymentFailedEmail({ attempt: attempts, amountCents: amount, retryOn, reason: res.message }),
  );
  if (!retryOn) {
    await lock({ ...a, planTier: tier }, "payment");
    return "locked_payment";
  }
  return kind === "renewal" ? "renewal_failed" : "retry_failed";
}

/** Retry a failed payment right now (used after the customer updates their card). */
export async function retryNow(
  accountId: string,
  now: Date = simNow(),
): Promise<LifecycleAction | null> {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!a || a.billingStatus !== "past_due") return null;
  return charge(a, now, "retry");
}

/**
 * Replace the card on file. If the account is past due, the failed payment is retried straight away,
 * so fixing the card fixes the account without waiting for the next scheduled retry.
 */
export async function updateCard(
  o: { accountId: string; card: CardInput },
  now: Date = simNow(),
): Promise<
  { ok: true; retried: LifecycleAction | null } | { ok: false; error: string; field?: string }
> {
  const saved = await saveCard(o.accountId, o.card, now);
  if (!saved.ok) return saved;
  return { ok: true, retried: await retryNow(o.accountId, now) };
}

async function step(a: Account, now: Date): Promise<LifecycleAction[]> {
  const out: LifecycleAction[] = [];
  const t = now.getTime();

  if (a.billingStatus === "trialing" && a.trialEndAt) {
    const left = a.trialEndAt.getTime() - t;
    if (left > 0) {
      if (left <= DAY && !flagged(a, "reminder1d")) {
        await mark(a.id, "reminder1d");
        await mark(a.id, "reminder3d");
        await emailContacts(a.id, "trial", trialEndingEmail(1, a.trialEndAt));
        out.push("trial_reminder_1d");
      } else if (left <= 3 * DAY && left > DAY && !flagged(a, "reminder3d")) {
        await mark(a.id, "reminder3d");
        await emailContacts(a.id, "trial", trialEndingEmail(Math.ceil(left / DAY), a.trialEndAt));
        out.push("trial_reminder_3d");
      }
    } else {
      const graceEnds = new Date(a.trialEndAt.getTime() + GRACE_DAYS * DAY);
      await db.update(accounts).set({ billingStatus: "grace" }).where(eq(accounts.id, a.id));
      await emailContacts(a.id, "trial", trialEndedEmail(graceEnds));
      await trackServer("Trial Ended", await eventCtx(a.id), {
        converted: false,
        queries_count: Number(
          (
            await db.execute(
              sql`SELECT count(*)::int AS n FROM queries q JOIN workspaces w ON w.id = q.workspace_id WHERE w.account_id = ${a.id}::uuid AND q.status = 'live'`,
            )
          ).rows[0]!.n,
        ),
        trial_day_reached: Math.min(
          TRIAL_DAYS,
          a.trialStartAt ? daysBetween(a.trialStartAt, a.trialEndAt) + 1 : TRIAL_DAYS,
        ),
      });
      out.push("trial_ended");
      a = { ...a, billingStatus: "grace" };
    }
  }

  if (
    a.billingStatus === "grace" &&
    a.trialEndAt &&
    t >= a.trialEndAt.getTime() + GRACE_DAYS * DAY
  ) {
    await lock(a, "trial");
    out.push("locked_trial");
    return out;
  }

  if (a.billingStatus === "active" && a.currentPeriodEnd && t >= a.currentPeriodEnd.getTime()) {
    if (a.cancelAtPeriodEnd) {
      await db
        .update(accounts)
        .set({
          billingStatus: "canceled",
          planTier: "trial",
          cancelAtPeriodEnd: false,
          pendingTier: null,
          pendingInterval: null,
        })
        .where(eq(accounts.id, a.id));
      out.push("canceled");
    } else if (a.motion !== "sales_assisted") {
      // Invoiced contracts aren't card-charged; the sales team handles the renewal conversation.
      out.push(await charge(a, now, "renewal"));
    }
  } else if (a.billingStatus === "past_due" && a.nextRetryAt && t >= a.nextRetryAt.getTime()) {
    if (a.cancelAtPeriodEnd) {
      await db
        .update(accounts)
        .set({ billingStatus: "canceled", planTier: "trial", cancelAtPeriodEnd: false })
        .where(eq(accounts.id, a.id));
      out.push("canceled");
    } else out.push(await charge(a, now, "retry"));
  }
  return out;
}

const LOCK_KEY = 7_302_301;

/**
 * One pass over every account that can change state. A Postgres advisory lock makes overlapping passes
 * (two workers, or a slow run still going) skip instead of charging twice.
 */
export async function runBillingLifecycle(
  now: Date = simNow(),
  only?: string[],
): Promise<LifecycleResult[]> {
  const conn = await pool.connect();
  try {
    const got = (await conn.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY])).rows[0]?.ok;
    if (!got) return [];
    try {
      const rows = await db
        .select()
        .from(accounts)
        .where(
          and(
            inArray(accounts.billingStatus, ["trialing", "grace", "active", "past_due"]),
            only ? inArray(accounts.id, only) : undefined,
          ),
        );
      const out: LifecycleResult[] = [];
      for (const a of rows) {
        try {
          for (const action of await step(a, now)) out.push({ accountId: a.id, action });
        } catch (e) {
          console.error("[billing] lifecycle failed for account", a.id, e);
        }
      }
      return out;
    } finally {
      await conn.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    conn.release();
  }
}
