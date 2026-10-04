import Link from "next/link";
import { dismissSalesCard } from "@/app/w/[ws]/home/sales-actions";
import { ExperimentExposure } from "@/components/ExperimentExposure";
import { variantFor, variantLabel } from "@/lib/flags";

/** Shown to owners and admins of busy accounts. Equal-weight "Not now"; shown once, then respectfully gone. */
export function SalesCard({ ws, userId }: { ws: string; userId: string }) {
  const variant = variantFor("sales_cta_copy", userId);
  return (
    <section
      aria-labelledby="sales-card-h"
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid="pqa-card"
      data-variant={variant}
    >
      <ExperimentExposure flagKey="sales_cta_copy" variant={variant} />
      <h2 id="sales-card-h" className="font-medium">
        Growing fast? Let&apos;s talk about your team.
      </h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        You&apos;re using Ripplewise more than most. Larger teams get custom limits, SSO, an audit
        log and a named contact. We can send a quote or walk you through it.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link
          href="/contact-sales?entry=pqa_card"
          className="inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
          data-testid="pqa-cta"
        >
          {variantLabel("sales_cta_copy", variant)}
        </Link>
        <form action={dismissSalesCard.bind(null, ws)}>
          <button
            type="submit"
            className="inline-flex min-h-9 items-center rounded-md border border-[var(--border)] px-4 text-sm hover:bg-[var(--surface-2)]"
            data-testid="pqa-dismiss"
          >
            Not now
          </button>
        </form>
      </div>
    </section>
  );
}
