"use client";

import { forwardRef } from "react";
import { SentimentPill } from "@/components/listening/SentimentPill";
import { compact, relativeTime } from "@/lib/format";
import { bodyOf, FlagMark, Highlighted } from "./parts";
import type { RowProps } from "./MentionCard";

/** Compact single-line row for scanning large volumes. */
export const MentionListRow = forwardRef<HTMLLIElement, RowProps>(function MentionListRow(p, ref) {
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
      className={`scroll-mt-44 flex min-h-11 items-center gap-3 border-b border-[var(--border)] px-3 text-sm outline-none ${r.unread ? "border-l-[3px] border-l-[var(--primary)]" : ""} ${p.active ? "ring-2 ring-inset ring-[var(--focus-ring)]" : ""} ${p.selected ? "bg-[var(--surface-2)]" : "bg-[var(--surface)]"}`}
    >
      <input
        type="checkbox"
        checked={p.selected}
        aria-label={`Select mention by ${r.author.name}`}
        data-testid="select-mention"
        onChange={() => {}}
        onClick={(e) => p.onSelect(r.id, (e as unknown as MouseEvent).shiftKey)}
        className="h-4 w-4 shrink-0"
      />
      <SentimentPill sentiment={r.sentiment} />
      <span className="w-36 shrink-0 truncate font-medium">{r.author.name}</span>
      <button
        type="button"
        onClick={() => p.onOpen(r.id)}
        className="min-w-0 flex-1 truncate text-left"
        data-testid="open-mention"
      >
        <Highlighted text={bodyOf(r)} terms={p.terms} />
      </button>
      <FlagMark flagged={r.flagged} />
      {r.likelySpam && (
        <span className="rounded border border-[var(--border)] px-1.5 text-xs">Spam?</span>
      )}
      <span className="w-16 shrink-0 text-right text-xs text-[var(--text-muted)]">
        {r.sourceType}
      </span>
      <span
        className="w-14 shrink-0 text-right text-xs tabular-nums text-[var(--text-muted)]"
        title="Estimated reach"
      >
        {compact(r.reach)}
      </span>
      <time
        dateTime={r.publishedAt}
        className="w-16 shrink-0 text-right text-xs text-[var(--text-muted)]"
      >
        {relativeTime(r.publishedAt, p.now)}
      </time>
    </li>
  );
});
