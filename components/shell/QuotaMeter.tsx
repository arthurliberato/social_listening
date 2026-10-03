import Link from "next/link";

/** Monthly mention usage in the top bar. Warns at 80%, hard-stops (collection pauses) at 100%. */
export function QuotaMeter({ used, limit, pct }: { used: number; limit: number; pct: number }) {
  const tone = pct >= 100 ? "var(--danger)" : pct >= 80 ? "var(--warning)" : "var(--primary)";
  return (
    <div className="hidden items-center gap-2 text-xs md:flex" data-testid="quota-meter">
      <span className="text-[var(--text-muted)]">Mentions</span>
      <div
        role="progressbar"
        aria-label="Monthly mentions used"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${used.toLocaleString()} of ${limit.toLocaleString()} (${pct}%)`}
        className="h-1.5 w-24 rounded-full bg-[var(--surface-2)]"
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
      </div>
      <span className="tabular-nums" data-testid="quota-text">
        {used.toLocaleString()} / {limit.toLocaleString()}
      </span>
      {pct >= 80 && (
        <Link href="/upgrade?from=mention_quota" className="underline" data-testid="quota-upgrade">
          Upgrade
        </Link>
      )}
    </div>
  );
}
