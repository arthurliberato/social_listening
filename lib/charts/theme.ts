"use client";

import { useEffect, useState } from "react";

export interface ChartTheme {
  text: string;
  muted: string;
  surface: string;
  border: string;
  grid: string;
  axis: string;
  primary: string;
  spike: string;
  series: string[];
  sentiment: Record<"positive" | "neutral" | "negative" | "mixed", string>;
  ramp: string[];
  reducedMotion: boolean;
}

const v = (cs: CSSStyleDeclaration, name: string, fallback: string) =>
  cs.getPropertyValue(name).trim() || fallback;

/** Resolve the design tokens for the current theme (ECharts needs concrete colours, not CSS variables). */
export function readChartTheme(): ChartTheme {
  const cs = getComputedStyle(document.documentElement);
  return {
    text: v(cs, "--text", "#111827"),
    muted: v(cs, "--text-muted", "#5b6472"),
    surface: v(cs, "--surface", "#ffffff"),
    border: v(cs, "--border", "#e2e5ea"),
    grid: v(cs, "--chart-grid", "#e1e0d9"),
    axis: v(cs, "--chart-axis", "#c3c2b7"),
    primary: v(cs, "--primary", "#4f46e5"),
    spike: v(cs, "--spike", "#e69f00"),
    series: Array.from({ length: 8 }, (_, i) => v(cs, `--series-${i + 1}`, "#2a78d6")),
    sentiment: {
      positive: v(cs, "--sentiment-positive", "#0072b2"),
      neutral: v(cs, "--sentiment-neutral", "#8a94a3"),
      negative: v(cs, "--sentiment-negative", "#d55e00"),
      mixed: v(cs, "--sentiment-mixed", "#cc79a7"),
    },
    ramp: Array.from({ length: 7 }, (_, i) => v(cs, `--ramp-${i + 1}`, "#3987e5")),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

/** Current chart colours; re-reads them whenever the theme toggles or the OS scheme changes. */
export function useChartTheme(): ChartTheme | null {
  const [theme, setTheme] = useState<ChartTheme | null>(null);
  useEffect(() => {
    const sync = () => setTheme(readChartTheme());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", sync);
    };
  }, []);
  return theme;
}
