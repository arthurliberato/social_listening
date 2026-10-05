import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/billing/CheckoutForm";
import { requireUser } from "@/lib/auth/session";
import { accountOf, billingScope } from "@/lib/billing/context";
import {
  addPeriod,
  isPaidTier,
  money,
  mrrCents,
  periodPriceCents,
  type Interval,
} from "@/lib/billing/pricing";
import { defaultMethod, previewChange } from "@/lib/billing/service";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { simNow } from "@/lib/simclock";

export const metadata = { title: "Checkout · Ripplewise" };
export const dynamic = "force-dynamic";

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; interval?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const scope = await billingScope(user.id);
  if (!scope) redirect("/upgrade");
  if (!scope.canManage)
    return (
      <div data-testid="billing-forbidden">
        <h1 className="text-[30px] font-semibold leading-[38px]">Checkout</h1>
        <p className="mt-3 text-[var(--text-muted)]">
          Only a workspace owner or admin can change the plan. Ask one of them to do it.
        </p>
      </div>
    );
  if (!sp.plan || !isPaidTier(sp.plan)) redirect("/upgrade");
  const interval: Interval = sp.interval === "yearly" ? "yearly" : "monthly";
  const tier = sp.plan as PlanTier;
  const plan = PLANS[tier];
  const a = await accountOf(scope.accountId);
  const now = simNow();
  const price = periodPriceCents(tier, interval)!;
  const saved = await defaultMethod(a.id);
  const card = saved ? { brand: saved.brand, last4: saved.last4 } : null;
  const back = (
    <Link href="/upgrade" className="text-sm text-[var(--primary)] underline underline-offset-2">
      ← Back to plans
    </Link>
  );

  if (a.billingStatus === "past_due")
    return (
      <div data-testid="checkout-past-due">
        {back}
        <h1 className="text-[30px] font-semibold leading-[38px]">Checkout</h1>
        <p className="mt-3">
          Your last payment failed, so plan changes are paused.{" "}
          <Link href="/settings/billing" className="underline">
            Update your card first
          </Link>
          , then change plan.
        </p>
      </div>
    );

  let mode: "subscribe" | "upgrade" | "downgrade" = "subscribe";
  let lines: [string, string][] = [];
  let note = "";
  let payLabel = `Pay ${money(price)} and start ${plan.label}`;
  let blockers: string[] = [];

  if (a.billingStatus === "active") {
    const pv = await previewChange({ accountId: a.id, tier, interval }, now);
    if (!pv.ok) redirect("/settings/billing");
    if (pv.kind === "same") redirect("/settings/billing");
    if (pv.kind === "upgrade") {
      mode = "upgrade";
      lines = [
        [`${plan.label}, ${interval}`, money(pv.newPriceCents)],
        ["Credit for the unused part of your current plan", `-${money(pv.creditCents)}`],
        ["Due today", money(pv.chargeCents)],
      ];
      note = `Your new plan starts today and renews on ${day(addPeriod(now, interval))}. The card on file is charged.`;
      payLabel = `Pay ${money(pv.chargeCents)} and upgrade`;
    } else {
      mode = "downgrade";
      blockers = pv.blockers;
      lines = [
        [
          `${plan.label}, ${interval}`,
          `${money(price)} / ${interval === "yearly" ? "year" : "month"}`,
        ],
        ["Takes effect", day(pv.effectiveOn)],
        ["Due today", money(0)],
      ];
      note = `You keep your current plan until ${day(pv.effectiveOn)}, then switch. You can change your mind before then.`;
      payLabel = `Switch to ${plan.label} on ${day(pv.effectiveOn)}`;
    }
  } else {
    lines = [
      [`${plan.label}, ${interval}`, money(price)],
      ...(interval === "yearly"
        ? ([[`That's ${money(mrrCents(tier, interval))} a month`, `2 months free`]] as [
            string,
            string,
          ][])
        : []),
      ["Due today", money(price)],
    ];
    note = `Your plan starts today and renews on ${day(addPeriod(now, interval))}. Cancel any time from Billing.`;
  }

  return (
    <div className="max-w-3xl">
      {back}
      <h1 className="text-[30px] font-semibold leading-[38px]">
        {mode === "subscribe"
          ? `Subscribe to ${plan.label}`
          : mode === "upgrade"
            ? `Upgrade to ${plan.label}`
            : `Switch to ${plan.label}`}
      </h1>
      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section
          aria-labelledby="sum-h"
          className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
          data-testid="order-summary"
        >
          <h2 id="sum-h" className="font-semibold">
            Order summary
          </h2>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            {lines.map(([k, v], i) => (
              <div
                key={k}
                className={`flex justify-between gap-4 ${i === lines.length - 1 ? "border-t border-[var(--border)] pt-2 font-semibold" : ""}`}
              >
                <dt>{k}</dt>
                <dd
                  className="tabular-nums"
                  data-testid={i === lines.length - 1 ? "due-today" : undefined}
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-[var(--text-muted)]">{note}</p>
        </section>
        <section aria-labelledby="pay-h">
          <h2 id="pay-h" className="mb-3 font-semibold">
            {mode === "subscribe" ? "Payment" : "Confirm"}
          </h2>
          {mode === "downgrade" && blockers.length > 0 ? (
            <div
              role="alert"
              className="rounded-lg border border-[var(--danger)] p-4 text-sm"
              data-testid="blockers"
            >
              <p className="font-medium">
                Before you can move to {plan.label}, bring your account within its limits:
              </p>
              <ul className="mt-2 list-disc pl-5">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <Link href="/settings/usage" className="mt-3 inline-block underline">
                See your usage
              </Link>
            </div>
          ) : (
            <CheckoutForm
              mode={mode}
              tier={tier}
              tierLabel={plan.label}
              interval={interval}
              card={card}
              payLabel={payLabel}
            />
          )}
        </section>
      </div>
    </div>
  );
}
