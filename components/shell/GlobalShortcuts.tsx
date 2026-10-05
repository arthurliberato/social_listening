"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics/client";
import { isTyping, setShortcutsEnabled, SHORTCUT_HELP, shortcutsEnabled } from "@/lib/shortcuts";
import { toggleSidebar } from "./Sidebar";

const GO: Record<string, string> = {
  h: "home",
  m: "mentions",
  d: "dashboards",
  a: "alerts",
  r: "reports",
};

/** App-wide single-key shortcuts: g-chords, [ (sidebar), ? (help). All disabled by the settings switch. */
export function GlobalShortcuts({ ws }: { ws: string }) {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const chord = useRef<number>(0);

  useEffect(() => {
    setEnabled(shortcutsEnabled());
    const onDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e) || !shortcutsEnabled()) return;
      if (document.querySelector("dialog[open]")) return;
      const now = Date.now();
      if (now - chord.current < 1200 && GO[e.key]) {
        chord.current = 0;
        track("Keyboard Shortcut Used", { shortcut: `g ${e.key}`, context: "global" });
        router.push(`/w/${ws}/${GO[e.key]}`);
        return;
      }
      if (e.key === "g") chord.current = now;
      else if (e.key === "?") {
        e.preventDefault();
        setHelp(true);
        track("Help Opened", {});
      } else if (e.key === "[") {
        toggleSidebar();
        track("Keyboard Shortcut Used", { shortcut: "[", context: "global" });
      }
    };
    const open = () => setHelp(true);
    window.addEventListener("keydown", onDown);
    window.addEventListener("rw-open-shortcuts", open);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("rw-open-shortcuts", open);
    };
  }, [router, ws]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (help && !d.open) d.showModal();
    if (!help && d.open) d.close();
  }, [help]);

  const groups = [...new Set(SHORTCUT_HELP.map((s) => s.group))];
  return (
    <dialog
      ref={dialog}
      aria-labelledby="sc-title"
      data-testid="shortcut-help"
      onClose={() => setHelp(false)}
      className="m-auto w-full max-w-lg rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text)] backdrop:bg-black/40"
    >
      <h2 id="sc-title" className="text-xl font-semibold">
        Keyboard shortcuts
      </h2>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          data-testid="shortcuts-toggle"
          onChange={(e) => {
            setEnabled(e.target.checked);
            setShortcutsEnabled(e.target.checked);
          }}
        />
        Enable single-key shortcuts
      </label>
      <p className="text-xs text-[var(--text-muted)]">
        Turn these off if they clash with assistive technology. Shortcuts with Ctrl/⌘ always work.
      </p>
      {groups.map((g) => (
        <section key={g} className="mt-4">
          <h3 className="text-sm font-medium">{g}</h3>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {SHORTCUT_HELP.filter((s) => s.group === g).map((s) => (
              <div key={s.keys} className="contents">
                <dt>
                  <kbd className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">
                    {s.keys}
                  </kbd>
                </dt>
                <dd className="text-[var(--text-muted)]">{s.action}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <form method="dialog" className="mt-6">
        <button className="min-h-9 rounded-md border border-[var(--border)] px-4 text-sm font-medium">
          Close
        </button>
      </form>
    </dialog>
  );
}
