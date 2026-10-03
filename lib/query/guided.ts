import type { Node } from "./ast";

/** The guided builder's form model; compiles to (and parses back from) Boolean text. */
export interface Guided {
  /** Must include any of these. */
  any: string[];
  /** Must also include any of these... */
  also: string[];
  /** ...within this many words of the first group (0 = anywhere in the mention). */
  within: number;
  /** Exclude mentions containing any of these. */
  exclude: string[];
}

export const emptyGuided = (): Guided => ({ any: [], also: [], within: 0, exclude: [] });

const RESERVED = /^(AND|OR|NOT|NEAR)$/;

/** Serialise one chip: bare when safe, quoted otherwise. */
export function serializeTerm(raw: string): string {
  const t = raw.trim().replace(/"/g, "");
  if (!t) return "";
  if (/^[#@][^\s()":*#@]+$/.test(t)) return t;
  if (/^[^\s()":*#@]+\*?$/.test(t) && !RESERVED.test(t.replace(/\*$/, ""))) return t;
  return `"${t}"`;
}

const group = (terms: string[]) => {
  const parts = terms.map(serializeTerm).filter(Boolean);
  if (!parts.length) return "";
  return parts.length === 1 ? parts[0]! : `(${parts.join(" OR ")})`;
};

export function compileGuided(g: Guided): string {
  const any = group(g.any);
  if (!any) return "";
  const also = group(g.also);
  let q = any;
  if (also) q += g.within > 0 ? ` NEAR/${g.within} ${also}` : ` AND ${also}`;
  const ex = g.exclude.map(serializeTerm).filter(Boolean);
  if (ex.length) q += ` NOT ${ex.length === 1 ? ex[0] : `(${ex.join(" OR ")})`}`;
  return q;
}

/** A leaf the guided form can represent as a chip. */
function chip(n: Node): string | null {
  switch (n.t) {
    case "term":
      return n.value + (n.wildcard ? "*" : "");
    case "phrase":
      return n.value;
    case "hashtag":
      return `#${n.value}`;
    case "mention":
      return `@${n.value}`;
    default:
      return null;
  }
}

function chips(n: Node): string[] | null {
  if (n.t === "or") {
    const out: string[] = [];
    for (const a of n.args) {
      const c = chip(a);
      if (c === null) return null;
      out.push(c);
    }
    return out;
  }
  const c = chip(n);
  return c === null ? null : [c];
}

/**
 * Parse Boolean text back into the guided form. Returns null when the query uses constructs the
 * form can't express (fields, nested groups, ordered NEAR...), so the UI can warn before switching.
 */
export function toGuided(ast: Node): Guided | null {
  const args = ast.t === "and" ? ast.args : [ast];
  const g = emptyGuided();
  const positives: Node[] = [];
  for (const a of args) {
    if (a.t === "not") {
      const c = chips(a.arg);
      if (!c) return null;
      g.exclude.push(...c);
    } else positives.push(a);
  }
  if (positives.length === 1) {
    const p = positives[0]!;
    if (p.t === "near") {
      if (p.ordered) return null;
      const l = chips(p.left);
      const r = chips(p.right);
      if (!l || !r) return null;
      g.any = l;
      g.also = r;
      g.within = p.distance;
    } else {
      const c = chips(p);
      if (!c) return null;
      g.any = c;
    }
  } else if (positives.length === 2) {
    const l = chips(positives[0]!);
    const r = chips(positives[1]!);
    if (!l || !r) return null;
    g.any = l;
    g.also = r;
  } else return null;
  return g;
}
