import { and, count, eq, like } from "drizzle-orm";
import Link from "next/link";
import { accounts, db, invitations, memberships, queries } from "@/db/client";
import { TrackHomeView } from "@/components/home/TrackView";
import { HomeOverview } from "@/components/dashboards/HomeOverview";
import { requireWorkspace } from "@/lib/auth/session";
import { estimateMentions } from "@/lib/query/estimate";
import { simNow } from "@/lib/simclock";

export const metadata = { title: "Home · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function Home({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const { ws } = await requireWorkspace(slug);
  const [acct] = await db.select().from(accounts).where(eq(accounts.id, ws.accountId));
  const [{ nq } = { nq: 0 }] = await db
    .select({ nq: count() })
    .from(queries)
    .where(eq(queries.workspaceId, ws.id));
  const [{ nx } = { nx: 0 }] = await db
    .select({ nx: count() })
    .from(queries)
    .where(and(eq(queries.workspaceId, ws.id), like(queries.booleanText, "% NOT %")));
  const [{ ni } = { ni: 0 }] = await db
    .select({ ni: count() })
    .from(invitations)
    .where(eq(invitations.workspaceId, ws.id));
  const [{ nm } = { nm: 0 }] = await db
    .select({ nm: count() })
    .from(memberships)
    .where(eq(memberships.workspaceId, ws.id));
  const firstQuery = (
    await db.select().from(queries).where(eq(queries.workspaceId, ws.id)).limit(1)
  )[0];
  const estimate = firstQuery
    ? await estimateMentions([firstQuery.name.replace(/ \(brand\)$/, "")])
    : null;

  const items = [
    { id: "create_query", label: "Create your first query", done: nq > 0 },
    { id: "refine_query", label: "Refine it with an exclusion", done: nx > 0 },
    { id: "set_alert", label: "Set an alert", done: false },
    { id: "build_dashboard", label: "Build a dashboard", done: false },
    { id: "invite_teammate", label: "Invite a teammate", done: ni > 0 || nm > 1 },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const daysLeft = acct?.trialEndAt
    ? Math.max(0, Math.ceil((acct.trialEndAt.getTime() - simNow().getTime()) / 86_400_000))
    : null;

  return (
    <div className="mx-auto grid max-w-[1600px] gap-6 lg:grid-cols-[1fr_320px]">
      <TrackHomeView />
      <div>
        <h1 className="text-[30px] font-semibold leading-[38px]">Home</h1>
        {acct?.planTier === "trial" && daysLeft !== null && (
          <p
            className="mt-2 rounded-md border border-[var(--info)] p-3 text-sm"
            role="status"
            data-testid="trial-banner"
          >
            Your free trial has{" "}
            <strong>
              {daysLeft} day{daysLeft === 1 ? "" : "s"}
            </strong>{" "}
            left. No credit card on file.
          </p>
        )}
        {firstQuery ? (
          <section
            aria-labelledby="q-h"
            className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <h2 id="q-h" className="font-medium">
              {firstQuery.name}
            </h2>
            <p className="mt-1 font-mono text-sm text-[var(--text-muted)]" data-testid="home-query">
              {firstQuery.booleanText}
            </p>
            <p
              className="mt-3 text-[36px] font-semibold leading-[44px]"
              data-testid="home-mentions"
            >
              {estimate?.toLocaleString()}
            </p>
            <p className="text-sm text-[var(--text-muted)]">mentions in the last 30 days</p>
          </section>
        ) : (
          <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="font-medium">Start listening</h2>
            <p className="mt-1 text-[var(--text-muted)]">
              Create your first query and we&apos;ll pre-fill it with your brand.
            </p>
            <Link href={`/w/${slug}/queries`} className="mt-3 inline-block underline">
              Create a query
            </Link>
          </section>
        )}
        {firstQuery && (
          <div className="mt-6">
            <HomeOverview ws={slug} />
          </div>
        )}
      </div>
      <aside
        aria-labelledby="checklist-h"
        className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
        data-testid="checklist"
      >
        <h2 id="checklist-h" className="font-medium">
          Get set up
        </h2>
        <p className="text-sm text-[var(--text-muted)]" data-testid="checklist-progress">
          {doneCount} of {items.length}
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((i) => (
            <li
              key={i.id}
              className="flex items-center gap-2 text-sm"
              data-checklist-item={i.id}
              data-done={i.done}
            >
              <span aria-hidden>{i.done ? "✓" : "○"}</span>
              <span className={i.done ? "text-[var(--text-muted)] line-through" : ""}>
                {i.label}
              </span>
              <span className="sr-only">{i.done ? "(done)" : "(to do)"}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
