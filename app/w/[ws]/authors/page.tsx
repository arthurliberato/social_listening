import Link from "next/link";
import { RangeForm } from "@/components/insights/RangeForm";
import { WatchButton } from "@/components/insights/WatchButton";
import { requireWorkspace } from "@/lib/auth/session";
import { compact } from "@/lib/format";
import { AUTHOR_SORTS, topAuthors, type AuthorSort } from "@/lib/insights/service";
import { mentionsHref } from "@/lib/insights/links";
import { parseFilters } from "@/lib/mentions/filters";
import { accountPlan, canEdit } from "@/lib/queries";
import { workspaceQueries } from "@/lib/mentions/feed";

export const metadata = { title: "Authors · Ripplewise" };
export const dynamic = "force-dynamic";

const SORT_LABEL: Record<AuthorSort, string> = {
  reach: "Estimated reach",
  mentions: "Mentions",
  negative: "Negative mentions",
};

export default async function AuthorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ws: slug } = await params;
  const sp = await searchParams;
  const { ws } = await requireWorkspace(slug);
  const { plan } = await accountPlan(ws.id);
  const filters = parseFilters(sp);
  const by = (AUTHOR_SORTS as string[]).includes(String(sp.by)) ? (sp.by as AuthorSort) : "reach";
  const watchedOnly = sp.watch === "1";
  const [data, qs] = await Promise.all([
    topAuthors({
      workspaceId: ws.id,
      filters,
      historyDays: plan.historyDays,
      sort: by,
      watchedOnly,
    }),
    workspaceQueries(ws.id),
  ]);
  const editable = canEdit(ws.role);
  const sel =
    "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm";
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-[30px] font-semibold leading-[38px]">Authors</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        The people and accounts behind your mentions. Likely spam is left out.
      </p>
      <div className="mt-5">
        <RangeForm
          range={filters.range}
          q={filters.q}
          queries={qs}
          extra={
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor="f-by" className="text-xs text-[var(--text-muted)]">
                  Rank by
                </label>
                <select id="f-by" name="by" defaultValue={by} className={sel}>
                  {AUTHOR_SORTS.map((s) => (
                    <option key={s} value={s}>
                      {SORT_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <label className="inline-flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" name="watch" value="1" defaultChecked={watchedOnly} />
                Watchlist only
              </label>
            </>
          }
        />
      </div>

      {!data.hasQueries ? (
        <p
          className="mt-8 rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
          data-testid="authors-no-queries"
        >
          Authors come from your queries.{" "}
          <Link href={`/w/${slug}/queries/new`} className="text-[var(--primary)] underline">
            Create a query
          </Link>{" "}
          to start collecting.
        </p>
      ) : data.rows.length === 0 ? (
        <p
          className="mt-8 rounded-lg border border-dashed border-[var(--border)] p-8 text-center text-[var(--text-muted)]"
          data-testid="authors-empty"
        >
          {watchedOnly
            ? "No watched authors have posted in this period. Watch an author from the full list to keep an eye on them here."
            : "No authors in this period. Try a longer period or another query."}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="authors-table">
            <caption className="sr-only">Authors ranked by {SORT_LABEL[by].toLowerCase()}</caption>
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                {[
                  "Author",
                  "Type",
                  "Followers",
                  "Mentions",
                  "Negative",
                  "Est. reach",
                  "Watchlist",
                ].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((a) => (
                <tr key={a.id} className="border-b border-[var(--border)]" data-testid="author-row">
                  <th scope="row" className="px-2 py-2 font-normal">
                    <Link
                      href={`/w/${slug}/authors/${a.id}?range=${filters.range}${filters.q ? `&q=${filters.q}` : ""}`}
                      className="font-medium text-[var(--primary)] underline underline-offset-2"
                      data-testid="author-link"
                    >
                      {a.name}
                    </Link>
                    {a.verified && (
                      <span className="ml-1 text-xs text-[var(--text-muted)]">(verified)</span>
                    )}
                    <div className="text-xs text-[var(--text-muted)]">
                      @{a.handle} · {a.source}
                    </div>
                  </th>
                  <td className="px-2 py-2 capitalize">{a.type}</td>
                  <td className="px-2 py-2 tabular-nums">{compact(a.followers)}</td>
                  <td className="px-2 py-2 tabular-nums">
                    <Link
                      href={mentionsHref(slug, filters, { author: a.handle })}
                      className="underline underline-offset-2"
                    >
                      {a.mentions.toLocaleString("en-US")}
                    </Link>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{a.negative.toLocaleString("en-US")}</td>
                  <td className="px-2 py-2 tabular-nums">{compact(a.reach)}</td>
                  <td className="px-2 py-2">
                    <WatchButton
                      ws={slug}
                      authorId={a.id}
                      name={a.name}
                      watched={a.watched}
                      canEdit={editable}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
