"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Add tags to one or many mentions. Suggests tags already used in the workspace. */
export function TagDialog({
  open,
  count,
  suggestions,
  onSubmit,
  onClose,
}: {
  open: boolean;
  count: number;
  suggestions: string[];
  onSubmit: (tags: string[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setValue("");
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open]);

  const submit = (raw: string) => {
    const tags = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length) onSubmit(tags);
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby="tag-title"
      onClose={onClose}
      data-testid="tag-dialog"
      className="m-auto w-full max-w-sm rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text)] backdrop:bg-black/40"
    >
      <h2 id="tag-title" className="text-lg font-semibold">
        Tag {count} mention{count === 1 ? "" : "s"}
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className="mt-3 flex flex-col gap-3"
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          Tag names
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            placeholder="e.g. escalate, vip"
            data-testid="tag-input"
            className="min-h-9 rounded border border-[var(--border)] bg-[var(--surface)] px-2 font-normal"
          />
        </label>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Existing tags">
            {suggestions.slice(0, 12).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="min-h-7 rounded-full border border-[var(--border)] px-3 text-xs hover:bg-[var(--surface-2)]"
              >
                #{s}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" data-testid="tag-submit">
            Add tag
          </Button>
        </div>
      </form>
    </dialog>
  );
}
