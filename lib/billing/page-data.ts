// Shared server-side data for the Upgrade page and the public Pricing page.
import { auth } from "@/auth";
import { billingScope } from "./context";
import { accountOf } from "./context";
import { isPaywallTrigger, type PaywallTrigger } from "./paywalls";
import type { Interval } from "./pricing";
import { type PlanTier } from "@/lib/entitlements/plans";

const ORDER: PlanTier[] = ["starter", "growth", "agency", "enterprise"];

export async function pricingData(searchParams: { from?: string; plan?: string }) {
  const session = await auth();
  const from: PaywallTrigger | string | null = isPaywallTrigger(searchParams.from)
    ? searchParams.from
    : (searchParams.from ?? null);
  const recommended =
    ORDER.includes(searchParams.plan as PlanTier) && searchParams.plan !== "enterprise"
      ? (searchParams.plan as PlanTier)
      : null;
  if (!session?.user?.id)
    return { authed: false, canManage: false, current: null, from, recommended };
  const scope = await billingScope(session.user.id);
  if (!scope) return { authed: true, canManage: false, current: null, from, recommended };
  const a = await accountOf(scope.accountId);
  return {
    authed: true,
    canManage: scope.canManage,
    current: {
      tier: a.planTier as PlanTier,
      interval: a.billingInterval as Interval,
      status: a.billingStatus,
    },
    from,
    recommended,
  };
}
