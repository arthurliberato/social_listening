"use client";

import { useState } from "react";
import { removeFromList } from "@/app/w/[ws]/creators/actions";
import { useBusy } from "@/lib/use-busy";

export function RemoveFromListButton({
  ws,
  listId,
  creatorId,
  name,
  canEdit,
}: {
  ws: string;
  listId: string;
  creatorId: number;
  name: string;
  canEdit: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  return (
    <span>
      <button
        type="button"
        disabled={!canEdit || busy}
        title={canEdit ? undefined : "Your role can't change lists"}
        onClick={() =>
          run(async () => {
            const r = await removeFromList(ws, listId, creatorId, "list");
            if (!r.ok) return setError(r.error);
          })
        }
        data-testid="remove-from-list"
        className="min-h-8 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-2)] disabled:opacity-60"
      >
        Remove<span className="sr-only"> {name}</span>
      </button>
      {error && (
        <span role="alert" className="ml-2 text-xs text-[var(--danger)]">
          {error}
        </span>
      )}
    </span>
  );
}
