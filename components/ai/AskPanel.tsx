"use client";

import { useBusy } from "@/lib/use-busy";
import { useRef, useState } from "react";
import { askAction } from "@/app/w/[ws]/ask/actions";
import { PaywallModal, type PaywallProps } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";
import { MAX_QUESTION } from "@/lib/ai/limits";
import { AnswerView, type ShownAnswer } from "./AnswerView";
import { aiPaywall, type Upgrade } from "./paywall";

const SUGGESTIONS = [
  "What are people complaining about this week?",
  "What are people saying lately?",
  "What do people love about us?",
];

export function AskPanel({
  ws,
  canAsk,
  blockedReason,
  quota,
  history,
}: {
  ws: string;
  canAsk: boolean;
  blockedReason?: string;
  quota: { used: number; limit: number };
  history: (ShownAnswer & { prompt: string })[];
}) {
  const [q, setQ] = useState("");
  const [used, setUsed] = useState(quota.used);
  const [current, setCurrent] = useState<(ShownAnswer & { prompt: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<PaywallProps | null>(null);
  const [pending, start] = useBusy();
  const box = useRef<HTMLTextAreaElement>(null);
  const left = Math.max(0, quota.limit - used);
  const pct = Math.min(100, Math.round((used / quota.limit) * 100));

  function submit(text: string) {
    setError(null);
    start(async () => {
      const t0 = performance.now();
      const r = await askAction(ws, text);
      if (r.ok) {
        setCurrent({ ...r, prompt: text });
        setUsed(quota.limit - r.remaining);
        track("Ask AI Question Submitted", {
          question_length: text.length,
          ai_quota_remaining: r.remaining,
          latency_ms: Math.round(performance.now() - t0),
        });
        return;
      }
      if (r.remaining !== undefined) setUsed(quota.limit - r.remaining);
      if (r.failure === "quota_exhausted") {
        setPaywall(
          aiPaywall(r.error, (r as { upgrade?: Upgrade }).upgrade, () => setPaywall(null)),
        );
        setError(r.error);
      } else setError(r.error);
    });
  }

  const tone = pct >= 100 ? "var(--danger)" : pct >= 80 ? "var(--warning)" : "var(--primary)";
  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="quota-h"
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
        data-testid="ai-quota"
        data-remaining={left}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="quota-h" className="font-medium">
            AI questions this month
          </h2>
          <p className="tabular-nums" data-testid="ai-quota-text">
            <strong>{left.toLocaleString()}</strong> of {quota.limit.toLocaleString()} left
          </p>
        </div>
        <div
          role="progressbar"
          aria-labelledby="quota-h"
          aria-valuemin={0}
          aria-valuemax={quota.limit}
          aria-valuenow={Math.min(used, quota.limit)}
          aria-valuetext={`${used} of ${quota.limit} used`}
          className="mt-2 h-2 rounded-full bg-[var(--surface-2)]"
        >
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
        </div>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Questions, summaries, peak explanations and the query writer share this allowance. If an
          answer can&apos;t be produced, it isn&apos;t counted. Resets on the 1st.
        </p>
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) submit(q);
        }}
        className="flex flex-col gap-3"
      >
        <label htmlFor="ask-q" className="text-sm font-medium">
          Ask about your mentions
        </label>
        <textarea
          id="ask-q"
          ref={box}
          rows={3}
          maxLength={MAX_QUESTION}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={!canAsk}
          aria-describedby="ask-hint"
          data-testid="ask-input"
          className="rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
        />
        <p id="ask-hint" className="text-xs text-[var(--text-muted)]">
          Answers come from the mentions your queries collected, and always cite at least three of
          them. {q.length}/{MAX_QUESTION}
        </p>
        {!canAsk && (
          <p role="status" className="text-sm text-[var(--text-muted)]" data-testid="ai-blocked">
            {blockedReason}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            loading={pending}
            disabled={!canAsk || !q.trim()}
            data-testid="ask-submit"
          >
            {pending ? "Thinking…" : "Ask"}
          </Button>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={!canAsk || pending}
              onClick={() => {
                setQ(s);
                box.current?.focus();
              }}
              className="min-h-8 rounded-full border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-2)] disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      </form>

      <div aria-live="polite" data-testid="ask-result">
        {pending && <p className="text-sm text-[var(--text-muted)]">Reading your mentions…</p>}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-[var(--warning)] p-3 text-sm"
            data-testid="ai-error"
          >
            {error}
          </p>
        )}
        {current && !pending && (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--text-muted)]">Q: {current.prompt}</h2>
            <div className="mt-2">
              <AnswerView a={current} ws={ws} />
            </div>
          </section>
        )}
      </div>

      <section aria-labelledby="hist-h">
        <h2 id="hist-h" className="text-lg font-semibold">
          Earlier questions
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]" data-testid="ai-history-empty">
            Nothing yet. Your questions and their answers will be kept here for the workspace.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2" data-testid="ai-history">
            {history.map((h) => (
              <li key={h.id} className="rounded-lg border border-[var(--border)] p-3">
                <details>
                  <summary className="min-h-6 cursor-pointer text-sm font-medium">
                    {h.prompt}
                  </summary>
                  <div className="mt-3">
                    <AnswerView a={h} ws={ws} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
      {paywall && <PaywallModal {...paywall} />}
    </div>
  );
}
