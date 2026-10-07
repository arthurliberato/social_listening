"use client";

import { Download } from "lucide-react";
import { PaywallButton, type LockCopy } from "./Locked";

const cls =
  "inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium hover:bg-[var(--surface-2)]";

/** Unlocked: a plain download link. Locked: the same button opens the paywall instead (the route also refuses). */
export function ExportButton({
  href,
  unlocked,
  copy,
}: {
  href: string;
  unlocked: boolean;
  copy: LockCopy;
}) {
  if (unlocked)
    return (
      <a href={href} className={cls} data-testid="export-list" download>
        <Download size={16} aria-hidden /> Export CSV
      </a>
    );
  return (
    <PaywallButton copy={copy} className={cls} testId="export-list">
      <Download size={16} aria-hidden /> Export CSV
      <span className="text-xs text-[var(--text-muted)]">(not on your plan)</span>
    </PaywallButton>
  );
}
