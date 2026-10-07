"use client";

import { useSyncExternalStore } from "react";

// The creators ticked for comparison. They survive paging and changing filters within the tab (sessionStorage), and
// every checkbox and the bar read the same list, so there is one source of truth on the page.
const KEY = "rw-compare";
let ids: number[] = read();
let limitHit = false;
const listeners = new Set<() => void>();

function read(): number[] {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n)).slice(0, 12) : [];
  } catch {
    return [];
  }
}
function emit() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* private mode: the selection lasts as long as the page */
  }
  listeners.forEach((fn) => fn());
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** Tick or untick. Past the plan's limit nothing is added and the limit flag is raised so the bar can say why. */
export function toggleCompare(id: number, max: number): "added" | "removed" | "limit" {
  if (ids.includes(id)) {
    ids = ids.filter((x) => x !== id);
    emit();
    return "removed";
  }
  if (ids.length >= max) {
    limitHit = true;
    emit();
    return "limit";
  }
  ids = [...ids, id];
  emit();
  return "added";
}
export function clearCompare() {
  ids = [];
  emit();
}
export function dismissLimit() {
  limitHit = false;
  emit();
}

const EMPTY: number[] = [];
export function useCompareSelection(): { ids: number[]; limitHit: boolean } {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => ids,
    () => EMPTY,
  );
  const hit = useSyncExternalStore(
    subscribe,
    () => limitHit,
    () => false,
  );
  return { ids: snapshot, limitHit: hit };
}
