import { redirect } from "next/navigation";
import { CancelFlow } from "@/components/billing/CancelFlow";
import { requireUser } from "@/lib/auth/session";
import { accountOf, billingScope } from "@/lib/billing/context";
import { daysBetween } from "@/lib/billing/pricing";
import { simNow } from "@/lib/simclock";

export const metadata = { title: "Cancel plan · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function CancelPage() {
  const user = await requireUser();
  const scope = await billingScope(user.id);
  if (!scope?.canManage) redirect("/settings/billing");
  const a = await accountOf(scope.accountId);
  if (a.billingStatus !== "active" || !a.currentPeriodEnd) redirect("/settings/billing");
  // Already cancelled: show the confirmation instead of redirecting. The cancel action re-renders this
  // page, and bouncing away at that moment would hide the confirmation from the person who just clicked.
  return (
    <div className="max-w-xl">
      <CancelFlow
        endsOn={a.currentPeriodEnd.toISOString()}
        tenureDays={daysBetween(a.createdAt, simNow())}
        alreadyCanceled={a.cancelAtPeriodEnd}
      />
    </div>
  );
}
