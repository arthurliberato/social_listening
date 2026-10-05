// Grid layout engine: 12 columns, vertical gravity, collision resolution. Pure and unit-tested.
// Drag, keyboard and menu moves all go through the same functions, so every input method behaves alike.
import { COLS } from "./catalog";

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const clampBox = (b: Box): Box => {
  const w = Math.max(1, Math.min(COLS, Math.round(b.w)));
  const h = Math.max(1, Math.round(b.h));
  return {
    ...b,
    w,
    h,
    x: Math.max(0, Math.min(COLS - w, Math.round(b.x))),
    y: Math.max(0, Math.round(b.y)),
  };
};

/**
 * Settle a layout: the pinned box (if any) keeps its requested spot; every other box falls to the
 * lowest-numbered row where it fits without overlapping. Order of the input array is preserved.
 */
export function compact(items: Box[], pinnedId?: string): Box[] {
  const placed: Box[] = [];
  const result = new Map<string, Box>();
  const pinned = pinnedId ? items.find((i) => i.id === pinnedId) : undefined;
  if (pinned) {
    const p = clampBox(pinned);
    placed.push(p);
    result.set(p.id, p);
  }
  const rest = items
    .filter((i) => i.id !== pinnedId)
    .map((b, order) => ({ b: clampBox(b), order }));
  rest.sort((a, b) => a.b.y - b.b.y || a.b.x - b.b.x || a.order - b.order);
  for (const { b } of rest) {
    let y = 0;
    let box = { ...b, y };
    while (placed.some((p) => overlap(p, box))) box = { ...b, y: ++y };
    placed.push(box);
    result.set(box.id, box);
  }
  return items.map((i) => result.get(i.id)!);
}

export function moveTo(items: Box[], id: string, x: number, y: number): Box[] {
  return compact(
    items.map((i) => (i.id === id ? { ...i, x, y } : i)),
    id,
  );
}

export function moveBy(items: Box[], id: string, dx: number, dy: number): Box[] {
  const it = items.find((i) => i.id === id);
  return it ? moveTo(items, id, it.x + dx, it.y + dy) : items;
}

export function resize(items: Box[], id: string, w: number, h: number): Box[] {
  return compact(
    items.map((i) => (i.id === id ? { ...i, w, h } : i)),
    id,
  );
}

/** Where a new w×h widget goes: the first free spot, scanning rows top to bottom. */
export function firstFree(items: Box[], w: number, h: number): { x: number; y: number } {
  const probe = (x: number, y: number): Box => ({ id: "__new", x, y, w, h });
  for (let y = 0; ; y++) {
    for (let x = 0; x + w <= COLS; x++) {
      if (!items.some((i) => overlap(i, probe(x, y)))) return { x, y };
    }
  }
}

export const bottom = (items: Box[]) => items.reduce((m, i) => Math.max(m, i.y + i.h), 0);

/** Which direction can this box still move? (For disabling menu items.) */
export function canMove(
  items: Box[],
  id: string,
): { left: boolean; right: boolean; up: boolean; down: boolean } {
  const i = items.find((b) => b.id === id);
  if (!i) return { left: false, right: false, up: false, down: false };
  return { left: i.x > 0, right: i.x + i.w < COLS, up: i.y > 0, down: true };
}
