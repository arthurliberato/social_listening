"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { forwardRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { activeChips, type Chip, type FeedFilters } from "@/lib/mentions/filters";
import { DateRangePicker } from "./DateRangePicker";

const VIEW_LABEL = { card: "Cards", list: "List", table: "Table" } as const;
const SORT_LABEL = {
  newest: "Newest",
  reach: "Most reach",
  engagement: "Most engagement",
  negative: "Most negative",
} as const;

export const FilterBar = forwardRef<
  HTMLInputElement,
  {
    filters: FeedFilters;
    view: FeedFilters["view"];
    queries: { id: string; name: string }[];
    historyDays: number;
    searchError: string | null;
    savedViews: { id: string; name: string; params: string }[];
    canEdit: boolean;
    onSearch: (s: string) => void;
    onQuery: (id: string | undefined) => void;
    onRange: (r: string, from?: string, to?: string) => void;
    onRangeLocked: (r: string) => void;
    onView: (v: FeedFilters["view"]) => void;
    onSort: (s: FeedFilters["sort"]) => void;
    onOpenFilters: () => void;
    onRemoveChip: (c: Chip) => void;
    onClearAll: () => void;
    onSaveView: () => void;
    onOpenView: (params: string) => void;
    onDeleteView: (id: string) => void;
  }
>(function FilterBar(p, searchRef) {
  const [text, setText] = useState(p.filters.search ?? "");
  useEffect(() => setText(p.filters.search ?? ""), [p.filters.search]);
  const chips = activeChips(p.filters, (id) => p.queries.find((q) => q.id === id)?.name);

  return (
    <div className="flex flex-col gap-2" data-testid="filter-bar">
      <div className="flex flex-wrap items-center gap-2">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            p.onSearch(text.trim());
          }}
          className="flex min-w-64 flex-1 items-center gap-1"
        >
          <div className="relative flex-1">
            <Search
              size={16}
              aria-hidden
              className="absolute left-2.5 top-2.5 text-[var(--text-muted)]"
            />
            <input
              ref={searchRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Search mentions"
              aria-describedby={p.searchError ? "search-err" : undefined}
              aria-invalid={p.searchError ? true : undefined}
              placeholder='Search these mentions — e.g. price NOT "free trial"   ( / )'
              data-testid="feed-search"
              className={`min-h-9 w-full rounded-md border bg-[var(--surface)] pl-8 pr-2 text-sm ${p.searchError ? "border-[var(--danger)]" : "border-[var(--border)]"}`}
            />
          </div>
          <Button type="submit" variant="secondary" data-testid="feed-search-submit">
            Search
          </Button>
        </form>
        <select
          aria-label="Query"
          value={p.filters.q ?? ""}
          onChange={(e) => p.onQuery(e.target.value || undefined)}
          data-testid="query-select"
          className="min-h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
        >
          <option value="">All queries</option>
          {p.queries.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>
        <DateRangePicker
          value={p.filters}
          historyDays={p.historyDays}
          onChange={p.onRange}
          onLocked={p.onRangeLocked}
        />
        <Button variant="secondary" onClick={p.onOpenFilters} data-testid="open-filters">
          <SlidersHorizontal size={16} aria-hidden /> Filter
        </Button>
        <div
          role="group"
          aria-label="View"
          className="flex overflow-hidden rounded-md border border-[var(--border)]"
        >
          {(["card", "list", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={p.view === v}
              onClick={() => p.onView(v)}
              data-testid={`view-${v}`}
              className={`min-h-9 px-3 text-sm ${p.view === v ? "bg-[var(--primary)] text-[var(--primary-contrast)]" : "bg-[var(--surface)] hover:bg-[var(--surface-2)]"}`}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          Sort
          <select
            value={p.filters.sort}
            onChange={(e) => p.onSort(e.target.value as FeedFilters["sort"])}
            data-testid="sort-select"
            className="min-h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2"
          >
            {Object.entries(SORT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {p.searchError && (
        <p
          id="search-err"
          role="alert"
          className="text-sm text-[var(--danger)]"
          data-testid="search-error"
        >
          Search problem: {p.searchError}
        </p>
      )}

      {(chips.length > 0 || p.savedViews.length > 0) && (
        <div className="flex flex-wrap items-center gap-2" data-testid="chips">
          <ul className="contents" aria-label="Active filters">
            {chips.map((c, i) => (
              <li
                key={`${c.key}-${c.value ?? i}`}
                className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] py-0.5 pl-3 pr-1 text-sm"
                data-testid="filter-chip"
              >
                {c.label}
                <button
                  type="button"
                  aria-label={`Remove filter: ${c.label}`}
                  onClick={() => p.onRemoveChip(c)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-[var(--surface-2)]"
                >
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          {chips.length > 0 && (
            <Button size="sm" variant="ghost" onClick={p.onClearAll} data-testid="clear-all">
              Clear all
            </Button>
          )}
          {chips.length > 0 && p.canEdit && (
            <Button size="sm" variant="secondary" onClick={p.onSaveView} data-testid="save-view">
              Save view
            </Button>
          )}
          {p.savedViews.length > 0 && (
            <Menu
              label="Saved views"
              testId="saved-views"
              items={p.savedViews.map((v) => ({
                key: v.id,
                label: v.name,
                onSelect: () => p.onOpenView(v.params),
                testId: `saved-view-${v.name}`,
              }))}
            />
          )}
        </div>
      )}
      {chips.length === 0 && p.canEdit && p.savedViews.length === 0 && null}
    </div>
  );
});
