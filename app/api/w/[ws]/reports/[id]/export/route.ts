import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, exportsLog } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { userWorkspaces } from "@/lib/auth/session";
import { renderReportPdf } from "@/lib/reports/pdf";
import {
  csvOf,
  filenameOf,
  getReport,
  loadReportSections,
  pdfSections,
  periodLabel,
} from "@/lib/reports/service";
import { toTable } from "@/lib/charts/tables";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Download a report as PDF or CSV. Members can export; client viewers cannot. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ ws: string; id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  const { ws: slug, id } = await params;
  const ws = (await userWorkspaces(session.user.id)).find((w) => w.slug === slug);
  if (!ws) return new NextResponse("Forbidden", { status: 403 });
  if (ws.role === "client_viewer")
    return new NextResponse("Your role can't export", { status: 403 });
  const format = new URL(req.url).searchParams.get("format");
  if (format !== "pdf" && format !== "csv")
    return new NextResponse("format must be pdf or csv", { status: 400 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const report = await getReport(ws.id, id);
  if (!report) return new NextResponse("Not found", { status: 404 });

  const loaded = await loadReportSections(ws.id, report);
  const rowCount = loaded.reduce(
    (n, l) => n + (l.result.ok ? toTable(l.result.payload.data).rows.length : 0),
    0,
  );
  let body: Buffer | string;
  if (format === "csv") body = csvOf(report, loaded);
  else
    body = await renderReportPdf({
      title: report.name,
      workspace: ws.name,
      period: periodLabel(report, loaded),
      generatedAt: new Date(),
      sections: pdfSections(loaded),
    });

  await db.insert(exportsLog).values({
    workspaceId: ws.id,
    userId: session.user.id,
    kind: "report",
    format,
    label: report.name,
    rowCount,
  });
  await trackServer(
    "Export Downloaded",
    { userId: session.user.id, workspaceId: ws.id },
    { format, row_count: rowCount },
  );
  return new NextResponse(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
      "content-disposition": `attachment; filename="${filenameOf(report.name, format)}"`,
      "cache-control": "no-store",
    },
  });
}
