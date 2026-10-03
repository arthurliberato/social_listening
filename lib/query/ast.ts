/** Boolean query AST. `start`/`end` are character offsets into the source text (for lint + highlight). */
export interface Span {
  start: number;
  end: number;
}

export type Node =
  | ({ t: "term"; value: string; wildcard: boolean } & Span)
  | ({ t: "phrase"; value: string } & Span)
  | ({ t: "hashtag"; value: string } & Span)
  | ({ t: "mention"; value: string } & Span)
  | ({ t: "field"; name: string; value: string } & Span)
  | ({ t: "and"; args: Node[] } & Span)
  | ({ t: "or"; args: Node[] } & Span)
  | ({ t: "not"; arg: Node } & Span)
  | ({ t: "near"; left: Node; right: Node; distance: number; ordered: boolean } & Span);

export const FIELDS = ["author", "site", "source", "lang", "country", "hashtag", "logo"] as const;
export type FieldName = (typeof FIELDS)[number];
export const MAX_NEAR = 20;

/** Walk every node (pre-order). */
export function walk(n: Node, fn: (n: Node, underNot: boolean) => void, underNot = false): void {
  fn(n, underNot);
  switch (n.t) {
    case "and":
    case "or":
      n.args.forEach((a) => walk(a, fn, underNot));
      break;
    case "not":
      walk(n.arg, fn, !underNot);
      break;
    case "near":
      walk(n.left, fn, underNot);
      walk(n.right, fn, underNot);
      break;
  }
}

/** Words/phrases a matching mention must be able to contain (not under NOT) — used for highlighting. */
export function positiveTerms(n: Node): { value: string; wildcard: boolean }[] {
  const out: { value: string; wildcard: boolean }[] = [];
  walk(n, (x, underNot) => {
    if (underNot) return;
    if (x.t === "term") out.push({ value: x.value, wildcard: x.wildcard });
    else if (x.t === "phrase" || x.t === "hashtag" || x.t === "mention")
      out.push({ value: x.value, wildcard: false });
  });
  return out;
}

export function stats(n: Node) {
  let operators = 0;
  let exclusions = 0;
  let hasNear = false;
  walk(n, (x, underNot) => {
    if (x.t === "and" || x.t === "or") operators += x.args.length - 1;
    if (x.t === "not") {
      operators++;
      if (!underNot) exclusions++;
    }
    if (x.t === "near") {
      operators++;
      hasNear = true;
    }
  });
  return { operators, exclusions, hasNear };
}
