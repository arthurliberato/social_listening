# Query language (M3)

Queries are Boolean text, parsed by `lib/query/grammar.peggy` into an AST (`lib/query/ast.ts`), linted
(`lint.ts`), and compiled to a single Postgres predicate (`compile.ts`). The guided builder compiles to the
same text, so both modes produce identical queries.

| Syntax | Meaning |
|---|---|
| `coffee price` / `coffee AND price` | both words (adjacency is AND) |
| `tea OR coffee` | either |
| `coffee NOT job` / `NOT job` (prefix) | exclude; `A NOT B` = `A AND NOT B` |
| `"juniper roast"` | exact phrase |
| `run*` | trailing wildcard only (`run`, `running`, …) |
| `a NEAR/5 b` | within 5 words, either order (1–20) |
| `a NEAR/5f b` | within 5 words, `a` before `b` |
| `#brand`, `@brand` | hashtag / mention (the `#` / `@` must be present in the text) |
| `author:handle` `site:domain` `source:reddit` `lang:en` `country:US` `hashtag:brand` `logo:brandslug` | field filters |
| `replyto:"https://…/@jane/12"` | the replies (comments) to one post, named by its URL; quote it, since URLs contain `:` |
| `replyto:@jane` | replies to anything `@jane` posted |
| `<<<note>>>` | comment, ignored |

**Precedence (tight → loose):** `NEAR`, `NOT`, `AND`, `OR`. So `a OR b c` means `a OR (b AND c)`; the linter warns
and suggests parentheses. Operators are UPPERCASE only — lowercase `and/or/not` are searched as words (warned).

**Matching is token-based**, case-insensitive, with no accent folding (`deçu` ≠ `déçu`), using Postgres's
`simple` text-search configuration, which needs a UTF-8 database locale. `NEAR` operands must be words, phrases or
OR-groups of them. A query must contain at least one positive term.

**Design notes**
- All text-only subtrees collapse into one `tsquery`, so the GIN index serves them; fields/hashtags become SQL predicates.
- Postgres `<N>` means "exactly N apart", so `NEAR/n` expands to the OR of distances 1..n (both orders unless `f`).
- User input only ever reaches SQL as bound parameters.
- Preview "noise" is a *product-side* heuristic (author bot score + promotional wording), deliberately independent of
  the corpus's ground-truth `is_spam`.
- Backfill covers the plan's history window, newest first, up to the account's remaining monthly mention allowance.
