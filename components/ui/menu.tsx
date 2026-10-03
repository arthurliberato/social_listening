"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  testId?: string;
}

/** Button + popup menu: arrow keys move, Enter/Space select, Esc or outside click closes. */
export function Menu({
  label,
  items,
  testId,
  buttonClassName = "",
  disabled,
  align = "left",
}: {
  label: ReactNode;
  items: MenuItem[];
  testId?: string;
  buttonClassName?: string;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    const els = [
      ...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []),
    ];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={root} className="relative inline-block" onKeyDown={onKey}>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-testid={testId}
        onClick={() => setOpen(!open)}
        className={`inline-flex min-h-8 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm hover:bg-[var(--surface-2)] disabled:opacity-100 disabled:text-[var(--text-muted)] ${buttonClassName}`}
      >
        {label}
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <ul
          id={id}
          role="menu"
          className={`absolute z-30 mt-1 min-w-44 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
        >
          {items.map((it) => (
            <li key={it.key} role="none">
              <button
                role="menuitem"
                type="button"
                disabled={it.disabled}
                data-testid={it.testId}
                onClick={() => {
                  setOpen(false);
                  button.current?.focus();
                  it.onSelect();
                }}
                className="flex min-h-8 w-full items-center rounded px-3 text-left text-sm hover:bg-[var(--surface-2)] focus:bg-[var(--surface-2)] disabled:text-[var(--text-muted)]"
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
