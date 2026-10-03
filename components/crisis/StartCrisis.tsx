"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { openCrisis } from "@/app/w/[ws]/crisis/actions";
import { Button } from "@/components/ui/button";

export function StartCrisis({
  ws,
  queries,
}: {
  ws: string;
  queries: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [q, setQ] = useState(queries[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await openCrisis(ws, q);
    setBusy(false);
    if (r.ok) return router.push(`/w/${ws}/crisis/${r.id}`);
    setError(r.error);
  };
  if (!queries.length)
    return (
      <p className="text-sm text-[var(--text-muted)]">Create a query first — a room watches one.</p>
    );
  return (
    <form onSubmit={go} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="crisis-query" className="text-sm font-medium">
          Monitor
        </label>
        <select
          id="crisis-query"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
          data-testid="crisis-query"
        >
          {queries.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" loading={busy} data-testid="open-crisis-room">
        Open a crisis room
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </form>
  );
}
