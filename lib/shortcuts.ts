"use client";

import { useEffect, useState } from "react";

const KEY = "rw-shortcuts";
const EVT = "rw-shortcuts-change";

export function shortcutsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setShortcutsEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable: setting applies for this page only */
  }
  window.dispatchEvent(new Event(EVT));
}

/** Single-key shortcuts can be turned off (WCAG 2.1.4); modifier shortcuts always work. */
export function useShortcutsEnabled(): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const sync = () => setOn(shortcutsEnabled());
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);
  return on;
}

/** True when the keystroke is destined for a text field, so single-key shortcuts must stay out of the way. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return (
    t.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) ||
    t.closest(".cm-editor") !== null
  );
}

export const SHORTCUT_HELP: { keys: string; action: string; group: string }[] = [
  { group: "Go to", keys: "g h", action: "Home" },
  { group: "Go to", keys: "g m", action: "Mentions" },
  { group: "Go to", keys: "g d", action: "Dashboards" },
  { group: "Go to", keys: "g a", action: "Alerts" },
  { group: "Go to", keys: "g r", action: "Reports" },
  { group: "Mentions", keys: "j / k", action: "Next / previous mention" },
  { group: "Mentions", keys: "Enter or o", action: "Open mention details" },
  { group: "Mentions", keys: "x", action: "Select mention" },
  { group: "Mentions", keys: "t", action: "Tag" },
  {
    group: "Mentions",
    keys: "s then p / n / u / m",
    action: "Set sentiment: positive / negative / neutral / mixed",
  },
  { group: "Mentions", keys: "f", action: "Flag" },
  { group: "Mentions", keys: "e", action: "Export (selection or current view)" },
  { group: "Mentions", keys: "N", action: "Load new mentions" },
  { group: "Anywhere", keys: "/", action: "Focus search" },
  { group: "Anywhere", keys: "Ctrl/⌘ S", action: "Save (query builder)" },
  { group: "Anywhere", keys: "[", action: "Collapse sidebar" },
  { group: "Anywhere", keys: "?", action: "Show this help" },
  { group: "Anywhere", keys: "Esc", action: "Close panel or clear selection" },
];
