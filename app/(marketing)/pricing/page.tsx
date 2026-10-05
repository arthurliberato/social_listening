import Link from "next/link";
import { PlanChooser } from "@/components/billing/PlanChooser";
import { pricingData } from "@/lib/billing/page-data";

export const metadata = { title: "Pricing · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function Pricing({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; plan?: string }>;
}) {
  const d = await pricingData(await searchParams);
  return (
    <main id="main" className="mx-auto max-w-6xl p-6">
      <header className="flex items-center gap-4">
        <Link href="/" className="font-semibold">
          Ripplewise
        </Link>
        <Link href={d.authed ? "/" : "/login"} className="ml-auto text-sm underline">
          {d.authed ? "Open the app" : "Log in"}
        </Link>
      </header>
      <h1 className="mt-8 text-[30px] font-semibold leading-[38px]">Pricing</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        Know what people are saying, without the enterprise price tag.
      </p>
      <PlanChooser {...d} />
    </main>
  );
}
