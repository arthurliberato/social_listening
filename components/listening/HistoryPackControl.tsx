"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buyHistory } from "@/app/w/[ws]/queries/actions";
import { Button } from "@/components/ui/button";
import { useBusy } from "@/lib/use-busy";

export interface PackInfo {
  /** The pack's job state, or null when this query has none. */
  status: "pending" | "running" | "done" | "failed" | null;
  matched: number;
  /** The first history has finished, so more can be added. */
  ready: boolean;
  /** A paid, active plan. */
  eligible: boolean;
  canBuy: boolean;
  card: string | null;
  price: string;
  extraDays: number;
  maxMentions: number;
}

/** Add another year of history to one query: explains, then buys. Owners and admins only; paid plans only. */
export function HistoryPackControl({
  ws,
  queryId,
  name,
  pack,
}: {
  ws: string;
  queryId: string;
  name: string;
  pack: PackInfo;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [bought, setBought] = useState<string | null>(null);
  const [busy, run] = useBusy();

  if (pack.status === "pending" || pack.status === "running" || bought)
    return (
      <span
        className="text-xs text-[var(--text-muted)]"
        role="status"
        data-testid={`history-status-${queryId}`}
      >
        {bought ? `Bought (${bought}). ` : ""}Collecting older mentions…
      </span>
    );
  if (pack.status === "done")
    return (
      <span className="text-xs text-[var(--text-muted)]" data-testid={`history-status-${queryId}`}>
        +1 year of history · {pack.matched.toLocaleString()} older mentions
      </span>
    );
  if (pack.status === "failed")
    return (
      <span role="alert" className="text-xs text-[var(--danger)]">
        Older history couldn&apos;t be collected. Contact support from Help and quote this query.
      </span>
    );
  if (!pack.ready) return null;

  if (!open)
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`Add history to ${name}`}
        data-testid={`history-${queryId}`}
      >
        Add history
      </Button>
    );

  return (
    <div
      role="group"
      aria-label={`Add history to ${name}`}
      className="flex max-w-sm flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm"
      data-testid={`history-panel-${queryId}`}
    >
      <p>
        Collect another <strong>{Math.round(pack.extraDays / 365)} year</strong> of mentions for
        this query, going back past your plan&apos;s window. Up to{" "}
        {pack.maxMentions.toLocaleString()} older mentions, for a one-time{" "}
        <strong>{pack.price}</strong>. They don&apos;t use your monthly mentions.
      </p>
      {!pack.eligible ? (
        <p className="text-[var(--text-muted)]">
          History packs are available on paid plans.{" "}
          <Link
            href="/upgrade?from=history_pack"
            className="text-[var(--primary)] underline underline-offset-2"
            data-testid="history-upgrade"
          >
            See plans
          </Link>
        </p>
      ) : !pack.canBuy ? (
        <p className="text-[var(--text-muted)]" data-testid="history-ask-admin">
          Only an owner or admin can buy add-ons. Ask one of them to add this.
        </p>
      ) : !pack.card ? (
        <p className="text-[var(--text-muted)]">
          Add a card first.{" "}
          <Link
            href="/settings/billing"
            className="text-[var(--primary)] underline underline-offset-2"
          >
            Open Billing
          </Link>
        </p>
      ) : (
        <p className="text-[var(--text-muted)]">Charged to the card ending {pack.card}.</p>
      )}
      <div className="flex items-center gap-2">
        {pack.eligible && pack.canBuy && pack.card && (
          <Button
            size="sm"
            loading={busy}
            data-testid={`history-buy-${queryId}`}
            onClick={() =>
              run(async () => {
                setError("");
                const r = await buyHistory(ws, queryId);
                if (!r.ok) return setError(r.error);
                setBought(r.invoiceNumber);
                router.refresh();
              })
            }
          >
            Buy for {pack.price}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]" data-testid="history-error">
          {error}
        </p>
      )}
    </div>
  );
}
