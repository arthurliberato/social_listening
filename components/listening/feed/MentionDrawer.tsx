"use client";

import { Flag, Link2, Tag, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { SentimentPill } from "@/components/listening/SentimentPill";
import { Menu } from "@/components/ui/menu";
import { absoluteTime, compact } from "@/lib/format";
import type { FeedRow } from "@/lib/mentions/feed";
import type { MentionDetail } from "@/app/w/[ws]/mentions/actions";
import { sentimentItems } from "./MentionCard";
import { bodyOf, EngagementRow, Highlighted, SourceGlyph, type Terms } from "./parts";

const btn =
  "inline-flex min-h-8 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm hover:bg-[var(--surface-2)]";

/** Right-hand detail panel (480px). Not modal: the page behind stays scrollable. */
export function MentionDrawer({
  row,
  detail,
  terms,
  canEdit,
  onClose,
  onSentiment,
  onFlag,
  onTag,
  onRemoveTag,
  onCopyLink,
}: {
  row: FeedRow;
  detail: MentionDetail | null | "loading";
  terms: Terms;
  canEdit: boolean;
  onClose: () => void;
  onSentiment: (s: string | null) => void;
  onFlag: () => void;
  onTag: () => void;
  onRemoveTag: (t: string) => void;
  onCopyLink: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [row.id]);
  const d = detail && detail !== "loading" ? detail : null;

  return (
    <aside
      aria-labelledby="drawer-h"
      data-testid="mention-drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[480px] flex-col gap-4 overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <h2
          id="drawer-h"
          ref={heading}
          tabIndex={-1}
          className="text-lg font-semibold outline-none"
        >
          Mention details
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          data-testid="close-drawer"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--surface-2)]"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      <section aria-label="Author" className="text-sm">
        <p className="font-medium">
          {row.author.name}
          {row.author.verified ? " ✓" : ""}
        </p>
        <p className="text-[var(--text-muted)]">
          @{row.author.handle} · {compact(row.author.followers)} followers · {row.author.type}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[var(--text-muted)]">
          <SourceGlyph type={row.sourceType} name={row.sourceName} /> · {row.contentType} ·{" "}
          {row.city}, {row.country} · {row.lang.toUpperCase()}
        </p>
        <time dateTime={row.publishedAt} className="text-[var(--text-muted)]">
          {absoluteTime(row.publishedAt)}
        </time>
      </section>

      <p className="whitespace-pre-wrap text-sm leading-6" data-testid="drawer-text">
        <Highlighted text={bodyOf(row)} terms={terms} />
      </p>
      {row.hasMedia && (
        <div
          role="img"
          aria-label={row.mediaAlt ?? "Attached image"}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs text-[var(--text-muted)]"
        >
          Image: {row.mediaAlt}
        </div>
      )}
      {d?.detectedLogos.length ? (
        <p className="text-xs text-[var(--text-muted)]">
          Logo detected in image: {d.detectedLogos.join(", ")}
        </p>
      ) : null}

      <EngagementRow row={row} />

      <section
        aria-label="Sentiment"
        className="rounded-md border border-[var(--border)] p-3 text-sm"
      >
        <div className="flex flex-wrap items-center gap-2">
          <SentimentPill sentiment={row.sentiment} />
          <span className="text-[var(--text-muted)]">
            Classifier: {row.predicted} ({Math.round(row.confidence * 100)}% confident) · emotion:{" "}
            {row.emotion}
          </span>
        </div>
        {row.overridden && (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Edited by your team{d?.history ? ` on ${d.history} UTC` : ""}. The original classifier
            value is kept.
          </p>
        )}
        {canEdit && (
          <div className="mt-2">
            <Menu
              label="Change sentiment"
              testId="drawer-sentiment"
              items={sentimentItems(onSentiment, row.sentiment, row.overridden)}
            />
          </div>
        )}
      </section>

      <section aria-label="Topics and tags" className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {row.topics.map((t, i) => (
            <span
              key={`${t}-${i}`}
              className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs"
            >
              {t}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" data-testid="drawer-tags">
          {row.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--primary)] py-0.5 pl-2 pr-1 text-xs"
            >
              #{t}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove tag ${t}`}
                  onClick={() => onRemoveTag(t)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-[var(--surface-2)]"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {row.tags.length === 0 && (
            <span className="text-xs text-[var(--text-muted)]">No tags yet</span>
          )}
        </div>
      </section>

      <section aria-label="Context" className="text-sm" data-testid="drawer-context">
        {detail === "loading" && (
          <p role="status" className="text-[var(--text-muted)]">
            Loading context…
          </p>
        )}
        {d && (
          <>
            {d.parent && (
              <blockquote className="rounded-md border-l-[3px] border-[var(--border)] pl-3 text-[var(--text-muted)]">
                In reply to {d.parent.author}: “{d.parent.text.slice(0, 160)}”
              </blockquote>
            )}
            {d.replies > 0 && (
              <p className="mt-2">
                {d.replies} repl{d.replies === 1 ? "y" : "ies"} in your data.
              </p>
            )}
            <p className="mt-2 text-[var(--text-muted)]">
              Matched by: {d.matchedQueries.length ? d.matchedQueries.join(", ") : "—"}
            </p>
          </>
        )}
        {detail === null && (
          <p className="text-[var(--text-muted)]">Context isn&apos;t available for this mention.</p>
        )}
      </section>

      <div className="mt-auto flex flex-wrap gap-2" role="group" aria-label="Mention actions">
        {canEdit && (
          <button type="button" className={btn} onClick={onTag} data-testid="drawer-tag">
            <Tag size={14} aria-hidden /> Tag
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            className={btn}
            onClick={onFlag}
            aria-pressed={row.flagged}
            data-testid="drawer-flag"
          >
            <Flag size={14} aria-hidden /> {row.flagged ? "Unflag" : "Flag"}
          </button>
        )}
        <button type="button" className={btn} onClick={onCopyLink}>
          <Link2 size={14} aria-hidden /> Copy link
        </button>
        <a className={btn} href={row.url} target="_blank" rel="noopener noreferrer">
          Open original<span className="sr-only"> (simulated URL, opens in a new tab)</span>
        </a>
      </div>
    </aside>
  );
}
