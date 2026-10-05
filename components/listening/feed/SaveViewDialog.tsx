"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function SaveViewDialog({
  open,
  onSave,
  onClose,
}: {
  open: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setName("");
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="sv-title"
      onClose={onClose}
      data-testid="save-view-dialog"
      className="m-auto w-full max-w-sm rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text)] backdrop:bg-black/40"
    >
      <h2 id="sv-title" className="text-lg font-semibold">
        Save this view
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
        className="mt-3 flex flex-col gap-3"
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={60}
            data-testid="view-name"
            className="min-h-9 rounded border border-[var(--border)] bg-[var(--surface)] px-2 font-normal"
          />
        </label>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" data-testid="view-save">
            Save view
          </Button>
        </div>
      </form>
    </dialog>
  );
}
