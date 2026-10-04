import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  crises,
  crisisTasks,
  crisisUpdates,
  db,
  alertEvents,
  memberships,
  queries,
  users,
} from "@/db/client";
import { HourlyChart } from "@/components/alerts/HourlyChart";
import { CrisisAi } from "@/components/ai/CrisisAi";
import {
  RoomOpened,
  ResolveButton,
  TaskList,
  UpdateComposer,
} from "@/components/crisis/RoomPanels";
import { requireWorkspace } from "@/lib/auth/session";
import { roomStats } from "@/lib/alerts/service";
import { compact, absoluteTime, relativeTime } from "@/lib/format";
import { planUnlocking, PLANS } from "@/lib/entitlements/plans";
import { accountPlan, canEdit } from "@/lib/queries";
import { simNow } from "@/lib/simclock";

export const metadata = { title: "Crisis room · Ripplewise" };
export const dynamic = "force-dynamic";

const MAX_WINDOW_MS = 7 * 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function CrisisRoomPage({
  params,
}: {
  params: Promise<{ ws: string; id: string }>;
}) {
  const { ws: slug, id } = await params;
  const { ws } = await requireWorkspace(slug);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [c] = await db
    .select()
    .from(crises)
    .where(and(eq(crises.id, id), eq(crises.workspaceId, ws.id)));
  if (!c) notFound();
  const { plan } = await accountPlan(ws.id);
  if (!plan.features.crisisRoom)
    return (
      <div className="mx-auto max-w-3xl" data-testid="crisis-locked">
        <h1 className="text-[30px] font-semibold leading-[38px]">{c.title}</h1>
        <p className="mt-3 text-[var(--text-muted)]">
          This room is read-only because Crisis Rooms are no longer part of your plan. They return
          on the {PLANS[planUnlocking("crisisRoom")].label} plan and above.
        </p>
        <Link
          href="/upgrade?from=crisis_room"
          className="mt-4 inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
        >
          See plans
        </Link>
      </div>
    );

  const [q] = await db.select().from(queries).where(eq(queries.id, c.queryId));
  const [fired] = c.alertEventId
    ? await db.select().from(alertEvents).where(eq(alertEvents.id, c.alertEventId))
    : [];
  const end = new Date(
    Math.min((q!.releasedThrough ?? simNow()).getTime(), c.windowStart.getTime() + MAX_WINDOW_MS),
  );
  const stats = await roomStats({
    workspaceId: ws.id,
    queryId: q!.id,
    from: c.windowStart,
    to: end,
  });
  const negShare = stats.total ? stats.negative / stats.total : 0;

  const [tasks, updates, members] = await Promise.all([
    db
      .select({ t: crisisTasks, assignee: users.name })
      .from(crisisTasks)
      .leftJoin(users, eq(users.id, crisisTasks.assigneeId))
      .where(eq(crisisTasks.crisisId, id))
      .orderBy(asc(crisisTasks.createdAt)),
    db
      .select()
      .from(crisisUpdates)
      .where(eq(crisisUpdates.crisisId, id))
      .orderBy(asc(crisisUpdates.sentAt)),
    db
      .select({ id: users.id, name: users.name, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, ws.id))
      .orderBy(users.name),
  ]);
  const editable = canEdit(ws.role);
  const openTasks = tasks.filter((t) => !t.t.doneAt);
  const top = stats.topMentions[0];
  const draftBody = [
    `Here is where we stand on "${q!.name}" as of ${absoluteTime(end.toISOString())} (UTC window starting ${absoluteTime(c.windowStart.toISOString())}).`,
    ``,
    `- ${stats.total.toLocaleString("en-US")} mentions, ${Math.round(negShare * 100)}% negative`,
    `- Busiest hour: ${stats.peakVolume.toLocaleString("en-US")} mentions`,
    `- Estimated reach: ${compact(stats.reach)}`,
    top ? `- Loudest concern: "${top.text.slice(0, 140).trim()}…" (${top.author})` : ``,
    ``,
    openTasks.length
      ? `What we're doing:\n${openTasks.map((t) => `- ${t.t.title}`).join("\n")}`
      : `What we're doing: assessing.`,
    ``,
    `Next update: [add a time].`,
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
  const mentionsHref = `/w/${slug}/mentions?q=${q!.id}&range=custom&from=${day(c.windowStart)}&to=${day(end)}&sentiment=negative&sort=reach`;
  const kpis: [string, string][] = [
    ["Mentions", stats.total.toLocaleString("en-US")],
    ["Negative", `${Math.round(negShare * 100)}%`],
    ["Busiest hour", stats.peakVolume.toLocaleString("en-US")],
    ["Estimated reach", compact(stats.reach)],
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <RoomOpened
        crisisId={c.id}
        peakVolume={stats.peakVolume}
        negativeShare={Math.round(negShare * 100) / 100}
      />
      <Link
        href={`/w/${slug}/crisis`}
        className="text-sm text-[var(--primary)] underline underline-offset-2"
      >
        ← All crisis rooms
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-[30px] font-semibold leading-[38px]" data-testid="room-title">
          {c.title}
        </h1>
        <span
          className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-medium"
          data-testid="room-status"
        >
          {c.status === "open" ? "Open" : `Resolved ${relativeTime(c.resolvedAt!.toISOString())}`}
        </span>
        {editable && (
          <div className="ml-auto">
            <ResolveButton
              ws={slug}
              crisisId={c.id}
              resolved={c.status === "resolved"}
              openTasks={openTasks.length}
            />
          </div>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Watching {q!.name}
        {fired && (
          <>
            {" · "}started from{" "}
            <Link href={`/w/${slug}/alerts/events/${fired.id}`} className="underline">
              an alert
            </Link>
          </>
        )}
      </p>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="room-kpis">
        {kpis.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <dt className="text-xs text-[var(--text-muted)]">{k}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <HourlyChart
          title="Mentions per hour"
          hours={stats.hours}
          marks={fired ? [{ t: fired.firedAt.getTime() }] : []}
          height={240}
        />
      </section>

      <CrisisAi
        ws={slug}
        crisisId={c.id}
        peakHour={stats.peakHour}
        disabledReason={ws.locked ? "AI is paused while the account is read-only." : undefined}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="drivers-h" data-testid="drivers">
          <h2 id="drivers-h" className="text-lg font-semibold">
            What&apos;s driving it
          </h2>
          {stats.topMentions.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              No negative mentions in this window.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {stats.topMentions.map((m) => (
                <li
                  key={m.id}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
                  data-testid="driver"
                >
                  <p className="line-clamp-3">{m.text}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {m.author} · {m.source} · est. reach {compact(m.reach)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={mentionsHref}
            className="mt-3 inline-block text-sm text-[var(--primary)] underline underline-offset-2"
            data-testid="room-mentions"
          >
            See all negative mentions in the feed
          </Link>
        </section>
        <section aria-labelledby="voices-h" data-testid="voices">
          <h2 id="voices-h" className="text-lg font-semibold">
            Loudest voices
          </h2>
          {stats.topAuthors.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--text-muted)]">Nobody yet.</p>
          ) : (
            <table className="mt-2 w-full text-left text-sm">
              <caption className="sr-only">
                Authors of negative mentions, by estimated reach
              </caption>
              <thead className="text-[var(--text-muted)]">
                <tr className="border-b border-[var(--border)]">
                  <th scope="col" className="py-1 font-medium">
                    Author
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Mentions
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Est. reach
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.topAuthors.map((a) => (
                  <tr key={a.handle} className="border-b border-[var(--border)] last:border-0">
                    <th scope="row" className="py-1 font-normal">
                      {a.name} <span className="text-xs text-[var(--text-muted)]">@{a.handle}</span>
                    </th>
                    <td className="py-1 text-right tabular-nums">{a.mentions}</td>
                    <td className="py-1 text-right tabular-nums">{compact(a.reach)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <TaskList
          ws={slug}
          crisisId={c.id}
          tasks={tasks.map((t) => ({
            id: t.t.id,
            title: t.t.title,
            done: !!t.t.doneAt,
            assignee: t.assignee,
          }))}
          members={members}
          canEdit={editable}
        />
        <div>
          {editable ? (
            <UpdateComposer
              ws={slug}
              crisisId={c.id}
              members={members}
              draftSubject={`Update: ${c.title}`}
              draftBody={draftBody}
            />
          ) : (
            <p className="text-sm text-[var(--text-muted)]" data-testid="room-readonly">
              You can follow this room but not change it. Ask an editor to send updates.
            </p>
          )}
          {updates.length > 0 && (
            <section className="mt-6" aria-labelledby="sent-h" data-testid="sent-updates">
              <h3 id="sent-h" className="text-sm font-semibold">
                Sent so far
              </h3>
              <ul className="mt-1 text-sm text-[var(--text-muted)]">
                {updates.map((u) => (
                  <li key={u.id}>
                    {u.subject} · {u.recipientsCount}{" "}
                    {u.recipientsCount === 1 ? "person" : "people"} ·{" "}
                    {relativeTime(u.sentAt.toISOString())}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
