"use client";

import { useBusy } from "@/lib/use-busy";
import { useState } from "react";
import { setWatched } from "@/app/w/[ws]/authors/actions";
import { track } from "@/lib/analytics/client";

export function WatchButton({
  ws,
  authorId,
  name,
  watched,
  canEdit,
}: {
  ws: string;
  authorId: number;
  name: string;
  watched: boolean;
  canEdit: boolean;
}) {
  const [on, setOn] = useState(watched);
  const [error, setError] = useState("");
  const [pending, start] = useBusy();
  return (
    <span>
      <button
        type="button"
        aria-pressed={on}
        disabled={!canEdit || pending}
        title={canEdit ? undefined : "Your role can't change the watchlist"}
        onClick={() =>
          start(async () => {
            setError("");
            const r = await setWatched(ws, authorId, !on);
            if (!r.ok) return setError(r.error);
            setOn(!on);
            if (!on) track("Author Watchlisted", {});
          })
        }
        data-testid="watch-toggle"
        className="min-h-8 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-2)] disabled:opacity-60"
      >
        {on ? "Watching" : "Watch"}
        <span className="sr-only"> {name}</span>
      </button>
      {error && (
        <span role="alert" className="ml-2 text-xs text-[var(--danger)]">
          {error}
        </span>
      )}
    </span>
  );
}
