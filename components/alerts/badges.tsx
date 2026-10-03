import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";

const SEV = {
  critical: { label: "Critical", Icon: OctagonAlert, cls: "text-[var(--danger)]" },
  warning: { label: "Warning", Icon: AlertTriangle, cls: "text-[var(--warning)]" },
  info: { label: "Info", Icon: Info, cls: "text-[var(--text-muted)]" },
} as const;

/** Severity is always icon + text, never colour alone. */
export function SeverityBadge({ severity }: { severity: string }) {
  const s = SEV[severity as keyof typeof SEV] ?? SEV.info;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-medium ${s.cls}`}
      data-testid="severity"
    >
      <s.Icon size={12} aria-hidden /> {s.label}
    </span>
  );
}

const STATUS: Record<string, string> = { new: "New", opened: "Seen", acknowledged: "Acknowledged" };
export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-muted)]"
      data-testid="event-status"
    >
      {status === "acknowledged" && <CheckCircle2 size={12} aria-hidden />}
      {STATUS[status] ?? status}
    </span>
  );
}
