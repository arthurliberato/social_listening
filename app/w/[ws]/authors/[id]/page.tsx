import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthorViewed } from "@/components/insights/Track";
import { WatchButton } from "@/components/insights/WatchButton";
import { requireWorkspace } from "@/lib/auth/session";
import { absoluteTime, compact } from "@/lib/format";
import { authorProfile } from "@/lib/insights/service";
import { mentionsHref } from "@/lib/insights/links";
import { parseFilters } from "@/lib/mentions/filters";
import { accountPlan, canEdit } from "@/lib/queries";

export const metadata = { title: "Author · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function AuthorPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ws: slug, id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const { ws } = await requireWorkspace(slug);
  const { plan } = await accountPlan(ws.id);
  const filters = parseFilters(await searchParams);
  const p = await authorProfile({
    workspaceId: ws.id,
    authorId: Number(id),
    filters: { ...filters, range: filters.range === "30d" ? "90d" : filters.range },
    historyDays: plan.historyDays,
  });
  if (!p) notFound();
  const a = p.author;
  const range = filters.range === "30d" ? "90d" : filters.range;
  return (
    <div className="mx-auto max-w-4xl">
      <AuthorViewed authorType={a.type} />
      <Link
        href={`/w/${slug}/authors`}
        className="text-sm text-[var(--primary)] underline underline-offset-2"
      >
        ← All authors
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-[30px] font-semibold leading-[38px]" data-testid="author-name">
          {a.name}
        </h1>
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs capitalize">
          {a.type}
        </span>
        <div className="ml-auto">
          <WatchButton
            ws={slug}
            authorId={a.id}
            name={a.name}
            watched={p.watched}
            canEdit={canEdit(ws.role)}
          />
        </div>
      </div>
      <p className="text-sm text-[var(--text-muted)]">
        @{a.handle} on {a.source} · {compact(a.followers)} followers
        {a.verified ? " · verified" : ""} · joined {p.joined}
      </p>
      {p.bio && <p className="mt-3 max-w-prose">{p.bio}</p>}
      <dl className="mt-5 grid gap-3 sm:grid-cols-4" data-testid="author-kpis">
        {[
          ["Mentions", p.total.toLocaleString("en-US")],
          ["Negative", p.total ? `${Math.round((p.negative / p.total) * 100)}%` : "–"],
          ["Positive", p.total ? `${Math.round((p.positive / p.total) * 100)}%` : "–"],
          ["Est. reach", compact(p.reach)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <dt className="text-xs text-[var(--text-muted)]">{k}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <h2 className="mt-6 text-lg font-semibold">Recent mentions</h2>
      {p.recent.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]" data-testid="author-empty">
          None of this author&apos;s mentions match your queries in this period.
        </p>
      ) : (
        <>
          <ul className="mt-2 flex flex-col gap-2" data-testid="author-mentions">
            {p.recent.map((m) => (
              <li
                key={m.id}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
              >
                <p className="line-clamp-3">{m.text}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {absoluteTime(m.publishedAt)} · {m.sentiment} · est. reach {compact(m.reach)} ·{" "}
                  <Link href={`/w/${slug}/mentions?m=${m.id}`} className="underline">
                    Open
                  </Link>
                </p>
              </li>
            ))}
          </ul>
          <Link
            href={mentionsHref(slug, { range, q: filters.q }, { author: a.handle })}
            className="mt-3 inline-block text-sm text-[var(--primary)] underline underline-offset-2"
          >
            See all in Mentions
          </Link>
        </>
      )}
    </div>
  );
}
