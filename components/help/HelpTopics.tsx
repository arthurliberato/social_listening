"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { track } from "@/lib/analytics/client";
import { HELP_TOPICS } from "@/lib/help/topics";

const text = (t: (typeof HELP_TOPICS)[number]) =>
  `${t.title} ${t.summary} ${t.steps.join(" ")}`.toLowerCase();

/** Topics as native disclosure widgets (keyboard and screen-reader friendly), with a small filter box. */
export function HelpTopics({ ws }: { ws: string }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return HELP_TOPICS.filter((t) => words.every((w) => text(t).includes(w)));
  }, [q]);
  return (
    <div>
      <div className="flex max-w-md flex-col gap-1">
        <label htmlFor="help-search" className="text-sm font-medium">
          Search the help topics
        </label>
        <input
          id="help-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="boolean, alerts, invite…"
          className="min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
          data-testid="help-search"
        />
      </div>
      <p className="mt-2 text-sm text-[var(--text-muted)]" role="status" data-testid="help-count">
        {shown.length === HELP_TOPICS.length
          ? `${shown.length} topics`
          : `${shown.length} of ${HELP_TOPICS.length} topics`}
      </p>
      {shown.length === 0 ? (
        <p
          className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm"
          data-testid="help-empty"
        >
          Nothing matches &ldquo;{q}&rdquo;. Try fewer words, or ask us below.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {shown.map((t) => (
            <li key={t.id}>
              <details
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
                data-testid="help-topic"
                data-topic={t.id}
                onToggle={(e) => {
                  if ((e.currentTarget as HTMLDetailsElement).open)
                    track("Help Opened", { topic: t.id });
                }}
              >
                <summary className="min-h-6 cursor-pointer font-medium">
                  {t.title}
                  <span className="block text-sm font-normal text-[var(--text-muted)]">
                    {t.summary}
                  </span>
                </summary>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
                  {t.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                {t.link && (
                  <p className="mt-3 text-sm">
                    <Link
                      href={t.link.href(ws)}
                      className="text-[var(--primary)] underline underline-offset-2"
                    >
                      {t.link.label}
                    </Link>
                  </p>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
