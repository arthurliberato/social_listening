import Link from "next/link";
import type { Meter } from "@/lib/billing/usage";

/** A usage meter: the number, the limit, and a bar that is never colour alone (the text says it too). */
export function MeterBar({ m, upgradeHref }: { m: Meter; upgradeHref?: string }) {
  const tone = m.pct >= 100 ? "var(--danger)" : m.pct >= 80 ? "var(--warning)" : "var(--primary)";
  const state = m.pct >= 100 ? "At the limit" : m.pct >= 80 ? "Almost full" : null;
  return (
    <li
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid={`meter-${m.key}`}
      data-pct={m.pct}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{m.label}</h2>
        <p className="tabular-nums" data-testid="meter-text">
          <strong>{m.used.toLocaleString()}</strong> of {m.limit.toLocaleString()}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label={m.label}
        aria-valuemin={0}
        aria-valuemax={m.limit}
        aria-valuenow={Math.min(m.used, m.limit)}
        aria-valuetext={`${m.used.toLocaleString()} of ${m.limit.toLocaleString()} (${m.pct}%)`}
        className="mt-2 h-2 rounded-full bg-[var(--surface-2)]"
      >
        <div className="h-full rounded-full" style={{ width: `${m.pct}%`, background: tone }} />
      </div>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        {state && (
          <strong
            className="mr-1"
            style={{ color: m.pct >= 100 ? "var(--danger)" : "var(--text)" }}
          >
            {state}.
          </strong>
        )}
        {m.note}
        {state && upgradeHref && (
          <>
            {" "}
            <Link href={upgradeHref} className="underline" data-testid="meter-upgrade">
              See plans
            </Link>
          </>
        )}
      </p>
    </li>
  );
}
