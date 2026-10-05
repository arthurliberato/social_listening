import Link from "next/link";
import { AddToReportButton } from "@/components/reports/AddToReportDialog";
import { RangeForm } from "@/components/insights/RangeForm";
import { TopicLink } from "@/components/insights/Track";
import { requireWorkspace } from "@/lib/auth/session";
import { compact } from "@/lib/format";
import { mentionsHref } from "@/lib/insights/links";
import { topicStats } from "@/lib/insights/service";
import { workspaceQueries } from "@/lib/mentions/feed";
import { parseFilters } from "@/lib/mentions/filters";
import { accountPlan, canEdit } from "@/lib/queries";

export const metadata = { title: "Topics & Trends · Ripplewise" };
export const dynamic = "force-dynamic";

const RISING_PCT = 50;
const RISING_MIN = 20;

export default async function TopicsPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ws: slug } = await params;
  const { ws } = await requireWorkspace(slug);
  const { plan } = await accountPlan(ws.id);
  const filters = parseFilters(await searchParams);
  const [data, qs] = await Promise.all([
    topicStats({ workspaceId: ws.id, filters, historyDays: plan.historyDays }),
    workspaceQueries(ws.id),
  ]);
  const max = Math.max(1, ...data.rows.map((r) => r.mentions));
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[30px] font-semibold leading-[38px]">Topics &amp; Trends</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        What people are talking about, and what is growing compared with the period before.
      </p>
      <div className="mt-5">
        <RangeForm range={filters.range} q={filters.q} queries={qs} />
      </div>
      {canEdit(ws.role) && data.rows.length > 0 && (
        <div className="mt-4">
          <AddToReportButton
            ws={slug}
            source="topics"
            draft={{
              type: "topic_cloud",
              title: "Topics",
              config: filters.q ? { queryId: filters.q } : {},
            }}
          />
        </div>
      )}
      {!data.hasQueries ? (
        <p
          className="mt-8 rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
          data-testid="topics-no-queries"
        >
          Topics come from your queries.{" "}
          <Link href={`/w/${slug}/queries/new`} className="text-[var(--primary)] underline">
            Create a query
          </Link>{" "}
          to start collecting.
        </p>
      ) : data.rows.length === 0 ? (
        <p
          className="mt-8 rounded-lg border border-dashed border-[var(--border)] p-8 text-center text-[var(--text-muted)]"
          data-testid="topics-empty"
        >
          No topics in this period. Try a longer period or another query.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="topics-table">
            <caption className="sr-only">
              Topics ranked by mentions, with change versus the previous period
            </caption>
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                {["Topic", "Mentions", "Change", "Negative", "Est. reach"].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const rising =
                  r.growthPct !== null && r.growthPct >= RISING_PCT && r.mentions >= RISING_MIN;
                return (
                  <tr
                    key={r.topic}
                    className="border-b border-[var(--border)]"
                    data-testid="topic-row"
                    data-rising={rising}
                  >
                    <th scope="row" className="px-2 py-2 font-normal">
                      <TopicLink
                        href={mentionsHref(slug, filters, { topic: r.topic })}
                        growthPct={r.growthPct}
                      >
                        {r.topic}
                      </TopicLink>
                      {rising && (
                        <span
                          className="ml-2 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs"
                          data-testid="rising"
                        >
                          Rising
                        </span>
                      )}
                    </th>
                    <td className="px-2 py-2">
                      <span className="tabular-nums">{r.mentions.toLocaleString("en-US")}</span>
                      <span
                        aria-hidden
                        className="mt-1 block h-1.5 rounded bg-[var(--primary)]"
                        style={{
                          width: `${Math.max(3, (r.mentions / max) * 100)}%`,
                          maxWidth: 160,
                        }}
                      />
                    </td>
                    <td className="px-2 py-2 tabular-nums" data-testid="topic-change">
                      {r.growthPct === null
                        ? "New"
                        : r.growthPct === 0
                          ? "No change"
                          : `${r.growthPct > 0 ? "▲ up" : "▼ down"} ${Math.abs(r.growthPct)}%`}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{Math.round(r.negativeShare * 100)}%</td>
                    <td className="px-2 py-2 tabular-nums">{compact(r.reach)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
