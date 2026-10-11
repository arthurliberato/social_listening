"use client";

import Link from "next/link";
import { PaywallModal } from "@/components/listening/PaywallModal";
import { compareHref, COMPARE_MIN } from "@/lib/creators/compare";
import {
  clearCompare,
  dismissLimit,
  toggleCompare,
  useCompareSelection,
} from "@/lib/creators/compare-selection";

/** A checkbox on a discovery row. It says what it's for, and who, to a screen reader. */
export function CompareCheckbox({ id, name, max }: { id: number; name: string; max: number }) {
  const { ids } = useCompareSelection();
  return (
    <label className="inline-flex min-h-8 items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={ids.includes(id)}
        onChange={() => toggleCompare(id, max)}
        className="h-4 w-4"
        data-testid="compare-check"
      />
      <span className="sr-only">Compare {name}</span>
      <span aria-hidden className="text-xs text-[var(--text-muted)]">
        Compare
      </span>
    </label>
  );
}

/** The bar that appears once something is ticked: how many, the way to the comparison, and the plan's limit. */
export function CompareBar({
  ws,
  max,
  upgrade,
}: {
  ws: string;
  max: number;
  /** The next plan that compares more creators, for the paywall. */
  upgrade: { label: string; priceLine?: string; compareSize: number };
}) {
  const { ids, limitHit } = useCompareSelection();
  return (
    <>
      {ids.length > 0 && (
        <div
          role="region"
          aria-label="Comparison"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-lg"
          data-testid="compare-bar"
        >
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
            <p role="status" className="text-sm" data-testid="compare-count">
              {ids.length} creator{ids.length === 1 ? "" : "s"} selected
              {ids.length < COMPARE_MIN
                ? `. Pick ${COMPARE_MIN - ids.length} more to compare.`
                : "."}{" "}
              <span className="text-[var(--text-muted)]">Your plan compares up to {max}.</span>
            </p>
            {ids.length >= COMPARE_MIN ? (
              <Link
                href={compareHref(ws, ids)}
                className="inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
                data-testid="compare-go"
              >
                Compare {ids.length}
              </Link>
            ) : null}
            <button
              type="button"
              onClick={clearCompare}
              className="min-h-9 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-2)]"
              data-testid="compare-clear"
            >
              Clear
            </button>
          </div>
        </div>
      )}
      {limitHit && (
        <PaywallModal
          trigger="creator_compare_limit"
          title="Compare more creators"
          reason={`Your plan compares up to ${max} creators at a time.`}
          planLabel={upgrade.label}
          priceLine={upgrade.priceLine}
          bullets={[
            `Compare up to ${upgrade.compareSize} creators side by side`,
            "More saved searches",
            "Audience insights and list export",
          ]}
          onClose={dismissLimit}
        />
      )}
    </>
  );
}
