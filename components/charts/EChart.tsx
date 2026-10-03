"use client";

import type { EChartsOption } from "echarts";
import { useEffect, useRef } from "react";
import { echarts } from "./worldMap";

export interface PickEvent {
  name?: string;
  seriesName?: string;
  data?: { key?: string };
  dataIndex?: number;
}

/**
 * Thin ECharts host: SVG renderer, resizes with its container, disposes on unmount.
 * Charts are not keyboard-navigable, so every chart's numbers are also reachable through its table view.
 */
export function EChart({
  option,
  height,
  label,
  onPick,
  onAxisPick,
  testId,
}: {
  option: EChartsOption;
  height: number;
  label: string;
  testId?: string;
  onPick?: (e: PickEvent) => void;
  onAxisPick?: (index: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null);
  const handlers = useRef({ onPick, onAxisPick });
  handlers.current = { onPick, onAxisPick };

  useEffect(() => {
    const c = echarts.init(host.current!, undefined, { renderer: "svg" });
    chart.current = c;
    c.on("click", (p) => handlers.current.onPick?.(p as unknown as PickEvent));
    c.getZr().on("click", (e) => {
      if (!handlers.current.onAxisPick) return;
      const pt: [number, number] = [e.offsetX, e.offsetY];
      if (c.containPixel("grid", pt))
        handlers.current.onAxisPick(
          Math.round((c.convertFromPixel({ xAxisIndex: 0 }, pt) as number[])[0]!),
        );
    });
    c.on("finished", () => host.current?.setAttribute("data-ready", "true"));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(host.current!);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={host}
      role="img"
      aria-label={label}
      data-testid={testId ?? "chart"}
      style={{ height, width: "100%", cursor: onPick || onAxisPick ? "pointer" : "default" }}
    />
  );
}
