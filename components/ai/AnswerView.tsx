"use client";

import { track } from "@/lib/analytics/client";
import { SIMULATED_NOTICE } from "@/lib/ai/provider";
import type { Citation } from "@/lib/ai/service";

export interface ShownAnswer {
  id: string;
  answer: string;
  citations: Citation[];
  scope?: string;
  provider: string;
}

/** An answer with its numbered sources. Each "[n]" is a link to the mention it rests on. */
export function AnswerView({ a, ws }: { a: ShownAnswer; ws: string }) {
  const open = (n: number) => track("Ask AI Citation Opened", { citation_index: n });
  const href = (c: Citation) => `/w/${ws}/mentions?m=${c.mentionId}`;
  const byN = new Map(a.citations.map((c) => [c.n, c]));
  return (
    <div data-testid="ai-answer" data-answer-id={a.id}>
      <p className="whitespace-pre-wrap leading-6">
        {a.answer.split(/(\[\d{1,2}\])/).map((part, i) => {
          const m = /^\[(\d{1,2})\]$/.exec(part);
          const c = m ? byN.get(Number(m[1])) : undefined;
          return c ? (
            <a
              key={i}
              href={href(c)}
              target="_blank"
              rel="noreferrer"
              onClick={() => open(c.n)}
              aria-label={`Source ${c.n}: ${c.author} on ${c.source}`}
              data-testid="ai-inline-cite"
              className="mx-0.5 inline-flex min-h-6 min-w-6 items-center justify-center rounded border border-[var(--border)] px-1 text-xs font-medium text-[var(--primary)] underline-offset-2 hover:underline"
            >
              {c.n}
            </a>
          ) : (
            <span key={i}>{part}</span>
          );
        })}
      </p>
      <h3 className="mt-4 text-sm font-semibold">Sources ({a.citations.length})</h3>
      <ol className="mt-1 flex flex-col gap-1 text-sm" data-testid="ai-citations">
        {a.citations.map((c) => (
          <li key={c.n} className="flex gap-2">
            <span className="tabular-nums text-[var(--text-muted)]">{c.n}.</span>
            <a
              href={href(c)}
              target="_blank"
              rel="noreferrer"
              onClick={() => open(c.n)}
              className="text-[var(--primary)] underline underline-offset-2"
            >
              {c.author} on {c.source}
            </a>
            <span className="text-[var(--text-muted)]">
              {new Date(c.publishedAt).toISOString().slice(0, 10)}
            </span>
          </li>
        ))}
      </ol>
      {a.scope && <p className="mt-3 text-xs text-[var(--text-muted)]">Based on {a.scope}.</p>}
      {a.provider === "simulated" && (
        <p className="mt-1 text-xs text-[var(--text-muted)]" data-testid="ai-simulated-note">
          {SIMULATED_NOTICE}
        </p>
      )}
    </div>
  );
}
