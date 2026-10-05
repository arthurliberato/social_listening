"use client";

import { useBusy } from "@/lib/use-busy";
import { useState } from "react";
import { writeQueryAction } from "@/app/w/[ws]/ask/actions";
import { PaywallModal, type PaywallProps } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";
import { MAX_QUESTION } from "@/lib/ai/limits";
import { aiPaywall, type Upgrade } from "./paywall";

/** "Describe it in words": the AI drafts Boolean text, which lands in the Advanced editor to review. */
export function QueryWriter({
  ws,
  queryId,
  onWritten,
}: {
  ws: string;
  queryId?: string;
  onWritten: (booleanText: string) => void;
}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<PaywallProps | null>(null);
  const [pending, start] = useBusy();

  function go() {
    setError(null);
    setNote(null);
    start(async () => {
      const t0 = performance.now();
      const r = await writeQueryAction(ws, text);
      if (r.ok) {
        onWritten(r.booleanText);
        setNote(
          `${r.explanation} Review it in the Advanced editor before saving. ${r.remaining} AI questions left this month.`,
        );
        track("AI Query Generated", {
          query_id: queryId ?? null,
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
      aria-labelledby="qw-h"
      className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
      data-testid="query-writer"
    >
      <h2 id="qw-h" className="text-sm font-semibold">
        Describe it in words
      </h2>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="flex min-w-60 flex-1 flex-col gap-1">
          <label htmlFor="qw-in" className="text-xs text-[var(--text-muted)]">
            e.g. “battery life and charging, but not refunds”. Uses one AI question.
          </label>
          <input
            id="qw-in"
            value={text}
            maxLength={MAX_QUESTION}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim() && !pending) {
                e.preventDefault();
                go();
              }
            }}
            data-testid="qw-input"
            className="min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
          />
        </div>
        <Button
          size="md"
          variant="secondary"
          onClick={go}
          loading={pending}
          disabled={!text.trim()}
          data-testid="qw-submit"
        >
          {pending ? "Writing…" : "Write query"}
        </Button>
      </div>
      <div aria-live="polite">
        {error && (
          <p role="alert" className="mt-2 text-sm text-[var(--danger)]" data-testid="ai-error">
            {error}
          </p>
        )}
        {note && (
          <p className="mt-2 text-sm text-[var(--text-muted)]" data-testid="qw-note">
            {note}
          </p>
        )}
      </div>
      {paywall && <PaywallModal {...paywall} />}
    </section>
  );
}
