import Link from "next/link";
import { BrandingForm } from "@/components/team/BrandingForm";
import { WorkspacePicker } from "@/components/team/WorkspacePicker";
import { requireUser } from "@/lib/auth/session";
import { accountOf } from "@/lib/billing/context";
import { limits, PLANS, planUnlocking, type PlanTier } from "@/lib/entitlements/plans";
import { savedBranding } from "@/lib/team/branding";
import { pickWorkspace } from "@/lib/team/scope";

export const metadata = { title: "Branding · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function BrandingPage({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const { selected, active, allowed } = await pickWorkspace(user.id, sp.ws, "branding.manage");
  const h1 = <h1 className="text-[30px] font-semibold leading-[38px]">Branding</h1>;
  if (!selected || !allowed)
    return (
      <div data-testid="branding-forbidden">
        {h1}
        <p className="mt-3 text-[var(--text-muted)]">Only owners and admins can change branding.</p>
      </div>
    );
  const acct = await accountOf(selected.accountId);
  if (!limits(acct.planTier as PlanTier).features.whiteLabel) {
    const need = PLANS[planUnlocking("whiteLabel")];
    return (
      <div className="max-w-2xl" data-testid="branding-locked">
        {h1}
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-lg font-semibold">Put your name on the work you share</h2>
          <p className="mt-2 text-[var(--text-muted)]">
            White-label replaces Ripplewise with your brand on shared dashboards, PDF reports and
            your clients&apos; view. It&apos;s part of the {need.label} plan.
          </p>
          <Link
            href="/upgrade?from=white_label&plan=agency"
            className="mt-4 inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
            data-testid="branding-upgrade"
          >
            See plans
          </Link>
        </section>
      </div>
    );
  }
  return (
    <div className="max-w-5xl">
      {h1}
      <p className="mt-1 text-[var(--text-muted)]">
        What clients of <strong>{selected.name}</strong> see instead of Ripplewise.
      </p>
      <WorkspacePicker base="/settings/branding" active={active} current={selected.slug} />
      <div className="mt-6">
        <BrandingForm
          key={selected.id}
          ws={selected.slug}
          workspaceName={selected.name}
          initial={await savedBranding(selected.id)}
        />
      </div>
    </div>
  );
}
