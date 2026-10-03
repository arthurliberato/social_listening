"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { acknowledgeAlert, markOpened, startCrisis } from "@/app/w/[ws]/alerts/actions";
import { PaywallModal, type PaywallProps } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";
import { PLANS } from "@/lib/entitlements/plans";

/** Records the first open of an alert (once) and renders the triage actions. */
export function EventActions({
  ws,
  eventId,
  ruleId,
  status,
  canEdit,
  crisisId,
  crisisAllowed,
  mentionsHref,
}: {
  ws: string;
  eventId: string;
  ruleId: string;
  status: string;
  canEdit: boolean;
  crisisId: string | null;
  crisisAllowed: boolean;
  mentionsHref: string;
}) {
  const router = useRouter();
  const [acked, setAcked] = useState(status === "acknowledged");
  const [busy, setBusy] = useState<"ack" | "crisis" | null>(null);
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState<PaywallProps | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    markOpened(ws, eventId).then((r) => {
      if (r.firstOpenMs !== null)
        track("Alert Opened", { alert_id: ruleId, time_to_open_ms: r.firstOpenMs });
    });
  }, [ws, eventId, ruleId]);

  const ack = async () => {
    setBusy("ack");
    setError("");
    const r = await acknowledgeAlert(ws, eventId);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setAcked(true);
    track("Alert Acknowledged", { alert_id: ruleId, time_to_ack_ms: r.ackMs });
    router.refresh();
  };

  const crisis = async () => {
    setBusy("crisis");
    setError("");
    const r = await startCrisis(ws, eventId);
    setBusy(null);
    if (r.ok) return router.push(`/w/${ws}/crisis/${r.id}`);
    if (r.paywall && r.upgradeTo) {
      const p = PLANS[r.upgradeTo];
      return setPaywall({
        trigger: "crisis_room",
        title: "Crisis Rooms are on a higher plan",
        reason: r.error,
        planLabel: p.label,
        priceLine: p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined,
        bullets: [
          "A shared room for every spike",
          "Task list and stakeholder updates",
          "Negative-sentiment surge alerts",
        ],
        onClose: () => setPaywall(null),
      });
    }
    setError(r.error);
  };

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="event-actions">
      {paywall && <PaywallModal {...paywall} />}
      <Link
        href={mentionsHref}
        className="inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
        data-testid="view-mentions"
      >
        See the mentions
      </Link>
      {canEdit && (
        <>
          {acked ? (
            <span className="text-sm text-[var(--text-muted)]" data-testid="acked">
              ✓ Acknowledged
            </span>
          ) : (
            <Button
              variant="secondary"
              onClick={ack}
              loading={busy === "ack"}
              data-testid="acknowledge"
            >
              Acknowledge
            </Button>
          )}
          {crisisId ? (
            <Link
              href={`/w/${ws}/crisis/${crisisId}`}
              className="inline-flex min-h-9 items-center rounded-md border border-[var(--border)] px-4 text-sm font-medium hover:bg-[var(--surface-2)]"
              data-testid="open-crisis"
            >
              Open the crisis room
            </Link>
          ) : (
            <Button
              variant="secondary"
              onClick={crisis}
              loading={busy === "crisis"}
              data-testid="start-crisis"
            >
              {crisisAllowed ? "Start a crisis room" : "Start a crisis room (upgrade)"}
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
