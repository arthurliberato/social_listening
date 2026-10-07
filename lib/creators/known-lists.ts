"use client";

import { useSyncExternalStore } from "react";

export interface KnownList {
  id: string;
  name: string;
}

// Lists created in this browser tab since the page loaded. Every "Add to list" button on the page reads from here,
// so a list made from one row is offered on the others straight away, without waiting for the page to re-render.
let created: KnownList[] = [];
const listeners = new Set<() => void>();

export function rememberList(l: KnownList) {
  if (created.some((x) => x.id === l.id)) return;
  created = [...created, l];
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** The lists from the server plus any made since, without duplicates. */
export function useLists(fromServer: KnownList[]): KnownList[] {
  const extra = useSyncExternalStore(
    subscribe,
    () => created,
    () => created,
  );
  const have = new Set(fromServer.map((l) => l.id));
  return [...fromServer, ...extra.filter((l) => !have.has(l.id))];
}
