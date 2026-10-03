"use client";

import {
  autocompletion,
  closeBrackets,
  completionKeymap,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  syntaxHighlighting,
} from "@codemirror/language";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import type { Issue } from "@/lib/query/lint";

const booleanLanguage = StreamLanguage.define<null>({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match("<<<")) {
      while (!stream.eol() && !stream.match(">>>")) stream.next();
      return "comment";
    }
    if (stream.peek() === '"') {
      stream.next();
      while (!stream.eol() && stream.next() !== '"') {
        /* consume phrase */
      }
      return "string";
    }
    if (stream.match(/NEAR\/\d+f?(?![^\s()":*#@])/) || stream.match(/(AND|OR|NOT)(?![^\s()":*#@])/))
      return "keyword";
    if (stream.match(/[a-z]+:/)) return "propertyName";
    if (stream.match(/[#@][^\s()":*#@]+/)) return "atom";
    if (stream.eat(/[()]/)) return "bracket";
    if (stream.match(/[^\s()":*#@]+\*?/)) return "variableName";
    stream.next();
    return null;
  },
});

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--primary)", fontWeight: "600" },
  { tag: tags.string, color: "var(--success)" },
  { tag: tags.comment, color: "var(--text-muted)", fontStyle: "italic" },
  { tag: tags.propertyName, color: "var(--info)" },
  { tag: tags.atom, color: "var(--warning)" },
]);

const theme = EditorView.theme({
  "&": {
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-input)",
    minHeight: "140px",
  },
  "&.cm-focused": { outline: "2px solid var(--focus-ring)", outlineOffset: "2px" },
  ".cm-content": {
    fontFamily: "JetBrains Mono, ui-monospace, monospace",
    fontSize: "13px",
    caretColor: "var(--text)",
    padding: "8px 0",
  },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-matchingBracket": {
    backgroundColor: "var(--surface-2)",
    outline: "1px solid var(--primary)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--primary)",
    color: "var(--primary-contrast)",
  },
});

const OPERATORS = [
  { label: "AND", detail: "both must match" },
  { label: "OR", detail: "either may match" },
  { label: "NOT", detail: "exclude mentions containing…" },
  { label: "NEAR/5", detail: "within 5 words, any order" },
  { label: "NEAR/5f", detail: "within 5 words, in this order" },
  { label: "author:", detail: "posts by a handle" },
  { label: "site:", detail: "posts from a domain" },
  { label: "source:", detail: "x, reddit, news, review…" },
  { label: "lang:", detail: "language code, e.g. en" },
  { label: "country:", detail: "country code, e.g. US" },
  { label: "hashtag:", detail: "exact #hashtag" },
  { label: "logo:", detail: "brand logo in an image (Enterprise)" },
  { label: "<<<note>>>", detail: "comment, ignored by search" },
].map((o) => ({ ...o, type: o.label.endsWith(":") ? "property" : "keyword" }));

function complete(ctx: CompletionContext) {
  const w = ctx.matchBefore(/[A-Za-z<>/]*[A-Za-z]$|<{1,3}$/);
  if (!w && !ctx.explicit) return null;
  return { from: w ? w.from : ctx.pos, options: OPERATORS, validFor: /^[A-Za-z/<>:]*$/ };
}

function toDiagnostics(issues: Issue[], len: number): Diagnostic[] {
  return issues.map((i) => {
    const to = Math.min(Math.max(i.end, i.start), len);
    const from = Math.min(i.start, to);
    return {
      from: from === to && from > 0 ? from - 1 : from,
      to,
      severity: i.severity,
      message: i.message,
    };
  });
}

export function BooleanEditor({
  value,
  onChange,
  issues,
  onSave,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  issues: Issue[];
  onSave?: () => void;
  readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onSave });
  cb.current = { onChange, onSave };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          closeBrackets(),
          bracketMatching(),
          booleanLanguage,
          syntaxHighlighting(highlight),
          theme,
          EditorView.lineWrapping,
          autocompletion({ override: [complete] }),
          placeholder('("Your Brand" OR #yourbrand) NOT (job OR hiring)'),
          EditorState.readOnly.of(!!readOnly),
          EditorView.contentAttributes.of({
            "aria-label": "Boolean query",
            "aria-multiline": "true",
            role: "textbox",
            "data-testid": "advanced-editor-content",
          }),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                cb.current.onSave?.();
                return true;
              },
            },
            ...completionKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // External changes (e.g. switching from guided mode) flow in without echoing back.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value)
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (v) v.dispatch(setDiagnostics(v.state, toDiagnostics(issues, v.state.doc.length)));
  }, [issues, value]);

  return <div ref={host} data-testid="advanced-editor" className="text-sm" />;
}
