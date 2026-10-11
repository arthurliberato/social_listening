"use client";

import { useBusy } from "@/lib/use-busy";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { copyQuery, deleteQuery, setQueryStatus } from "@/app/w/[ws]/queries/actions";
import { Button } from "@/components/ui/button";
import { PaywallModal, type PaywallProps } from "@/components/listening/PaywallModal";
import { PLANS } from "@/lib/entitlements/plans";
import { HistoryPackControl, type PackInfo } from "./HistoryPackControl";

export function QueryRowActions({
  ws,
  id,
  name,
  status,
  canEdit,
  copyTargets = [],
  pack,
}: {
  ws: string;
  id: string;
  name: string;
  status: string;
  canEdit: boolean;
  copyTargets?: { slug: string; name: string }[];
  pack?: PackInfo;
}) {
  const router = useRouter();
  const [pending, start] = useBusy();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState<PaywallProps | null>(null);
  const [copying, setCopying] = useState(false);
  const [target, setTarget] = useState(copyTargets[0]?.slug ?? "");
  const [copied, setCopied] = useState<{ slug: string; name: string } | null>(null);
  if (!canEdit) return <span className="text-xs text-[var(--text-muted)]">View only</span>;

  const toggle = () =>
    start(async () => {
      setError("");
      const r = await setQueryStatus(ws, id, status === "live" ? "paused" : "live");
      if (r.ok) return router.refresh();
      if (r.upgradeTo) {
        const p = PLANS[r.upgradeTo];
        setPaywall({
          trigger: "query_limit",
          title: "You've reached your query limit",
          reason: r.error,
          planLabel: p.label,
          priceLine: p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined,
          bullets: [
            `${p.activeQueries} active queries`,
            `${p.mentionsPerMonth.toLocaleString()} mentions per month`,
          ],
          onClose: () => setPaywall(null),
        });
      } else setError(r.error);
    });
  const copy = () =>
    start(async () => {
      setError("");
      const r = await copyQuery(ws, id, target);
      if (r.ok) {
        setCopied({
          slug: r.targetSlug!,
          name: copyTargets.find((t) => t.slug === target)?.name ?? "",
        });
        setCopying(false);
        return router.refresh();
      }
      if (r.upgradeTo) {
        const p = PLANS[r.upgradeTo];
        setPaywall({
          trigger: "query_limit",
          title: "You've reached your query limit",
          reason: r.error,
          planLabel: p.label,
          priceLine: p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined,
          bullets: [
            `${p.activeQueries} active queries`,
            `${p.mentionsPerMonth.toLocaleString()} mentions per month`,
          ],
          onClose: () => setPaywall(null),
        });
      } else setError(r.error);
    });
  const remove = () =>
    start(async () => {
      const r = await deleteQuery(ws, id);
      if (r.ok) router.refresh();
      else setError(r.error);
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {paywall && <PaywallModal {...paywall} />}
      <Button
        size="sm"
        variant="secondary"
        onClick={toggle}
        loading={pending}
        data-testid={`toggle-${id}`}
      >
        {status === "live" ? "Pause" : "Resume"}
      </Button>
      {pack && <HistoryPackControl ws={ws} queryId={id} name={name} pack={pack} />}
      {copyTargets.length > 0 &&
        (copying ? (
          <span
            role="group"
            aria-label={`Copy ${name}`}
            className="flex items-center gap-2 text-sm"
          >
            <label className="sr-only" htmlFor={`copy-to-${id}`}>
              Copy {name} to workspace
            </label>
            <select
              id={`copy-to-${id}`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="min-h-8 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
              data-testid={`copy-target-${id}`}
            >
              {copyTargets.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={copy} loading={pending} data-testid={`copy-confirm-${id}`}>
              Copy
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setCopying(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCopying(true)}
            aria-label={`Copy ${name} to a workspace`}
            data-testid={`copy-${id}`}
          >
            Copy to…
          </Button>
        ))}
      {copied && (
        <span
          role="status"
          className="text-xs text-[var(--text-muted)]"
          data-testid={`copied-${id}`}
        >
          Copied to {copied.name.replace(" (duplicate here)", "")}.{" "}
          <a href={`/w/${copied.slug}/queries`} className="underline">
            Open
          </a>
        </span>
      )}
      {confirming ? (
        <span
          role="group"
          aria-label={`Confirm deleting ${name}`}
          className="flex items-center gap-2 text-sm"
        >
          Delete “{name}”?
          <Button
            size="sm"
            variant="destructive"
            onClick={remove}
            loading={pending}
            data-testid={`confirm-delete-${id}`}
          >
            Delete
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirming(true)}
          data-testid={`delete-${id}`}
          aria-label={`Delete ${name}`}
        >
          Delete
        </Button>
      )}
      {error && (
        <span role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </span>
      )}
    </div>
  );
}
