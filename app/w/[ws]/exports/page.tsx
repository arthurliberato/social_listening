import { desc, eq } from "drizzle-orm";
import { db, exportsLog, queries, users } from "@/db/client";
import { ExportMentions } from "@/components/reports/ExportMentions";
import { requireWorkspace } from "@/lib/auth/session";
import { relativeTime } from "@/lib/format";

export const metadata = { title: "Exports · Ripplewise" };
export const dynamic = "force-dynamic";

const RANGES = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
];

export default async function ExportsPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const { ws } = await requireWorkspace(slug);
  if (ws.role === "client_viewer")
    return (
      <div className="mx-auto max-w-3xl" data-testid="export-permission">
        <h1 className="text-[30px] font-semibold leading-[38px]">Exports</h1>
        <p className="mt-3 text-[var(--text-muted)]">
          Your role can view this workspace but not download its data. Ask an admin if you need a
          file.
        </p>
      </div>
    );
  const [qs, rows] = await Promise.all([
    db
      .select({ id: queries.id, name: queries.name })
      .from(queries)
      .where(eq(queries.workspaceId, ws.id))
      .orderBy(queries.name),
    db
      .select({ e: exportsLog, who: users.name })
      .from(exportsLog)
      .leftJoin(users, eq(users.id, exportsLog.userId))
      .where(eq(exportsLog.workspaceId, ws.id))
      .orderBy(desc(exportsLog.createdAt))
      .limit(50),
  ]);
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[30px] font-semibold leading-[38px]">Exports</h1>
      <section
        className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
        aria-labelledby="new-export"
      >
        <h2 id="new-export" className="font-semibold">
          Export mentions
        </h2>
        <p className="mb-3 mt-1 text-sm text-[var(--text-muted)]">
          A CSV of mentions with your team&apos;s edits applied. Up to 10,000 rows per file. For
          anything fancier, open the Mentions feed, filter it, and export from there.
        </p>
        {qs.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]" data-testid="export-no-queries">
            Create a query first — there is nothing to export yet.
          </p>
        ) : (
          <ExportMentions ws={slug} queries={qs} ranges={RANGES} />
        )}
      </section>
      <section className="mt-8" aria-labelledby="history">
        <h2 id="history" className="text-lg font-semibold">
          History
        </h2>
        {rows.length === 0 ? (
          <p
            className="mt-2 rounded-lg border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]"
            data-testid="exports-empty"
          >
            Nothing downloaded yet. Files you export from here or from a report show up in this
            list.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-left text-sm" data-testid="export-history">
              <caption className="sr-only">Files downloaded from this workspace</caption>
              <thead className="text-[var(--text-muted)]">
                <tr className="border-b border-[var(--border)]">
                  <th scope="col" className="px-3 py-2 font-medium">
                    What
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Format
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Rows
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    By
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    When
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ e, who }) => (
                  <tr
                    key={e.id}
                    className="border-b border-[var(--border)] last:border-0"
                    data-testid="export-row"
                  >
                    <th scope="row" className="px-3 py-2 font-medium">
                      {e.label}
                      <span className="block text-xs font-normal text-[var(--text-muted)]">
                        {e.kind === "report" ? "Report" : "Mentions"}
                      </span>
                    </th>
                    <td className="px-3 py-2 uppercase">{e.format}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {e.rowCount?.toLocaleString() ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{who ?? "—"}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {relativeTime(e.createdAt.toISOString())}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
