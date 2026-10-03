"use client";

import { useId, useState } from "react";

/** Free-text chips: Enter or comma adds, Backspace on empty removes the last. */
export function ChipInput({
  label,
  hint,
  chips,
  onChange,
  placeholder,
  testId,
  disabled,
}: {
  label: string;
  hint?: string;
  chips: string[];
  onChange: (c: string[]) => void;
  placeholder?: string;
  testId: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const v = raw.trim();
    if (v && !chips.some((c) => c.toLowerCase() === v.toLowerCase())) onChange([...chips, v]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] p-2">
        <ul className="contents" aria-label={`${label}: added`}>
          {chips.map((c) => (
            <li
              key={c}
              className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] py-0.5 pl-3 pr-1 text-sm"
              data-testid={`${testId}-chip`}
            >
              {c}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${c}`}
                onClick={() => onChange(chips.filter((x) => x !== c))}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-[var(--border)]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <input
          id={id}
          value={draft}
          disabled={disabled}
          placeholder={chips.length ? "" : placeholder}
          data-testid={testId}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => add(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && chips.length)
              onChange(chips.slice(0, -1));
          }}
          className="min-h-8 min-w-32 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      {hint && <p className="text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}
