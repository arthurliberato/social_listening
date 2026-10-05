import { RANGES } from "@/lib/mentions/filters";

const LABEL: Record<string, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "12m": "Last 12 months",
};

/** A plain GET form, so it works before hydration and every view is a shareable URL. */
export function RangeForm({
  range,
  q,
  queries,
  extra,
}: {
  range: string;
  q?: string;
  queries: { id: string; name: string }[];
  extra?: React.ReactNode;
}) {
  const sel =
    "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm";
  return (
    <form method="get" className="flex flex-wrap items-end gap-3" data-testid="insight-filters">
      <div className="flex flex-col gap-1">
        <label htmlFor="f-range" className="text-xs text-[var(--text-muted)]">
          Period
        </label>
        <select id="f-range" name="range" defaultValue={range} className={sel}>
          {RANGES.map((r) => (
            <option key={r} value={r}>
              {LABEL[r]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="f-q" className="text-xs text-[var(--text-muted)]">
          Query
        </label>
        <select id="f-q" name="q" defaultValue={q ?? ""} className={sel}>
          <option value="">All queries</option>
          {queries.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      {extra}
      <button
        type="submit"
        className="min-h-9 rounded-md border border-[var(--border)] px-4 text-sm hover:bg-[var(--surface-2)]"
        data-testid="insight-apply"
      >
        Apply
      </button>
    </form>
  );
}
