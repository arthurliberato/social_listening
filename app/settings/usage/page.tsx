import Link from "next/link";
import { MeterBar } from "@/components/billing/MeterBar";
import { requireUser } from "@/lib/auth/session";
import { accountOf, billingScope } from "@/lib/billing/context";
import { accountUsage } from "@/lib/billing/usage";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";

export const metadata = { title: "Usage · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const user = await requireUser();
  const scope = await billingScope(user.id);
  if (!scope) return <p>Join a workspace to see usage.</p>;
  const a = await accountOf(scope.accountId);
  const tier = a.planTier as PlanTier;
  const meters = await accountUsage(a.id, tier);
  const plan = PLANS[tier];
  const near = meters.some((m) => m.pct >= 80);
  return (
    <div className="max-w-3xl">
      <h1 className="text-[30px] font-semibold leading-[38px]">Usage</h1>
      <p className="mt-1 text-[var(--text-muted)]" data-testid="usage-plan">
        What you&apos;re using on the {tier === "trial" ? "trial" : plan.label} plan, across all
        your workspaces. History is kept for{" "}
        {plan.historyDays >= 365
          ? `${Math.round(plan.historyDays / 365)} year${plan.historyDays >= 730 ? "s" : ""}`
          : `${plan.historyDays} days`}
        , and data refreshes{" "}
        {plan.refresh === "realtime"
          ? "every 5 minutes"
          : plan.refresh === "hourly"
            ? "hourly"
            : "twice a day"}
        .
      </p>
      <ul className="mt-6 flex flex-col gap-3" data-testid="meters">
        {meters.map((m) => (
          <MeterBar
            key={m.key}
            m={m}
            upgradeHref={
              scope.canManage
                ? `/upgrade?from=${m.key === "mentions" ? "mention_quota" : m.key === "queries" ? "query_limit" : m.key === "alerts" ? "alert_limit" : m.key === "seats" ? "seat_limit" : "usage"}`
                : undefined
            }
          />
        ))}
      </ul>
      {near && !scope.canManage && (
        <p className="mt-4 text-sm text-[var(--text-muted)]">
          You&apos;re close to a limit. A workspace owner can change the plan.
        </p>
      )}
      {scope.canManage && (
        <p className="mt-6 text-sm">
          <Link href="/settings/billing" className="underline">
            Billing and invoices
          </Link>
        </p>
      )}
    </div>
  );
}
