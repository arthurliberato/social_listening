import { tokens } from "./tokens";

export interface Term {
  value: string;
  wildcard: boolean;
}
export interface Range {
  start: number;
  end: number;
  term: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Find where query terms occur in a mention (case-insensitive, word-boundary aware).
 * Used both for <mark> highlighting and for the "Why did this match?" explanation.
 */
export function findMatches(text: string, terms: Term[]): Range[] {
  const out: Range[] = [];
  for (const t of terms) {
    const parts = tokens(t.value);
    if (!parts.length) continue;
    const body = parts.map(esc).join("[^\\p{L}\\p{N}]+");
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])${body}${t.wildcard ? "[\\p{L}\\p{N}]*" : "(?![\\p{L}\\p{N}])"}`,
      "giu",
    );
    for (const m of text.matchAll(re))
      out.push({
        start: m.index!,
        end: m.index! + m[0].length,
        term: t.value + (t.wildcard ? "*" : ""),
      });
  }
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  // Drop ranges swallowed by an earlier, longer one.
  const merged: Range[] = [];
  for (const r of out)
    if (!merged.length || r.start >= merged[merged.length - 1]!.end) merged.push(r);
  return merged;
}

export function splitHighlighted(text: string, ranges: Range[]): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const r of ranges) {
    if (r.start > at) parts.push({ text: text.slice(at, r.start), hit: false });
    parts.push({ text: text.slice(r.start, r.end), hit: true });
    at = r.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}
