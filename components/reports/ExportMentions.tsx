"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const sel =
  "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm";

/** Mentions → CSV, with the same filters the feed uses. The server logs the download and fires the event. */
export function ExportMentions({
  ws,
  queries,
  ranges,
}: {
  ws: string;
  queries: { id: string; name: string }[];
  ranges: { id: string; label: string }[];
}) {
  const [q, setQ] = useState("");
  const [range, setRange] = useState("30d");
  const [spam, setSpam] = useState(false);
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams({ range, sort: "newest" });
    if (q) p.set("q", q);
    if (spam) p.set("spam", "show");
    window.location.assign(`/api/w/${ws}/mentions/export?${p}`);
  };
  return (
    <form onSubmit={go} className="flex flex-wrap items-end gap-3" data-testid="export-form">
      <div className="flex flex-col gap-1">
        <label htmlFor="exp-q" className="text-sm font-medium">
          Query
        </label>
        <select
          id="exp-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={sel}
          data-testid="export-query"
        >
          <option value="">All queries</option>
          {queries.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="exp-range" className="text-sm font-medium">
          Date range
        </label>
        <select
          id="exp-range"
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className={sel}
          data-testid="export-range"
        >
          {ranges.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={spam}
          onChange={(e) => setSpam(e.target.checked)}
          className="h-4 w-4"
          data-testid="export-spam"
        />
        Include likely spam
      </label>
      <Button type="submit" data-testid="export-download">
        Download CSV
      </Button>
    </form>
  );
}
