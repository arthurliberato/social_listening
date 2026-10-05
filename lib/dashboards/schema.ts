// Client-safe widget config schema (no database imports), shared by dashboards and reports.
import { z } from "zod";
import { BREAKDOWNS, KPI_METRICS, VOLUME_METRICS } from "./catalog";

export const ConfigSchema = z
  .object({
    queryId: z.string().uuid().optional(),
    metric: z
      .enum([...new Set([...KPI_METRICS, ...VOLUME_METRICS])] as [string, ...string[]])
      .optional(),
    breakdown: z.enum(BREAKDOWNS).optional(),
    topN: z.number().int().min(3).max(20).optional(),
    style: z.enum(["line", "area"]).optional(),
  })
  .strict();
