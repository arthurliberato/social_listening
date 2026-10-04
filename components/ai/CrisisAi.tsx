"use client";

import { useState, useTransition } from "react";
import { peakAction, summaryAction } from "@/app/w/[ws]/ask/actions";
import { PaywallModal, type PaywallProps } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";
import { AnswerView, type ShownAnswer } from "./AnswerView";
import { aiPaywall, type Upgrade } from "./paywall";

type Kind = "summary" | "peak";

/** "Summarize" and "Explain the peak" for a crisis room. Both cite mentions and use the AI allowance. */
export function CrisisAi({
  ws,
  crisisId,
  peakHour,
  disabledReason,
}: {
  ws: string;
  crisisId: string;
  peakHour: number;
  disabledReason?: string;
}) {
  const [shown, setShown] = useState<{ kind: Kind; a: ShownAnswer } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [paywall, setPaywall] = useState<PaywallProps | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<Kind | null>(null);

  function go(kind: Kind) {
    setError(null);
    setBusy(kind);
    start(async () => {
      const t0 = performance.now();
      const r =
        kind === "summary"
          ? await summaryAction(ws, crisisId)
          : await peakAction(ws, crisisId, peakHour);
      setBusy(null);
      if (r.ok) {
        setShown({ kind, a: r });
        setLeft(r.remaining);
        track("AI Summary Generated", {
          surface: kind === "summary" ? "crisis_room" : "peak_explanation",
          latency_ms: Math.round(performance.now() - t0),
          ai_quota_remaining: r.remaining,
        });
        return;
      }
      setError(r.error);
      if (r.failure === "quota_exhausted")
        setPaywall(
          aiPaywall(r.error, (r as { upgrade?: Upgrade }).upgrade, () => setPaywall(null)),
        );
    });
  }

  return (
    <section
      aria-labelledby="ai-h"
      className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid="crisis-ai"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="ai-h" className="mr-auto text-lg font-semibold">
          AI briefing
        </h2>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => go("summary")}
          disabled={!!disabledReason || pending}
          loading={busy === "summary"}
          data-testid="ai-summarize"
        >
          Summarize this room
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => go("peak")}
          disabled={!!disabledReason || pending}
          loading={busy === "peak"}
          data-testid="ai-peak"
        >
          Explain the peak
        </Button>
      </div>
      {disabledReason && <p className="mt-2 text-sm text-[var(--text-muted)]">{disabledReason}</p>}
      <div aria-live="polite" className="mt-3">
        {pending && <p className="text-sm text-[var(--text-muted)]">Reading the mentions…</p>}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-[var(--warning)] p-3 text-sm"
            data-testid="ai-error"
          >
            {error}
          </p>
        )}
        {shown && !pending && (
          <div data-testid="ai-result" data-kind={shown.kind}>
            <AnswerView a={shown.a} ws={ws} />
            {left !== null && (
              <p className="mt-2 text-xs text-[var(--text-muted)]" data-testid="ai-left">
                {left} AI questions left this month.
              </p>
            )}
          </div>
        )}
        {!shown && !error && !pending && (
          <p className="text-sm text-[var(--text-muted)]">
            Get a cited summary of this room, or an explanation of its busiest hour. Each uses one
            AI question.
          </p>
        )}
      </div>
      {paywall && <PaywallModal {...paywall} />}
    </section>
  );
}
