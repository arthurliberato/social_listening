import type { BudgetSummary } from "@/lib/creators/campaign-flow";
import { usd } from "@/lib/creators/labels";

/** Committed spend against budget. The state is said in words as well as shown in the bar's colour. */
export function BudgetMeter({ b }: { b: BudgetSummary }) {
  const tone = b.over ? "var(--danger)" : b.pct >= 80 ? "var(--warning)" : "var(--primary)";
  return (
    <section
      aria-labelledby="budget-h"
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid="budget"
    >
      <h2 id="budget-h" className="font-medium">
        Budget
      </h2>
      <p className="mt-1 tabular-nums">
        <strong data-testid="budget-committed">{usd(b.committed)}</strong> committed of{" "}
        {usd(b.budget)}
        <span className="text-[var(--text-muted)]"> · {usd(b.paid)} paid</span>
      </p>
      <div
        role="progressbar"
        aria-label="Budget committed"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={b.pct}
        aria-valuetext={`${b.pct}% of budget committed`}
        className="mt-2 h-2 rounded-full bg-[var(--surface-2)]"
      >
        <div className="h-full rounded-full" style={{ width: `${b.pct}%`, background: tone }} />
      </div>
      <p className="mt-2 text-sm" data-testid="budget-state">
        {b.over ? (
          <strong style={{ color: "var(--danger)" }}>
            Over budget by {usd(Math.abs(b.remaining))}.
          </strong>
        ) : (
          <span className="text-[var(--text-muted)]">{usd(b.remaining)} left to commit.</span>
        )}
      </p>
    </section>
  );
}
