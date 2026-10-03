// Report shape shared by the builder UI, the server actions, the PDF/CSV exporters and the scheduler.
import { z } from "zod";
import { WIDGET_TYPES, type WidgetType } from "@/lib/dashboards/catalog";
import { ConfigSchema } from "@/lib/dashboards/service";

export const RANGES = ["7d", "30d", "90d"] as const;
export type ReportRange = (typeof RANGES)[number];
export const RANGE_LABEL: Record<ReportRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

export const SectionSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(WIDGET_TYPES),
  title: z.string().trim().min(1, "Sections need a title").max(80),
  config: ConfigSchema.default({}),
});
export const SectionsSchema = z.array(SectionSchema).max(20, "A report can have up to 20 sections");
export type Section = z.infer<typeof SectionSchema>;
export type { WidgetType };

export const rangeParam = (r: string) =>
  `range=${(RANGES as readonly string[]).includes(r) ? r : "30d"}`;
