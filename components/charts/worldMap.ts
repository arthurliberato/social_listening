"use client";

import { BarChart, HeatmapChart, LineChart, MapChart, PieChart } from "echarts/charts";
import {
  GraphicComponent,
  GridComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  MapChart,
  PieChart,
  GraphicComponent,
  GridComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
  SVGRenderer,
]);
export { echarts };

// ISO 3166-1 numeric -> alpha-2 for the countries the corpus covers (the map data keys countries by numeric id).
const ISO: Record<string, string> = {
  "840": "US",
  "826": "GB",
  "124": "CA",
  "036": "AU",
  "356": "IN",
  "076": "BR",
  "620": "PT",
  "484": "MX",
  "724": "ES",
  "032": "AR",
  "250": "FR",
  "276": "DE",
  "380": "IT",
};

let ready: Promise<void> | null = null;

/** Load and register the world map once, on first use (about 100 KB, only fetched by Map widgets). */
export function ensureWorldMap(): Promise<void> {
  ready ??= (async () => {
    const [topo, { feature }] = await Promise.all([
      import("world-atlas/countries-110m.json"),
      import("topojson-client"),
    ]);
    const t = (topo as unknown as { default: { objects: { countries: unknown } } }).default;
    const geo = feature(t as never, t.objects.countries as never) as unknown as {
      features: { id?: string; properties: Record<string, unknown> }[];
    };
    geo.features = geo.features.filter((f) => f.id !== "010"); // no Antarctica: wasted space
    for (const f of geo.features)
      f.properties.iso2 = ISO[String(f.id).padStart(3, "0")] ?? `x-${f.id}`;
    echarts.registerMap("world", geo as never);
  })();
  return ready;
}
