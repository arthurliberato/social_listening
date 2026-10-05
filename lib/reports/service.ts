// Running a report: every section is a widget, loaded independently so one failure never sinks the rest.
import { eq, sql } from "drizzle-orm";
import { db, reports } from "@/db/client";
import { summarize, toTable, type TableModel } from "@/lib/charts/tables";
import { runWidget } from "@/lib/dashboards/service";
import type { WidgetData, WidgetResult } from "@/lib/dashboards/types";
import { csvCell } from "@/lib/csv";
import { reportCsv } from "./csv";
import type { PdfSection } from "./pdf";
import {
  MAX_SECTIONS,
  RANGE_LABEL,
  rangeParam,
  SectionsSchema,
  type ReportRange,
  type Section,
} from "./types";

export type ReportRow = typeof reports.$inferSelect;
export interface LoadedSection {
  section: Section;
  result: WidgetResult;
}

export const sectionsOf = (r: ReportRow): Section[] => {
  const p = SectionsSchema.safeParse(r.sections);
  return p.success ? p.data : [];
};

export async function loadReportSections(
  workspaceId: string,
  r: ReportRow,
): Promise<LoadedSection[]> {
  return Promise.all(
    sectionsOf(r).map(async (section) => ({
      section,
      result: await runWidget(workspaceId, section.type, section.config, rangeParam(r.range)),
    })),
  );
}

export const periodLabel = (r: ReportRow, loaded: LoadedSection[]) => {
  const first = loaded.find((l) => l.result.ok);
  if (first?.result.ok) {
    const p = first.result.payload.period;
    return `${p.from.slice(0, 10)} to ${p.to.slice(0, 10)} (${RANGE_LABEL[r.range as ReportRange] ?? r.range})`;
  }
  return RANGE_LABEL[r.range as ReportRange] ?? r.range;
};

function barsOf(d: WidgetData): PdfSection["bars"] {
  switch (d.kind) {
    case "volume":
      return d.days.map((p) => ({ label: p.day, value: p.value }));
    case "sentiment_donut":
      return d.parts.map((p) => ({ label: p.sentiment, value: p.count }));
    case "bar":
      return d.rows.slice(0, 12).map((r) => ({ label: r.label, value: r.count }));
    default:
      return undefined;
  }
}

export function pdfSections(loaded: LoadedSection[]): PdfSection[] {
  return loaded.map(({ section, result }) =>
    result.ok
      ? {
          title: section.title,
          summary: summarize(result.payload.data, result.payload.period),
          table: toTable(result.payload.data),
          bars: barsOf(result.payload.data),
        }
      : { title: section.title, summary: "", table: null, error: result.error },
  );
}

export function csvOf(r: ReportRow, loaded: LoadedSection[]): string {
  return reportCsv(
    r.name,
    periodLabel(r, loaded),
    loaded.map(({ section, result }) => ({
      title: section.title,
      table: result.ok ? (toTable(result.payload.data) as TableModel) : null,
    })),
  );
}

export const filenameOf = (name: string, ext: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "report"
  }.${ext}`;

export async function getReport(workspaceId: string, id: string): Promise<ReportRow | undefined> {
  const [r] = await db.select().from(reports).where(eq(reports.id, id));
  return r && r.workspaceId === workspaceId ? r : undefined;
}

export { csvCell };

/**
 * Append a section to a report's end in one statement, so two people adding at once keep both and the
 * section limit can't be overshot. Returns null when the report isn't in this workspace or is full.
 */
export async function appendSection(
  workspaceId: string,
  reportId: string,
  section: Section,
): Promise<{ name: string; sections: number } | null> {
  const res = await db.execute(sql`
    UPDATE reports
    SET sections = sections || ${JSON.stringify([section])}::jsonb, updated_at = now()
    WHERE id = ${reportId}::uuid AND workspace_id = ${workspaceId}::uuid
      AND jsonb_array_length(sections) < ${MAX_SECTIONS}
    RETURNING name, jsonb_array_length(sections) AS n`);
  const row = res.rows[0] as { name: string; n: number } | undefined;
  return row ? { name: row.name, sections: Number(row.n) } : null;
}
