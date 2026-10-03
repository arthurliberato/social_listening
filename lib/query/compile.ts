import { sql, type SQL } from "drizzle-orm";
import { MAX_NEAR, type Node } from "./ast";
import { tokens } from "./tokens";

/**
 * Compile an AST to a Postgres predicate over `mentions` (unqualified columns).
 * Maximal text-only subtrees collapse into ONE tsquery so the GIN index serves them; fields,
 * hashtags and mentions become SQL predicates combined with AND/OR/NOT.
 * Only call this with an AST that passed lint.
 */

const quote = (w: string) => `'${w.replace(/'/g, "''").replace(/\\/g, "\\\\")}'`;

function lexemes(value: string, prefixLast: boolean): string | null {
  const ts = tokens(value);
  if (!ts.length) return null;
  return ts.map((t, i) => quote(t) + (prefixLast && i === ts.length - 1 ? ":*" : "")).join(" <-> ");
}

const isTextOnly = (n: Node): boolean => {
  switch (n.t) {
    case "term":
    case "phrase":
      return true;
    case "and":
    case "or":
      return n.args.every(isTextOnly);
    case "not":
      return isTextOnly(n.arg);
    case "near":
      return isTextOnly(n.left) && isTextOnly(n.right);
    default:
      return false;
  }
};

/** tsquery text for a text-only subtree. `null` means "can never match". */
export function toTsquery(n: Node): string | null {
  switch (n.t) {
    case "term":
      return lexemes(n.value, n.wildcard);
    case "phrase":
      return lexemes(n.value, false);
    case "and":
    case "or": {
      const parts = n.args.map(toTsquery);
      if (n.t === "and") return parts.some((p) => p === null) ? null : `(${parts.join(" & ")})`;
      const live = parts.filter((p): p is string => p !== null);
      return live.length ? `(${live.join(" | ")})` : null;
    }
    case "not": {
      const inner = toTsquery(n.arg);
      return inner === null ? null : `!(${inner})`;
    }
    case "near": {
      const a = toTsquery(n.left);
      const b = toTsquery(n.right);
      if (a === null || b === null) return null;
      const d = Math.min(Math.max(1, n.distance), MAX_NEAR);
      // Postgres <N> means "exactly N apart", so "within N" is the OR of 1..N (both orders unless NEAR/Nf).
      const alts: string[] = [];
      for (let k = 1; k <= d; k++) {
        alts.push(`(${a} <${k}> ${b})`);
        if (!n.ordered) alts.push(`(${b} <${k}> ${a})`);
      }
      return `(${alts.join(" | ")})`;
    }
    default:
      return null;
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");

const tsMatch = (q: string) => sql`tsv @@ to_tsquery('simple', ${q})`;
const FALSE = sql`FALSE`;

export function compile(n: Node): SQL {
  if (isTextOnly(n)) {
    const q = toTsquery(n);
    return q === null ? FALSE : tsMatch(q);
  }
  switch (n.t) {
    case "and":
      return sql`(${sql.join(n.args.map(compile), sql` AND `)})`;
    case "or":
      return sql`(${sql.join(n.args.map(compile), sql` OR `)})`;
    case "not":
      return sql`NOT (${compile(n.arg)})`;
    case "hashtag":
    case "mention": {
      const mark = n.t === "hashtag" ? "#" : "@";
      const ts = lexemes(n.value, false);
      if (ts === null) return FALSE;
      // tsquery drops the # / @ marker, so also require it literally in the text.
      const re = `(^|[^[:alnum:]_])${mark}${escapeRe(n.value.toLowerCase())}([^[:alnum:]_]|$)`;
      return sql`(${tsMatch(ts)} AND text ~* ${re})`;
    }
    case "field": {
      const v = n.value.trim();
      switch (n.name) {
        case "author":
          return sql`author_id IN (SELECT id FROM authors WHERE lower(handle) = ${v.replace(/^@/, "").toLowerCase()})`;
        case "source":
          return sql`source_id IN (SELECT id FROM sources WHERE type = ${v.toLowerCase()})`;
        case "site":
          return sql`split_part(url, '/', 3) ILIKE ${"%" + escapeLike(v) + "%"}`;
        case "lang":
          return sql`lang = ${v.toLowerCase()}`;
        case "country":
          return sql`country = ${v.toUpperCase()}`;
        case "hashtag": {
          const ts = lexemes(v.replace(/^#/, ""), false);
          if (ts === null) return FALSE;
          const re = `(^|[^[:alnum:]_])#${escapeRe(v.replace(/^#/, "").toLowerCase())}([^[:alnum:]_]|$)`;
          return sql`(${tsMatch(ts)} AND text ~* ${re})`;
        }
        case "logo":
          return sql`detected_logos @> ARRAY[${slug(v)}]::text[]`;
        default:
          return FALSE;
      }
    }
    default:
      return FALSE;
  }
}

export interface Filters {
  sources?: string[];
  languages?: string[];
  countries?: string[];
}

/** Structured filters from the builder (separate from the Boolean text). */
export function compileFilters(f: Filters): SQL {
  const parts: SQL[] = [];
  if (f.sources?.length)
    parts.push(
      sql`source_id IN (SELECT id FROM sources WHERE type IN (${sql.join(
        f.sources.map((s) => sql`${s}`),
        sql`, `,
      )}))`,
    );
  if (f.languages?.length)
    parts.push(
      sql`lang IN (${sql.join(
        f.languages.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
  if (f.countries?.length)
    parts.push(
      sql`country IN (${sql.join(
        f.countries.map((s) => sql`${s.toUpperCase()}`),
        sql`, `,
      )})`,
    );
  return parts.length ? sql.join(parts, sql` AND `) : sql`TRUE`;
}
