"use client";

import { Flag, Image as ImageIcon, Link2, MessageSquareText, Tag } from "lucide-react";
import { forwardRef } from "react";
import { SentimentPill } from "@/components/listening/SentimentPill";
import { Menu } from "@/components/ui/menu";
import { absoluteTime, compact, relativeTime } from "@/lib/format";
import type { FeedRow } from "@/lib/mentions/feed";
import { SENTIMENTS } from "@/lib/mentions/filters";
import { bodyOf, EngagementRow, FlagMark, Highlighted, SourceGlyph, type Terms } from "./parts";

export interface RowHandlers {
  onSelect: (id: number, shift: boolean) => void;
  onOpen: (id: number) => void;
  onSentiment: (id: number, s: string | null) => void;
  onFlag: (id: number) => void;
  onTag: (id: number) => void;
  onCopyLink: (id: number) => void;
}

export interface RowProps extends RowHandlers {
  row: FeedRow;
  terms: Terms;
  selected: boolean;
  active: boolean;
  canEdit: boolean;
  now: number;
}

export const sentimentItems = (
  onPick: (s: string | null) => void,
  current: string,
  overridden: boolean,
) => [
  ...SENTIMENTS.map((s) => ({
    key: s,
    label: `${s[0]!.toUpperCase()}${s.slice(1)}${s === current ? " ✓" : ""}`,
    onSelect: () => onPick(s),
    testId: `set-${s}`,
  })),
  {
    key: "reset",
    label: "Reset to classifier",
    onSelect: () => onPick(null),
    disabled: !overridden,
    testId: "set-reset",
  },
];

const act =
  "inline-flex min-h-8 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm hover:bg-[var(--surface-2)]";

export const MentionCard = forwardRef<HTMLLIElement, RowProps>(function MentionCard(p, ref) {
  const { row: r } = p;
  return (
    <li
      ref={ref}
      tabIndex={-1}
      id={`mention-${r.id}`}
      data-testid="mention-card"
      data-id={r.id}
      data-active={p.active || undefined}
      data-selected={p.selected || undefined}
      data-unread={r.unread || undefined}
      aria-current={p.active ? "true" : undefined}
      className={`scroll-mt-44 rounded-lg border bg-[var(--surface)] p-4 outline-none ${r.unread ? "border-l-[3px] border-l-[var(--primary)]" : ""} ${p.active ? "border-[var(--focus-ring)] ring-2 ring-[var(--focus-ring)]" : "border-[var(--border)]"} ${p.selected ? "bg-[var(--surface-2)]" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <input
          type="checkbox"
          checked={p.selected}
          aria-label={`Select mention by ${r.author.name}`}
          data-testid="select-mention"
          onChange={() => {}}
          onClick={(e) => p.onSelect(r.id, (e as unknown as MouseEvent).shiftKey)}
          className="h-4 w-4"
        />
        <SourceGlyph type={r.sourceType} name={r.sourceName} />
        <span className="font-medium">{r.author.name}</span>
        <span className="text-[var(--text-muted)]">
          @{r.author.handle}
          {r.author.verified ? " ✓" : ""} · {compact(r.author.followers)} followers
        </span>
        <time
          dateTime={r.publishedAt}
          title={absoluteTime(r.publishedAt)}
          className="text-[var(--text-muted)]"
        >
          {relativeTime(r.publishedAt, p.now)}
        </time>
        <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs uppercase">
          {r.lang}
        </span>
        <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs">{r.country}</span>
        {r.likelySpam && (
          <span
            className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs"
            data-testid="likely-spam"
          >
            Likely spam
          </span>
        )}
        <FlagMark flagged={r.flagged} />
      </div>

      <p className="mt-2 text-sm leading-6" data-testid="mention-text">
        <Highlighted text={bodyOf(r)} terms={p.terms} />
      </p>

      {r.hasMedia && (
        <div
          role="img"
          aria-label={r.mediaAlt ?? "Attached image"}
          className="mt-2 flex h-20 w-40 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] text-xs text-[var(--text-muted)]"
        >
          <ImageIcon size={16} aria-hidden /> Image
        </div>
      )}

      <div className="mt-3">
        <EngagementRow row={r} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SentimentPill sentiment={r.sentiment} />
        {r.overridden && (
          <span className="text-xs text-[var(--text-muted)]" data-testid="edited-mark">
            edited (classifier: {r.predicted})
          </span>
        )}
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
          {r.emotion}
        </span>
        {r.topics.map((t) => (
          <span key={t} className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs">
            {t}
          </span>
        ))}
        {r.tags.map((t) => (
          <span
            key={t}
            className="rounded-full border border-[var(--primary)] px-2 py-0.5 text-xs"
            data-testid="tag-chip"
          >
            #{t}
          </span>
        ))}
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Mention actions"
      >
        <button
          type="button"
          className={act}
          onClick={() => p.onOpen(r.id)}
          data-testid="open-mention"
        >
          <MessageSquareText size={14} aria-hidden /> Details
        </button>
        {p.canEdit && (
          <>
            <button
              type="button"
              className={act}
              onClick={() => p.onTag(r.id)}
              data-testid="tag-mention"
            >
              <Tag size={14} aria-hidden /> Tag
            </button>
            <Menu
              label="Sentiment"
              testId="sentiment-menu"
              items={sentimentItems((s) => p.onSentiment(r.id, s), r.sentiment, r.overridden)}
            />
            <button
              type="button"
              className={act}
              onClick={() => p.onFlag(r.id)}
              aria-pressed={r.flagged}
              data-testid="flag-mention"
            >
              <Flag size={14} aria-hidden /> {r.flagged ? "Unflag" : "Flag"}
            </button>
          </>
        )}
        <button
          type="button"
          className={act}
          onClick={() => p.onCopyLink(r.id)}
          data-testid="copy-link"
        >
          <Link2 size={14} aria-hidden /> Copy link
        </button>
        <a
          className={act}
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="open-original"
        >
          Open original<span className="sr-only"> (simulated URL, opens in a new tab)</span>
        </a>
      </div>
    </li>
  );
});
