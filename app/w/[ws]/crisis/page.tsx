import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { crises, db, queries } from "@/db/client";
import { StartCrisis } from "@/components/crisis/StartCrisis";
import { requireWorkspace } from "@/lib/auth/session";
import { queriesOf } from "@/lib/alerts/service";
import { planUnlocking, PLANS } from "@/lib/entitlements/plans";
import { relativeTime } from "@/lib/format";
import { accountPlan, canEdit } from "@/lib/queries";

export const metadata = { title: "Crisis Rooms · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function CrisisPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const { ws } = await requireWorkspace(slug);
  const { plan } = await accountPlan(ws.id);
  const h1 = <h1 className="text-[30px] font-semibold leading-[38px]">Crisis Rooms</h1>;

  if (!plan.features.crisisRoom) {
    const to = PLANS[planUnlocking("crisisRoom")];
    return (
      <div className="mx-auto max-w-3xl">
        {h1}
        <section
          className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8"
          data-testid="crisis-locked"
        >
          <h2 className="text-xl font-semibold">A shared room for when things go sideways</h2>
          <p className="mt-2 text-[var(--text-muted)]">
            Crisis Rooms pull a spike&apos;s volume, sentiment, loudest voices and a response plan
            into one place, and let you brief stakeholders without leaving it. They&apos;re part of
            the {to.label} plan and above.
          </p>
          <Link
            href="/upgrade?from=crisis_room"
            className="mt-4 inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
            data-testid="crisis-upgrade"
          >
            See plans
          </Link>
        </section>
      </div>
    );
  }

  const rows = await db
    .select({ c: crises, queryName: queries.name })
    .from(crises)
    .innerJoin(queries, eq(queries.id, crises.queryId))
    .where(eq(crises.workspaceId, ws.id))
    .orderBy(desc(crises.openedAt));
  const qs = canEdit(ws.role) ? await queriesOf(ws.id) : [];

  return (
    <div className="mx-auto max-w-4xl">
      {h1}
      {canEdit(ws.role) && (
        <div className="mt-4">
          <StartCrisis ws={slug} queries={qs.map((q) => ({ id: q.id, name: q.name }))} />
        </div>
      )}
      {rows.length === 0 ? (
        <section
          className="mt-6 rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
          data-testid="crisis-empty"
        >
          <h2 className="text-lg font-semibold">No crisis rooms yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-muted)]">
            When an alert fires you can start a room from it, or open one yourself for any query.
          </p>
        </section>
      ) : (
        <ul className="mt-6 flex flex-col gap-2" data-testid="crisis-list">
          {rows.map(({ c, queryName }) => (
            <li
              key={c.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
              data-testid="crisis-row"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/w/${slug}/crisis/${c.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {c.title}
                </Link>
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                  {c.status === "open" ? "Open" : "Resolved"}
                </span>
                <span className="ml-auto text-xs text-[var(--text-muted)]">
                  Opened {relativeTime(c.openedAt.toISOString())}
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Watching {queryName}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
