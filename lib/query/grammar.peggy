// Boolean query grammar.
//   precedence (tight -> loose): NEAR, NOT (prefix), AND (explicit or implicit), OR
//   operators are UPPERCASE only; lowercase and/or/not are ordinary words (lint warns).
//   <<<comments>>> are ignored. "A NOT B" parses as A AND NOT B.
{{
  const span = (loc) => ({ start: loc.start.offset, end: loc.end.offset });
  const flat = (t, args, loc) => (args.length === 1 ? args[0] : { t, args, ...span(loc) });
}}

Start = _ e:Or _ { return e; }

Or
  = head:And tail:(_ "OR" !WordChar _ @And)* { return flat("or", [head, ...tail], location()); }

And
  = head:Unary tail:(_ ("AND" !WordChar _)? @Unary)* { return flat("and", [head, ...tail], location()); }

Unary
  = "NOT" !WordChar _ arg:Unary { return { t: "not", arg, ...span(location()) }; }
  / Near

Near
  = head:Primary tail:(_ "NEAR" "/" d:Int f:"f"? !WordChar _ r:Primary { return { d, ordered: !!f, r }; })* {
      return tail.reduce(
        (left, x) => ({ t: "near", left, right: x.r, distance: x.d, ordered: x.ordered, start: left.start, end: x.r.end }),
        head
      );
    }

Primary
  = "(" _ e:Or _ ")" { return e; }
  / Phrase
  / Field
  / Hashtag
  / Mention
  / Term

Phrase = '"' chars:$[^"]* '"' { return { t: "phrase", value: chars, ...span(location()) }; }

Field
  = name:$([a-z]+) ":" v:(Phrase / FieldValue) {
      return { t: "field", name, value: typeof v === "string" ? v : v.value, ...span(location()) };
    }

FieldValue = $[^ \t\r\n()":]+

Hashtag = "#" w:$WordChar+ { return { t: "hashtag", value: w, ...span(location()) }; }

Mention = "@" w:$WordChar+ { return { t: "mention", value: w, ...span(location()) }; }

Term
  = !Reserved w:$WordChar+ star:"*"? { return { t: "term", value: w, wildcard: !!star, ...span(location()) }; }

// "NEAR/5" must count as the operator even though "/" is an ordinary word character.
Reserved = ("AND" / "OR" / "NOT") !WordChar / "NEAR" (!WordChar / "/" [0-9])

// Anything but whitespace, parentheses, quotes, and the wildcard/field/tag punctuation.
WordChar = [^ \t\r\n()":*#@]

Int = n:$[0-9]+ { return parseInt(n, 10); }

_ = (Whitespace / Comment)*
Whitespace = [ \t\r\n]
Comment = "<<<" (!">>>" .)* ">>>"
