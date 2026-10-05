"use client";

import Link from "next/link";
import { useState } from "react";
import { CategoryDelete } from "./CategoryDelete";

/** One row. It owns whether it is shown, so a delete never depends on the page refreshing in time. */
export function CategoryRow({
  ws,
  c,
  canEdit,
}: {
  ws: string;
  c: {
    id: string;
    name: string;
    booleanText: string;
    total: number;
    negative: number;
    error: string | null;
  };
  canEdit: boolean;
}) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const href = `/w/${ws}/mentions?${new URLSearchParams({ search: c.booleanText, range: "30d" })}`;
  const negPct = c.total ? Math.round((c.negative / c.total) * 100) : 0;
  return (
    <tr className="border-b border-[var(--border)] last:border-0" data-testid="category-row">
      <th scope="row" className="px-3 py-2 font-medium">
        {c.name}
        <code className="mt-0.5 block text-xs font-normal text-[var(--text-muted)]">
          {c.booleanText}
        </code>
      </th>
      <td className="px-3 py-2 tabular-nums" data-testid="category-total">
        {c.error ? "—" : c.total.toLocaleString()}
      </td>
      <td className="px-3 py-2 tabular-nums">{c.error ? "—" : `${negPct}%`}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={href}
            className="text-[var(--primary)] underline underline-offset-2"
            data-testid="category-open"
          >
            View mentions
          </Link>
          {canEdit && (
            <CategoryDelete ws={ws} id={c.id} name={c.name} onDeleted={() => setGone(true)} />
          )}
          {c.error && (
            <span role="alert" className="text-xs text-[var(--danger)]">
              {c.error}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
