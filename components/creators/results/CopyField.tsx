"use client";

import { useRef, useState } from "react";

/** A read-only value with a Copy button; the value is also selectable, so copying works without the button. */
export function CopyField({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const id = `cf-${testId ?? label.replace(/\W+/g, "-")}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="min-h-8 w-72 max-w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-xs"
        data-testid={testId}
      />
      <button
        type="button"
        className="min-h-8 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-2)]"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
          } catch {
            ref.current?.select();
            document.execCommand?.("copy");
          }
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        }}
      >
        Copy<span className="sr-only"> {label}</span>
      </button>
      <span role="status" className="text-xs text-[var(--text-muted)]">
        {copied ? "Copied" : ""}
      </span>
    </div>
  );
}
