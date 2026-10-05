"use client";

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { SentimentPill } from "@/components/listening/SentimentPill";
import { compact, relativeTime } from "@/lib/format";
import type { FeedRow } from "@/lib/mentions/feed";
import type { FeedFilters } from "@/lib/mentions/filters";
import { bodyOf, FlagMark } from "./parts";

type SortKey = FeedFilters["sort"];

/** Sticky-header table. Sorting is server-side (URL), so only sortable columns get a sort control. */
export function MentionTable({
  rows,
  selected,
  activeId,
  sort,
  onSort,
  onSelect,
  onOpen,
  now,
}: {
  rows: FeedRow[];
  selected: Set<number>;
  activeId: number | null;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  onSelect: (id: number, shift: boolean) => void;
  onOpen: (id: number) => void;
  now: number;
}) {
  const sortHeader = (label: string, key: SortKey, align = "") => (
    <button
      type="button"
      onClick={() => onSort(key)}
      aria-label={`Sort by ${label}${sort === key ? " (current)" : ""}`}
      className={`inline-flex min-h-6 items-center gap-1 font-medium ${align}`}
    >
      {label}
      <span aria-hidden>{sort === key ? "▼" : ""}</span>
    </button>
  );
  const columns: ColumnDef<FeedRow>[] = [
    {
      id: "select",
      header: () => <span className="sr-only">Select</span>,
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selected.has(row.original.id)}
          aria-label={`Select mention by ${row.original.author.name}`}
          data-testid="select-mention"
          onChange={() => {}}
          onClick={(e) => onSelect(row.original.id, (e as unknown as MouseEvent).shiftKey)}
          className="h-4 w-4"
        />
      ),
    },
    {
      id: "published",
      header: () => sortHeader("Published", "newest"),
      cell: ({ row }) => (
        <time
          dateTime={row.original.publishedAt}
          className="whitespace-nowrap text-[var(--text-muted)]"
        >
          {relativeTime(row.original.publishedAt, now)}
        </time>
      ),
    },
    {
      id: "author",
      header: "Author",
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          <span className="font-medium">{row.original.author.name}</span>{" "}
          <span className="text-[var(--text-muted)]">@{row.original.author.handle}</span>
        </span>
      ),
    },
    { id: "source", header: "Source", cell: ({ row }) => row.original.sourceType },
    {
      id: "text",
      header: "Mention",
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => onOpen(row.original.id)}
          className="block max-w-lg truncate text-left underline-offset-2 hover:underline"
          data-testid="open-mention"
        >
          {bodyOf(row.original)}
        </button>
      ),
    },
    {
      id: "sentiment",
      header: () => sortHeader("Sentiment", "negative"),
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <SentimentPill sentiment={row.original.sentiment} />
          <FlagMark flagged={row.original.flagged} />
        </span>
      ),
    },
    {
      id: "reach",
      header: () => (
        <span className="block text-right">{sortHeader("Reach", "reach", "justify-end")}</span>
      ),
      cell: ({ row }) => (
        <span className="block text-right tabular-nums">{compact(row.original.reach)}</span>
      ),
    },
    {
      id: "engagement",
      header: () => (
        <span className="block text-right">
          {sortHeader("Engagement", "engagement", "justify-end")}
        </span>
      ),
      cell: ({ row }) => (
        <span className="block text-right tabular-nums">
          {compact(row.original.likes + row.original.shares + row.original.comments)}
        </span>
      ),
    },
  ];
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => String(r.id),
  });

  return (
    <div className="overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full min-w-[900px] text-left text-sm" data-testid="mentions-table">
        <caption className="sr-only">Mentions</caption>
        <thead className="sticky top-0 z-10 bg-[var(--surface)] text-[var(--text-muted)] shadow-[0_1px_0_var(--border)]">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} scope="col" className="p-3 font-medium">
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              id={`mention-${row.original.id}`}
              tabIndex={-1}
              data-testid="mention-card"
              data-id={row.original.id}
              data-active={activeId === row.original.id || undefined}
              data-selected={selected.has(row.original.id) || undefined}
              data-unread={row.original.unread || undefined}
              aria-current={activeId === row.original.id ? "true" : undefined}
              className={`scroll-mt-44 border-t border-[var(--border)] outline-none ${row.original.unread ? "border-l-[3px] border-l-[var(--primary)]" : ""} ${activeId === row.original.id ? "ring-2 ring-inset ring-[var(--focus-ring)]" : ""} ${selected.has(row.original.id) ? "bg-[var(--surface-2)]" : ""}`}
            >
              {row.getVisibleCells().map((c) => (
                <td key={c.id} className="p-3 align-middle">
                  {flexRender(c.column.columnDef.cell, c.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
