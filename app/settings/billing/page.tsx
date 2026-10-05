import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { db, invoices, paymentMethods } from "@/db/client";
import { ResumeButton, UpdateCard } from "@/components/billing/BillingActions";
import { requireUser } from "@/lib/auth/session";
import { accountOf, billingScope } from "@/lib/billing/context";
import {
  applyDiscount,
  money,
  mrrCents,
  periodPriceCents,
  type Interval,
} from "@/lib/billing/pricing";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { simNow } from "@/lib/simclock";

export const metadata = { title: "Billing · Ripplewise" };
export const dynamic = "force-dynamic";

const day = (d: Date) => d.toISOString().slice(0, 10);
const STATUS: Record<string, { label: string; note: string }> = {
  trialing: { label: "Free trial", note: "No card needed until you choose a plan." },
  grace: { label: "Trial ended", note: "You still have full access for a few days." },
  active: { label: "Active", note: "" },
  past_due: { label: "Payment failed", note: "We're retrying. Update your card to fix it now." },
  locked: { label: "Read-only", note: "Collection, alerts and scheduled reports are paused." },
  canceled: { label: "Cancelled", note: "Your data is kept and you can still export it." },
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; changed?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const scope = await billingScope(user.id);
  if (!scope) return <p>Join a workspace to see billing.</p>;
  if (!scope.canManage)
    return (
      <div data-testid="billing-forbidden">
        <h1 className="text-[30px] font-semibold leading-[38px]">Billing</h1>
        <p className="mt-3 text-[var(--text-muted)]">
          Billing is managed by your workspace owners and admins. If you need a plan change or an
          invoice, ask one of them.
        </p>
      </div>
    );
  const a = await accountOf(scope.accountId);
  const [methods, invs] = await Promise.all([
    db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.accountId, a.id))
      .orderBy(desc(paymentMethods.isDefault), desc(paymentMethods.createdAt)),
    db
      .select()
      .from(invoices)
      .where(eq(invoices.accountId, a.id))
      .orderBy(desc(invoices.seq))
      .limit(50),
  ]);
  const tier = a.planTier as PlanTier;
  const plan = PLANS[tier];
  const interval = a.billingInterval as Interval;
  const paid = a.billingStatus === "active" || a.billingStatus === "past_due";
  const card = methods.find((m) => m.isDefault);
  const list = periodPriceCents(tier, interval) ?? 0;
  const next = applyDiscount(list, a.discountCyclesLeft > 0 ? a.discountPct : 0);
  const now = simNow();
  const trialLeft = a.trialEndAt
    ? Math.max(0, Math.ceil((a.trialEndAt.getTime() - now.getTime()) / 86_400_000))
    : 0;
  const st = STATUS[a.billingStatus]!;

  return (
    <div className="max-w-3xl">
      <h1 className="text-[30px] font-semibold leading-[38px]">Billing</h1>
      {(sp.welcome || sp.changed) && (
        <p
          role="status"
          className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
          data-testid="billing-notice"
        >
          {sp.welcome
            ? `You're on the ${PLANS[sp.welcome as PlanTier]?.label ?? ""} plan. A receipt is on its way to your inbox.`
            : sp.changed === "scheduled"
              ? "Done. Your plan changes at your next renewal."
              : "Done. Your plan has changed and a receipt is on its way."}
        </p>
      )}

      <section
        className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
        aria-labelledby="plan-h"
        data-testid="plan-card"
        data-status={a.billingStatus}
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="plan-h" className="text-xl font-semibold" data-testid="plan-name">
            {paid
              ? `${plan.label} plan`
              : a.billingStatus === "trialing" || a.billingStatus === "grace"
                ? "Free trial"
                : "No active plan"}
          </h2>
          <span
            className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-medium"
            data-testid="plan-status"
          >
            {st.label}
          </span>
        </div>
        {st.note && <p className="mt-1 text-sm text-[var(--text-muted)]">{st.note}</p>}

        {paid && a.currentPeriodEnd && (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[var(--text-muted)]">Price</dt>
              <dd className="font-medium" data-testid="plan-price">
                {money(list)} / {interval === "yearly" ? "year" : "month"}
                {interval === "yearly" && (
                  <span className="block text-xs font-normal text-[var(--text-muted)]">
                    {money(mrrCents(tier, interval))} a month, 2 months free
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">
                {a.cancelAtPeriodEnd ? "Ends on" : "Renews on"}
              </dt>
              <dd className="font-medium" data-testid="plan-renews">
                {day(a.currentPeriodEnd)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">
                {a.cancelAtPeriodEnd ? "Next charge" : "Next charge"}
              </dt>
              <dd className="font-medium" data-testid="plan-next-charge">
                {a.cancelAtPeriodEnd ? "None" : money(next.charge)}
                {!a.cancelAtPeriodEnd && next.discount > 0 && (
                  <span className="block text-xs font-normal text-[var(--text-muted)]">
                    {a.discountPct}% off, {a.discountCyclesLeft} renewal
                    {a.discountCyclesLeft === 1 ? "" : "s"} left
                  </span>
                )}
              </dd>
            </div>
          </dl>
        )}
        {a.billingStatus === "trialing" && a.trialEndAt && (
          <p className="mt-3 text-sm" data-testid="trial-left">
            {trialLeft} day{trialLeft === 1 ? "" : "s"} left. Your trial ends on {day(a.trialEndAt)}
            .
          </p>
        )}
        {a.pendingTier && (
          <div
            className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-[var(--surface-2)] p-3 text-sm"
            data-testid="pending-change"
          >
            <span>
              Switching to{" "}
              <strong>
                {PLANS[a.pendingTier as PlanTier].label} ({a.pendingInterval ?? interval})
              </strong>{" "}
              on {a.currentPeriodEnd ? day(a.currentPeriodEnd) : "renewal"}.
            </span>
            <ResumeButton kind="keep" />
          </div>
        )}
        {a.cancelAtPeriodEnd && a.currentPeriodEnd && (
          <div
            className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-[var(--surface-2)] p-3 text-sm"
            data-testid="cancel-pending"
          >
            <span>
              Cancelled. You keep full access until {day(a.currentPeriodEnd)} and won&apos;t be
              charged again.
            </span>
            <ResumeButton kind="resume" />
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            href="/upgrade"
            className="inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
            data-testid="change-plan"
          >
            {paid ? "Change plan" : "Choose a plan"}
          </Link>
          {a.billingStatus === "active" && !a.cancelAtPeriodEnd && (
            <Link
              href="/settings/billing/cancel"
              className="text-sm underline"
              data-testid="cancel-plan"
            >
              Cancel plan
            </Link>
          )}
        </div>
      </section>

      <section
        className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
        aria-labelledby="pm-h"
      >
        <h2 id="pm-h" className="font-semibold">
          Payment method
        </h2>
        {card ? (
          <p className="mt-2 text-sm" data-testid="card-on-file">
            {card.brand} ending in <strong>{card.last4}</strong>, expires{" "}
            {String(card.expMonth).padStart(2, "0")}/{String(card.expYear).slice(-2)}
          </p>
        ) : (
          <p className="mt-2 text-sm text-[var(--text-muted)]" data-testid="no-card">
            No card on file yet. You&apos;ll add one when you choose a plan.
          </p>
        )}
        {(card || a.billingStatus === "past_due") && (
          <UpdateCard pastDue={a.billingStatus === "past_due"} />
        )}
      </section>

      <section className="mt-6" aria-labelledby="inv-h">
        <h2 id="inv-h" className="text-lg font-semibold">
          Invoices
        </h2>
        {invs.length === 0 ? (
          <p
            className="mt-2 rounded-lg border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]"
            data-testid="invoices-empty"
          >
            No invoices yet. They appear here after your first payment.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-left text-sm" data-testid="invoice-table">
              <caption className="sr-only">Invoices and payment attempts</caption>
              <thead className="text-[var(--text-muted)]">
                <tr className="border-b border-[var(--border)]">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Invoice
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Description
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {invs.map((i) => (
                  <tr
                    key={i.id}
                    className="border-b border-[var(--border)] last:border-0"
                    data-testid="invoice-row"
                    data-status={i.status}
                  >
                    <th scope="row" className="px-3 py-2 font-medium">
                      RW-{String(i.seq).padStart(6, "0")}
                    </th>
                    <td className="px-3 py-2">{day(i.createdAt)}</td>
                    <td className="px-3 py-2">
                      {i.description}
                      {i.discountCents > 0 && (
                        <span className="block text-xs text-[var(--text-muted)]">
                          includes {money(i.discountCents)} discount
                        </span>
                      )}
                      {i.failureReason && (
                        <span className="block text-xs text-[var(--danger)]">
                          {i.failureReason}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(i.amountCents)}</td>
                    <td className="px-3 py-2">{i.status === "paid" ? "Paid" : "Failed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="mt-6 text-xs text-[var(--text-muted)]">
        Add-ons to a plan are never added for you, and you can cancel from this page in a couple of
        clicks.
      </p>
    </div>
  );
}
