// Runs the data-viz palette validator over the chart tokens in styles/tokens.css, in both themes.
// Fails (exit 1) if the categorical series or the sentiment colours stop passing the hard gates.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const css = readFileSync("styles/tokens.css", "utf8");
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]),
  );
};
const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };

const SURFACE = { light: "#ffffff", dark: "#161b22" } as const; // --surface in tokens.css
const pick = (t: Record<string, string>, keys: string[]) => keys.map((k) => t[k]!).join(",");
const series = Array.from({ length: 8 }, (_, i) => `series-${i + 1}`);

const runs: { name: string; palette: string; mode: "light" | "dark"; extra?: string[] }[] = [];
for (const mode of ["light", "dark"] as const) {
  const t = mode === "light" ? light : dark;
  runs.push({ name: `series (8, adjacent pairs)`, palette: pick(t, series), mode });
  // Scatter / map / small-multiple forms are capped at three series: those must clear every pair.
  runs.push({
    name: `series (first 3, all pairs)`,
    palette: pick(t, series.slice(0, 3)),
    mode,
    extra: ["--pairs", "all"],
  });
  runs.push({
    name: `sentiment (positive, negative, mixed)`,
    palette: pick(t, ["sentiment-positive", "sentiment-negative", "sentiment-mixed"]),
    mode,
  });
}

let failed = 0;
for (const r of runs) {
  const res = spawnSync(
    "node",
    [
      "scripts/vendor/validate_palette.js",
      r.palette,
      "--mode",
      r.mode,
      "--surface",
      SURFACE[r.mode],
      ...(r.extra ?? []),
    ],
    { encoding: "utf8" },
  );
  const ok = res.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${r.mode.padEnd(5)} ${r.name}`);
  if (!ok) console.log(res.stdout);
}
process.exit(failed ? 1 : 0);
