import Link from "next/link";
import { TemplatePicker } from "@/components/reports/TemplatePicker";
import { requireWorkspace } from "@/lib/auth/session";
import { canEdit } from "@/lib/queries";
import { REPORT_TEMPLATES } from "@/lib/reports/templates";

export const metadata = { title: "New report · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function NewReportPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const { ws } = await requireWorkspace(slug);
  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/w/${slug}/reports`}
        className="text-sm text-[var(--primary)] underline underline-offset-2"
      >
        ← Back to reports
      </Link>
      <h1 className="text-[30px] font-semibold leading-[38px]">New report</h1>
      {canEdit(ws.role) ? (
        <>
          <p className="mt-1 text-[var(--text-muted)]">
            Pick a starting point. You can change everything afterwards.
          </p>
          <div className="mt-6">
            <TemplatePicker ws={slug} templates={REPORT_TEMPLATES} />
          </div>
        </>
      ) : (
        <p className="mt-3 text-[var(--text-muted)]" data-testid="report-permission">
          Your role can read and export reports but not create them. Ask a workspace admin for
          editor access.
        </p>
      )}
    </div>
  );
}
