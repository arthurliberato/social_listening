"use client";

import { useState } from "react";
import { deleteCategory } from "@/app/w/[ws]/tags/actions";
import { Button } from "@/components/ui/button";
import { useBusy } from "@/lib/use-busy";

/** Two steps, and "Keep it" backs out. The row hides at once; the list refreshes behind it. */
export function CategoryDelete({
  ws,
  id,
  name,
  onDeleted,
}: {
  ws: string;
  id: string;
  name: string;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  if (!confirming)
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setConfirming(true)}
        aria-label={`Delete ${name}`}
        data-testid="category-delete"
      >
        Delete
      </Button>
    );
  return (
    <span className="flex items-center gap-2" role="group" aria-label={`Delete ${name}?`}>
      <Button
        size="sm"
        variant="destructive"
        loading={busy}
        data-testid="category-delete-confirm"
        onClick={() =>
          run(async () => {
            const r = await deleteCategory(ws, id);
            if (!r.ok) return setError(r.error);
            onDeleted();
          })
        }
      >
        Delete category
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep it
      </Button>
      {error && (
        <span role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </span>
      )}
    </span>
  );
}
