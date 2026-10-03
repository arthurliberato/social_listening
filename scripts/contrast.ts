// Checks WCAG contrast for token pairs in styles/tokens.css (light + dark).
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing block ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]!] = m[2]!;
  return out;
}

const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground, background, minimum ratio]
const PAIRS: [string, string, number][] = [
  ["text", "bg", 4.5],
  ["text", "surface", 4.5],
  ["text", "surface-2", 4.5],
  ["text-muted", "bg", 4.5],
  ["text-muted", "surface", 4.5],
  ["text-muted", "surface-2", 4.5],
  ["primary-contrast", "primary", 4.5],
  ["primary", "surface", 4.5],
  ["success", "surface", 4.5],
  ["warning", "surface", 4.5],
  ["danger", "surface", 4.5],
  ["info", "surface", 4.5],
  ["focus-ring", "surface", 3],
  ["focus-ring", "bg", 3],
  ["sentiment-positive", "surface", 3],
  ["sentiment-negative", "surface", 3],
  ["sentiment-neutral", "surface", 3],
  ["border", "surface", 1], // decorative; reported only
];

let failed = 0;
for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
  for (const [fg, bg, min] of PAIRS) {
    const r = ratio(theme[fg]!, theme[bg]!);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`);
  }
}
process.exit(failed ? 1 : 0);
