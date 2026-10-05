/** One CSV cell. Text that starts with a formula character is prefixed so spreadsheets don't execute it. */
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(columns: string[], rows: (string | number | null)[][]): string {
  return (
    [columns.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n"
  );
}
