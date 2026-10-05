import { FIELDS, MAX_NEAR, walk, type Node } from "./ast";
import { parse, SyntaxError as PegSyntaxError } from "./parser.generated.mjs";
import { tokens } from "./tokens";

export interface Issue {
  severity: "error" | "warning";
  code: string;
  message: string;
  start: number;
  end: number;
}

export interface Analysis {
  ast: Node | null;
  issues: Issue[];
  /** True when the query can be saved and run. */
  ok: boolean;
}

const lastWordBefore = (text: string, idx: number) => {
  const m = [...text.slice(0, idx).matchAll(/[^\s()"*:#@]+/g)].pop();
  return m?.[0] ?? null;
};

/** Mask quoted strings and <<<comments>>> so structural checks ignore their contents. */
function mask(text: string): string {
  return text
    .replace(/<<<[\s\S]*?>>>/g, (m) => " ".repeat(m.length))
    .replace(/"[^"]*"/g, (m) => '"' + " ".repeat(Math.max(0, m.length - 2)) + '"');
}

function structural(text: string): Issue[] {
  const issues: Issue[] = [];
  const noComments = text.replace(/<<<[\s\S]*?>>>/g, (m) => " ".repeat(m.length));
  const quotes = [...noComments].flatMap((c, i) => (c === '"' ? [i] : []));
  if (quotes.length % 2 === 1) {
    const at = quotes[quotes.length - 1]!;
    issues.push({
      severity: "error",
      code: "unbalanced_quote",
      message: 'Missing closing quote (").',
      start: at,
      end: at + 1,
    });
    return issues; // paren checks are unreliable with an open string
  }
  const masked = mask(text);
  const stack: number[] = [];
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === "(") stack.push(i);
    else if (masked[i] === ")") {
      if (stack.length === 0)
        issues.push({
          severity: "error",
          code: "unbalanced_paren",
          message: "Unexpected closing parenthesis.",
          start: i,
          end: i + 1,
        });
      else stack.pop();
    }
  }
  for (const open of stack) {
    const word = lastWordBefore(text, text.length);
    issues.push({
      severity: "error",
      code: "unbalanced_paren",
      message: word
        ? `Missing closing parenthesis after '${word}'.`
        : "Missing closing parenthesis.",
      start: open,
      end: open + 1,
    });
  }
  return issues;
}

function syntaxIssue(e: InstanceType<typeof PegSyntaxError>, text: string): Issue {
  const start = e.location.start.offset;
  const end = Math.max(e.location.end.offset, start + 1);
  const found = e.found;
  if (found === null) {
    return {
      severity: "error",
      code: "incomplete",
      message: "The query ends unexpectedly. Add a term after the last operator.",
      start: text.length,
      end: text.length,
    };
  }
  if (/NEAR\/\d+f?\s*$/.test(text.slice(0, start))) {
    return {
      severity: "error",
      code: "near_operand",
      message: "NEAR works on words, phrases, or OR-groups of them — not on NOT, fields or tags.",
      start,
      end,
    };
  }
  if (found === "*")
    return {
      severity: "error",
      code: "wildcard_position",
      message: "Wildcards (*) only work at the end of a word, like run*.",
      start,
      end,
    };
  if (
    /^NEAR/.test(text.slice(Math.max(0, start - 1), start + 6)) ||
    /NEAR(?!\/\d)/.test(text.slice(Math.max(0, start - 5), start + 6))
  ) {
    return {
      severity: "error",
      code: "near_syntax",
      message: "NEAR needs a distance, like NEAR/5 (any order) or NEAR/5f (in order).",
      start,
      end,
    };
  }
  if (found === ")" || found === "(")
    return {
      severity: "error",
      code: "unbalanced_paren",
      message: "Parentheses don't match here.",
      start,
      end,
    };
  return {
    severity: "error",
    code: "syntax",
    message: `Unexpected '${found}' — check the operators around it.`,
    start,
    end,
  };
}

const isTextOnly = (n: Node): boolean => {
  switch (n.t) {
    case "term":
    case "phrase":
      return true;
    case "near":
      return isTextOnly(n.left) && isTextOnly(n.right);
    default:
      return false;
  }
};
/** NEAR operands: a word, a phrase, or an OR-group of those. */
const isNearOperand = (n: Node): boolean =>
  isTextOnly(n) || (n.t === "or" && n.args.every(isNearOperand));

const hasPositive = (n: Node): boolean => {
  switch (n.t) {
    case "not":
      return false;
    case "and":
      return n.args.some(hasPositive);
    case "or":
      return n.args.every(hasPositive);
    default:
      return true;
  }
};

function isParenthesized(text: string, n: Node): boolean {
  let i = n.start - 1;
  while (i >= 0 && /\s/.test(text[i]!)) i--;
  let j = n.end;
  while (j < text.length && /\s/.test(text[j]!)) j++;
  return text[i] === "(" && text[j] === ")";
}

export function analyze(text: string): Analysis {
  if (!text.trim()) {
    return {
      ast: null,
      ok: false,
      issues: [
        {
          severity: "error",
          code: "empty",
          message: "Enter at least one search term.",
          start: 0,
          end: 0,
        },
      ],
    };
  }
  const issues = structural(text);
  if (issues.length) return { ast: null, ok: false, issues };

  let ast: Node;
  try {
    ast = parse(text);
  } catch (e) {
    if (e instanceof PegSyntaxError)
      return { ast: null, ok: false, issues: [syntaxIssue(e, text)] };
    throw e;
  }

  walk(ast, (n) => {
    switch (n.t) {
      case "term": {
        if (!tokens(n.value).length)
          issues.push({
            severity: "error",
            code: "no_searchable",
            message: `'${n.value}' has no letters or digits to search for.`,
            start: n.start,
            end: n.end,
          });
        else if (n.wildcard && n.value.length < 3)
          issues.push({
            severity: "warning",
            code: "broad_wildcard",
            message: `'${n.value}*' is very broad and will match a lot of noise.`,
            start: n.start,
            end: n.end,
          });
        else if (!n.wildcard && n.value.length === 1)
          issues.push({
            severity: "warning",
            code: "short_term",
            message: `'${n.value}' is a single character and will match a lot of noise.`,
            start: n.start,
            end: n.end,
          });
        if (n.wildcard && /[^\s()"]/.test(text[n.end] ?? " "))
          issues.push({
            severity: "error",
            code: "wildcard_position",
            message: "Wildcards (*) only work at the end of a word, like run*.",
            start: n.start,
            end: n.end + 1,
          });
        if (/^(and|or|not|near)$/.test(n.value))
          issues.push({
            severity: "warning",
            code: "lowercase_operator",
            message: `'${n.value}' is searched as a word. Use ${n.value.toUpperCase()} (uppercase) for the operator.`,
            start: n.start,
            end: n.end,
          });
        break;
      }
      case "phrase":
        if (!tokens(n.value).length)
          issues.push({
            severity: "error",
            code: "no_searchable",
            message: "This phrase has no letters or digits to search for.",
            start: n.start,
            end: n.end,
          });
        break;
      case "hashtag":
      case "mention":
        if (!tokens(n.value).length)
          issues.push({
            severity: "error",
            code: "no_searchable",
            message: `'${n.value}' has no letters or digits to search for.`,
            start: n.start,
            end: n.end,
          });
        break;
      case "field": {
        if (!(FIELDS as readonly string[]).includes(n.name)) {
          issues.push({
            severity: "error",
            code: "unknown_field",
            message: `Unknown field '${n.name}:'. Use one of ${FIELDS.map((f) => f + ":").join(", ")}.`,
            start: n.start,
            end: n.end,
          });
        } else if (!n.value.trim()) {
          issues.push({
            severity: "error",
            code: "empty_field",
            message: `'${n.name}:' needs a value.`,
            start: n.start,
            end: n.end,
          });
        } else if (n.name === "lang" && !/^[a-z]{2}$/.test(n.value)) {
          issues.push({
            severity: "warning",
            code: "bad_lang",
            message: `'${n.value}' isn't a two-letter language code like en or pt.`,
            start: n.start,
            end: n.end,
          });
        } else if (n.name === "country" && !/^[A-Za-z]{2}$/.test(n.value)) {
          issues.push({
            severity: "warning",
            code: "bad_country",
            message: `'${n.value}' isn't a two-letter country code like US or BR.`,
            start: n.start,
            end: n.end,
          });
        }
        break;
      }
      case "near":
        if (n.distance < 1 || n.distance > MAX_NEAR)
          issues.push({
            severity: "error",
            code: "near_distance",
            message: `NEAR distance must be between 1 and ${MAX_NEAR} words.`,
            start: n.start,
            end: n.end,
          });
        if (!isNearOperand(n.left) || !isNearOperand(n.right))
          issues.push({
            severity: "error",
            code: "near_operand",
            message:
              "NEAR works on words, phrases, or OR-groups of them — not on NOT, fields or tags.",
            start: n.start,
            end: n.end,
          });
        break;
      case "or":
        for (const a of n.args) {
          if (a.t === "and" && !isParenthesized(text, a)) {
            issues.push({
              severity: "warning",
              code: "precedence",
              message:
                "AND binds tighter than OR here. Add parentheses to make the grouping explicit.",
              start: a.start,
              end: a.end,
            });
          }
        }
        break;
    }
  });

  if (!hasPositive(ast)) {
    issues.push({
      severity: "error",
      code: "only_negative",
      message: "Add at least one term to include. A query can't be made only of exclusions.",
      start: ast.start,
      end: ast.end,
    });
  }
  issues.sort((a, b) => a.start - b.start);
  return { ast, issues, ok: !issues.some((i) => i.severity === "error") };
}
