"use client";

import { Eye, Flag, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { compact } from "@/lib/format";
import type { FeedRow } from "@/lib/mentions/feed";
import { findMatches, splitHighlighted } from "@/lib/query/highlight";

export type Terms = { value: string; wildcard: boolean }[];

export function Highlighted({ text, terms }: { text: string; terms: Terms }) {
  const parts = splitHighlighted(text, findMatches(text, terms));
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded bg-[var(--spike)]/40 px-0.5 text-[var(--text)]">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** A neutral glyph + the platform's name — never real platform logos. */
export function SourceGlyph({ type, name }: { type: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[10px] font-semibold uppercase"
      >
        {type.slice(0, 1)}
      </span>
      <span>{name.replace(" (simulated)", "")}</span>
    </span>
  );
}

export function Metric({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Heart;
  value: number;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 tabular-nums"
      title={`${value.toLocaleString()} ${label}`}
    >
      <Icon size={14} aria-hidden />
      <span aria-hidden>{compact(value)}</span>
      <span className="sr-only">
        {value.toLocaleString()} {label}
      </span>
    </span>
  );
}

export function EngagementRow({ row }: { row: FeedRow }) {
  return (
    <div
      className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]"
      data-testid="engagement"
    >
      <Metric icon={Heart} value={row.likes} label="likes" />
      <Metric icon={Repeat2} value={row.shares} label="shares" />
      <Metric icon={MessageCircle} value={row.comments} label="comments" />
      <Metric icon={Eye} value={row.views} label="views" />
      <span className="tabular-nums" title={`${row.reach.toLocaleString()} estimated reach`}>
        Est. reach {compact(row.reach)}
      </span>
    </div>
  );
}

export function FlagMark({ flagged }: { flagged: boolean }) {
  if (!flagged) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-[var(--warning)]"
      data-testid="flag-mark"
    >
      <Flag size={12} aria-hidden /> Flagged
    </span>
  );
}

export const bodyOf = (r: FeedRow) => (r.title ? `${r.title}. ${r.text}` : r.text);
