"use client";

import { useState } from "react";
import { SentimentPill } from "@/components/listening/SentimentPill";
import { findMatches, splitHighlighted } from "@/lib/query/highlight";
import type { Preview, SampleMention } from "@/lib/query/preview";

export type PreviewState =
  | { status: "idle" }
  | { status: "loading"; previous?: Extract<Preview, { ok: true }> }
  | { status: "ready"; data: Extract<Preview, { ok: true }> }
  | { status: "invalid" }
  | { status: "error"; message: string };

const noiseLabel = (n: number) => (n < 0.1 ? "Low" : n < 0.25 ? "Medium" : "High");

function Mention({
  m,
  terms,
}: {
  m: SampleMention;
  terms: { value: string; wildcard: boolean }[];
}) {
  const body = m.title ? `${m.title}. ${m.text}` : m.text;
  const ranges = findMatches(body, terms);
  const matchedTerms = [...new Set(ranges.map((r) => r.term))];
  return (
    <li
      className={`rounded-md border border-[var(--border)] p-3 ${m.likelySpam ? "opacity-70" : ""}`}
      data-testid="preview-mention"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <span className="font-medium text-[var(--text)]">{m.author.name}</span>
        <span>@{m.author.handle}</span>
        <span>· {m.source}</span>
        <span>· {new Date(m.publishedAt).toLocaleDateString()}</span>
        {m.likelySpam && (
          <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5" data-testid="likely-spam">
            Likely spam
          </span>
        )}
      </div>
      <p className="mt-1 text-sm">
        {splitHighlighted(body, ranges).map((p, i) =>
          p.hit ? (
            <mark key={i} className="rounded bg-[var(--spike)]/40 px-0.5 text-[var(--text)]">
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <SentimentPill sentiment={m.sentiment} />
        <details className="text-xs text-[var(--text-muted)]">
          <summary className="cursor-pointer">Why did this match?</summary>
          <p className="mt-1">
            {matchedTerms.length ? (
              <>
                Contains{" "}
                {matchedTerms.map((t) => (
                  <code key={t} className="mx-0.5 rounded bg-[var(--surface-2)] px-1">
                    {t}
                  </code>
                ))}
              </>
            ) : (
              "Matched through a field, hashtag or proximity rule in your query."
            )}
          </p>
        </details>
      </div>
    </li>
  );
}

export function PreviewPanel({ state }: { state: PreviewState }) {
  const [showAll, setShowAll] = useState(false);
  const data =
    state.status === "ready" ? state.data : state.status === "loading" ? state.previous : undefined;

  return (
    <section
      aria-labelledby="preview-h"
      className="flex flex-col gap-4"
      data-testid="preview-panel"
    >
      <h2 id="preview-h" className="text-lg font-semibold">
        Live preview
      </h2>
      {state.status === "idle" && (
        <p className="text-[var(--text-muted)]">
          Add a term to see how many mentions your query would match.
        </p>
      )}
      {state.status === "invalid" && (
        <p className="text-[var(--text-muted)]">
          Fix the highlighted problems and the preview will update.
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-[var(--danger)]">
          Couldn&apos;t load the preview: {state.message}. Edit the query to retry.
        </p>
      )}
      {state.status === "loading" && (
        <p role="status" className="text-sm text-[var(--text-muted)]">
          {data ? "Updating…" : "Counting matches…"}
        </p>
      )}

      {data && (
        <div className={state.status === "loading" ? "opacity-60" : ""}>
          <dl className="grid grid-cols-3 gap-3">
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
              <dt className="text-xs text-[var(--text-muted)]">
                Mentions, last {data.windowDays} days
              </dt>
              <dd className="text-[24px] font-semibold leading-8" data-testid="preview-count">
                {data.count.toLocaleString()}
                {data.capped ? "+" : ""}
              </dd>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
              <dt className="text-xs text-[var(--text-muted)]">Of your monthly plan</dt>
              <dd className="text-[24px] font-semibold leading-8" data-testid="preview-quota">
                {Math.round(data.quotaShare * 100)}%
              </dd>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
              <dt className="text-xs text-[var(--text-muted)]">Noise</dt>
              <dd className="text-[24px] font-semibold leading-8" data-testid="preview-noise">
                {noiseLabel(data.noiseScore)}{" "}
                <span className="text-sm font-normal text-[var(--text-muted)]">
                  ({Math.round(data.noiseScore * 100)}%)
                </span>
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Noise is the share of likely spam among the latest {data.noiseSampleSize} matches. Add
            exclusions to lower it.
          </p>
          {data.count === 0 ? (
            <p className="mt-4" data-testid="preview-empty">
              No mentions match yet. Try broader terms, a trailing wildcard (run*) or remove an
              exclusion.
            </p>
          ) : (
            <>
              <h3 className="mt-4 text-sm font-medium">Most recent matches</h3>
              <ul className="mt-2 flex flex-col gap-2" data-testid="preview-sample">
                {(showAll ? data.sample : data.sample.slice(0, 5)).map((m) => (
                  <Mention key={m.id} m={m} terms={data.terms} />
                ))}
              </ul>
              {data.sample.length > 5 && (
                <button
                  type="button"
                  className="mt-2 text-sm underline"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? "Show fewer" : `Show all ${data.sample.length}`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
