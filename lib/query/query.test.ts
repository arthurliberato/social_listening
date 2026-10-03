import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { stats, positiveTerms, type Node } from "./ast";
import { compile, compileFilters, toTsquery } from "./compile";
import { analyze } from "./lint";
import { parse } from "./parser.generated.mjs";

const dialect = new PgDialect();
const p = (q: string) => parse(q);
const shape = (n: Node): unknown => {
  switch (n.t) {
    case "term":
      return n.wildcard ? `${n.value}*` : n.value;
    case "phrase":
      return `"${n.value}"`;
    case "hashtag":
      return `#${n.value}`;
    case "mention":
      return `@${n.value}`;
    case "field":
      return `${n.name}:${n.value}`;
    case "and":
      return ["AND", ...n.args.map(shape)];
    case "or":
      return ["OR", ...n.args.map(shape)];
    case "not":
      return ["NOT", shape(n.arg)];
    case "near":
      return [`NEAR/${n.distance}${n.ordered ? "f" : ""}`, shape(n.left), shape(n.right)];
  }
};
const ts = (q: string) => toTsquery(p(q));
const errors = (q: string) =>
  analyze(q)
    .issues.filter((i) => i.severity === "error")
    .map((i) => i.code);
const warnings = (q: string) =>
  analyze(q)
    .issues.filter((i) => i.severity === "warning")
    .map((i) => i.code);

describe("grammar", () => {
  it("parses a single term", () => expect(shape(p("coffee"))).toBe("coffee"));
  it("treats adjacency as AND", () =>
    expect(shape(p("coffee price"))).toEqual(["AND", "coffee", "price"]));
  it("parses explicit AND", () =>
    expect(shape(p("coffee AND price"))).toEqual(["AND", "coffee", "price"]));
  it("parses OR", () => expect(shape(p("a OR b OR c"))).toEqual(["OR", "a", "b", "c"]));
  it("binds AND tighter than OR", () =>
    expect(shape(p("a OR b c"))).toEqual(["OR", "a", ["AND", "b", "c"]]));
  it("lets parentheses override precedence", () =>
    expect(shape(p("(a OR b) c"))).toEqual(["AND", ["OR", "a", "b"], "c"]));
  it("parses quoted phrases", () => expect(shape(p('"Juniper Roast"'))).toBe('"Juniper Roast"'));
  it("parses prefix NOT", () => expect(shape(p("NOT spam"))).toEqual(["NOT", "spam"]));
  it("reads 'A NOT B' as A AND NOT B", () =>
    expect(shape(p("a NOT b"))).toEqual(["AND", "a", ["NOT", "b"]]));
  it("negates groups", () =>
    expect(shape(p("a NOT (job OR hiring)"))).toEqual([
      "AND",
      "a",
      ["NOT", ["OR", "job", "hiring"]],
    ]));
  it("parses NEAR/n as unordered", () =>
    expect(shape(p("a NEAR/5 b"))).toEqual(["NEAR/5", "a", "b"]));
  it("parses NEAR/nf as ordered", () =>
    expect(shape(p("a NEAR/3f b"))).toEqual(["NEAR/3f", "a", "b"]));
  it("chains NEAR left-associatively", () =>
    expect(shape(p("a NEAR/2 b NEAR/4 c"))).toEqual(["NEAR/4", ["NEAR/2", "a", "b"], "c"]));
  it("accepts OR-groups as NEAR operands", () =>
    expect(shape(p("(a OR b) NEAR/3 (c OR d)"))).toEqual([
      "NEAR/3",
      ["OR", "a", "b"],
      ["OR", "c", "d"],
    ]));
  it("parses trailing wildcards", () => expect(shape(p("run*"))).toBe("run*"));
  it("parses hashtags and mentions", () =>
    expect(shape(p("#brand @brand"))).toEqual(["AND", "#brand", "@brand"]));
  it("parses fields", () =>
    expect(shape(p("author:jane lang:en"))).toEqual(["AND", "author:jane", "lang:en"]));
  it("parses quoted field values", () => expect(shape(p('site:"news-sim"'))).toBe("site:news-sim"));
  it("ignores <<<comments>>>", () =>
    expect(shape(p("coffee <<<main term>>> latte"))).toEqual(["AND", "coffee", "latte"]));
  it("treats lowercase operators as words", () =>
    expect(shape(p("tea or coffee"))).toEqual(["AND", "tea", "or", "coffee"]));
  it("does not confuse words that start with an operator", () =>
    expect(shape(p("ANDROID ORANGE NOTE NEARBY"))).toEqual([
      "AND",
      "ANDROID",
      "ORANGE",
      "NOTE",
      "NEARBY",
    ]));
  it("supports accents, emoji and hyphens", () =>
    expect(shape(p("café déçu 🔥 juniper-roast"))).toEqual([
      "AND",
      "café",
      "déçu",
      "🔥",
      "juniper-roast",
    ]));
  it("records character offsets", () => {
    const n = p("abc OR def") as Extract<Node, { t: "or" }>;
    expect([n.args[1]!.start, n.args[1]!.end]).toEqual([7, 10]);
  });
  it("extracts positive terms for highlighting but not excluded ones", () => {
    expect(positiveTerms(p('(a OR "b c") NOT d')).map((t) => t.value)).toEqual(["a", "b c"]);
  });
  it("counts operators, exclusions and NEAR", () => {
    expect(stats(p("(a OR b) NOT (c OR d) NOT e"))).toEqual({
      operators: 6,
      exclusions: 2,
      hasNear: false,
    });
    expect(stats(p("a NEAR/2 b")).hasNear).toBe(true);
  });
});

describe("lint: errors", () => {
  it("rejects empty queries", () => expect(errors("  ")).toEqual(["empty"]));
  it("explains a missing closing parenthesis", () => {
    const a = analyze("(tea OR coffee");
    expect(a.ok).toBe(false);
    expect(a.issues[0]!.message).toBe("Missing closing parenthesis after 'coffee'.");
  });
  it("flags an extra closing parenthesis", () =>
    expect(errors("tea)")).toEqual(["unbalanced_paren"]));
  it("flags an unclosed quote", () =>
    expect(errors('"juniper roast')).toEqual(["unbalanced_quote"]));
  it("ignores brackets inside quotes", () => expect(errors('"a (b" c')).toEqual([]));
  it("flags a dangling operator", () => expect(errors("coffee AND")).toEqual(["incomplete"]));
  it("flags NEAR without a distance", () => expect(errors("a NEAR b")).toEqual(["near_syntax"]));
  it("flags NEAR distances out of range", () => {
    expect(errors("a NEAR/0 b")).toEqual(["near_distance"]);
    expect(errors("a NEAR/21 b")).toEqual(["near_distance"]);
  });
  it("flags NEAR on non-word operands", () =>
    expect(errors("a NEAR/3 NOT b")).toContain("near_operand"));
  it("flags NEAR on fields", () => expect(errors("a NEAR/3 lang:en")).toContain("near_operand"));
  it("flags exclusion-only queries", () => {
    expect(errors("NOT spam")).toEqual(["only_negative"]);
    expect(errors("NOT a NOT b")).toEqual(["only_negative"]);
  });
  it("flags OR branches that only exclude", () =>
    expect(errors("coffee OR NOT tea")).toEqual(["only_negative"]));
  it("flags leading wildcards", () => expect(errors("*coffee")).toEqual(["wildcard_position"]));
  it("flags mid-word wildcards", () => expect(errors("jun*per")).toContain("wildcard_position"));
  it("flags unknown fields", () => expect(errors("foo:bar")).toEqual(["unknown_field"]));
  it("flags terms with nothing searchable", () => expect(errors("...")).toEqual(["no_searchable"]));
});

describe("lint: warnings and valid queries", () => {
  it("warns about broad wildcards", () => expect(warnings("ab*")).toEqual(["broad_wildcard"]));
  it("warns about single-character terms", () =>
    expect(warnings("x coffee")).toEqual(["short_term"]));
  it("warns when lowercase operators are used as words", () =>
    expect(warnings("tea or coffee")).toContain("lowercase_operator"));
  it("warns about implicit AND/OR precedence only when ungrouped", () => {
    expect(warnings("tea OR coffee mug")).toEqual(["precedence"]);
    expect(warnings("tea OR (coffee mug)")).toEqual([]);
  });
  it("warns about malformed language codes", () =>
    expect(warnings("coffee lang:english")).toEqual(["bad_lang"]));
  it("accepts the onboarding default query", () => {
    const a = analyze('("Juniper Roast" OR #juniperroast OR @juniperroast) NOT (job OR hiring)');
    expect(a.ok).toBe(true);
    expect(a.issues).toEqual([]);
  });
  it("accepts a NEAR query with context terms", () =>
    expect(analyze('(juniper OR "juniper roast") NEAR/10 (price OR cost) NOT job').ok).toBe(true));
});

describe("compile to tsquery", () => {
  it("quotes lexemes and lowercases", () => expect(ts("Coffee")).toBe("'coffee'"));
  it("turns phrases into <-> chains", () =>
    expect(ts('"Juniper Roast"')).toBe("'juniper' <-> 'roast'"));
  it("splits hyphenated words", () => expect(ts("juniper-roast")).toBe("'juniper' <-> 'roast'"));
  it("uses :* for trailing wildcards", () => expect(ts("run*")).toBe("'run':*"));
  it("keeps accents", () => expect(ts("déçu")).toBe("'déçu'"));
  it("combines AND, OR and NOT", () =>
    expect(ts("(a OR b) c NOT d")).toBe("(('a' | 'b') & 'c' & !('d'))"));
  it("expands NEAR/n into 2n alternatives", () =>
    expect((ts("a NEAR/2 b")!.match(/<\d>/g) ?? []).length).toBe(4));
  it("expands ordered NEAR/nf into n alternatives", () =>
    expect((ts("a NEAR/3f b")!.match(/<\d>/g) ?? []).length).toBe(3));
  it("escapes quotes in lexemes", () => expect(ts("o'brien")).toBe("'o' <-> 'brien'"));
});

describe("compile to SQL", () => {
  const q = (s: string) => dialect.sqlToQuery(compile(p(s)));
  it("collapses text-only queries into a single tsquery parameter", () => {
    const r = q("(a OR b) NOT (c OR d)");
    expect(r.sql.match(/to_tsquery/g)).toHaveLength(1);
    expect(r.params).toHaveLength(1);
  });
  it("combines fields and text with AND", () => {
    const r = q("coffee lang:en");
    expect(r.sql).toContain("tsv @@ to_tsquery");
    expect(r.sql).toContain("lang =");
    expect(r.params).toEqual(["'coffee'", "en"]);
  });
  it("requires the # marker literally for hashtags", () => {
    const r = q("#brand");
    expect(r.sql).toContain("~*");
    expect(String(r.params[1])).toContain("#brand");
  });
  it("never inlines user input into SQL text", () => {
    const r = q('author:"x\'; DROP TABLE mentions;--"');
    expect(r.sql).not.toContain("DROP");
    expect(r.params).toContain("x'; drop table mentions;--");
  });
  it("builds filter predicates", () => {
    expect(dialect.sqlToQuery(compileFilters({})).sql).toBe("TRUE");
    const r = dialect.sqlToQuery(compileFilters({ languages: ["en", "pt"], countries: ["us"] }));
    expect(r.params).toEqual(["en", "pt", "US"]);
  });
});

import { compileGuided, emptyGuided, serializeTerm, toGuided, type Guided } from "./guided";

describe("guided builder <-> Boolean", () => {
  const g = (p: Partial<Guided>): Guided => ({ ...emptyGuided(), ...p });
  it("quotes multi-word chips and keeps hashtags bare", () => {
    expect(serializeTerm("Juniper Roast")).toBe('"Juniper Roast"');
    expect(serializeTerm("#juniper")).toBe("#juniper");
    expect(serializeTerm("run*")).toBe("run*");
    expect(serializeTerm("OR")).toBe('"OR"');
    expect(serializeTerm('say "hi"')).toBe('"say hi"');
  });
  it("compiles include + exclude", () => {
    expect(
      compileGuided(g({ any: ["Juniper Roast", "#juniper"], exclude: ["job", "hiring"] })),
    ).toBe('("Juniper Roast" OR #juniper) NOT (job OR hiring)');
  });
  it("compiles NEAR and AND groups", () => {
    expect(compileGuided(g({ any: ["juniper"], also: ["price", "cost"], within: 10 }))).toBe(
      "juniper NEAR/10 (price OR cost)",
    );
    expect(compileGuided(g({ any: ["juniper"], also: ["price"] }))).toBe("juniper AND price");
  });
  it("returns an empty string until something is included", () =>
    expect(compileGuided(g({ exclude: ["job"] }))).toBe(""));
  it("round-trips through the parser", () => {
    for (const form of [
      g({ any: ["Juniper Roast", "#juniper"], exclude: ["job"] }),
      g({ any: ["a1", "b2"], also: ["c3"], within: 5, exclude: ["x1", "y2"] }),
      g({ any: ["run*"], also: ["fast"] }),
    ]) {
      const text = compileGuided(form);
      const back = toGuided(analyze(text).ast!);
      expect(back, text).toEqual(form);
    }
  });
  it("refuses to convert queries the form can't express", () => {
    for (const q of [
      "coffee lang:en",
      "(a1 OR (b2 c3)) d4",
      "a1 NEAR/3f b2",
      "a1 OR b2 NOT c3 lang:es",
      "a1 b2 c3",
    ])
      expect(toGuided(analyze(q).ast!), q).toBeNull();
  });
});
