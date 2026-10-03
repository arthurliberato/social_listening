import { csvCell } from "@/lib/csv";
import type { TableModel } from "@/lib/charts/tables";

export interface CsvSection {
  title: string;
  table: TableModel | null;
}

/** All of a report's tables in one file: a title row, the header, the rows, then a blank line. */
export function reportCsv(title: string, period: string, sections: CsvSection[]): string {
  const lines = [
    [csvCell("Report"), csvCell(title)].join(","),
    [csvCell("Period"), csvCell(period)].join(","),
    "",
  ];
  for (const s of sections) {
    lines.push([csvCell("Section"), csvCell(s.title)].join(","));
    if (!s.table) {
      lines.push(csvCell("(this section could not be loaded)"), "");
      continue;
    }
    lines.push(s.table.columns.map(csvCell).join(","));
    for (const r of s.table.rows) lines.push(r.map(csvCell).join(","));
    lines.push("");
  }
  return lines.join("\n");
}
