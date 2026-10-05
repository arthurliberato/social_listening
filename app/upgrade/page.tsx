import { PlanChooser } from "@/components/billing/PlanChooser";
import { pricingData } from "@/lib/billing/page-data";

export const metadata = { title: "Plans · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function Upgrade({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; plan?: string }>;
}) {
  const d = await pricingData(await searchParams);
  return (
    <main id="main" className="mx-auto max-w-6xl p-6">
      <h1 className="text-[30px] font-semibold leading-[38px]">Plans</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        Pick the plan that fits how much you listen to. You can change it later.
      </p>
      <PlanChooser {...d} />
    </main>
  );
}
