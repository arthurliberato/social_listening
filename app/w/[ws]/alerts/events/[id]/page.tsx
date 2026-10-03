import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alertEvents, alertRules, crises, db, queries } from "@/db/client";
import { EventActions } from "@/components/alerts/EventActions";
import { HourlyChart } from "@/components/alerts/HourlyChart";
import { requireWorkspace } from "@/lib/auth/session";
import { loadBuckets } from "@/lib/alerts/engine";
import { describeRule, HOUR_MS, TYPE_INFO, type AlertType } from "@/lib/alerts/rules";
import { absoluteTime } from "@/lib/format";
import { accountPlan, canEdit } from "@/lib/queries";
import { SeverityBadge, StatusBadge } from "@/components/alerts/badges";

export const metadata = { title: "Alert · Ripplewise" };
export const dynamic = "force-dynamic";

const num = (n: unknown) => (typeof n === "number" ? n.toLocaleString("en-US") : "—");
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default async function AlertEventPage({
  params,
}: {
  params: Promise<{ ws: string; id: string }>;
}) {
  const { ws: slug, id } = await params;
  const { ws } = await requireWorkspace(slug);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [ev] = await db
    .select()
    .from(alertEvents)
    .where(and(eq(alertEvents.id, id), eq(alertEvents.workspaceId, ws.id)));
  if (!ev) notFound();
  const [rule] = await db.select().from(alertRules).where(eq(alertRules.id, ev.ruleId));
  const [q] = await db.select().from(queries).where(eq(queries.id, rule!.queryId));
  const [crisis] = await db.select().from(crises).where(eq(crises.alertEventId, ev.id));
  const { plan } = await accountPlan(ws.id);
  const type = rule!.type as AlertType;
  const fired = ev.firedAt.getTime();
  const hours = await loadBuckets(ws.id, q!.id, fired - 24 * HOUR_MS, fired + HOUR_MS);
  const grid = Array.from({ length: 25 }, (_, i) => {
    const t = Math.floor(fired / HOUR_MS) * HOUR_MS - (24 - i) * HOUR_MS;
    return hours.find((h) => h.t === t) ?? { t, count: 0, negative: 0, maxReach: 0 };
  });
  const d = ev.details as Record<string, number>;
  const stats: [string, string][] =
    type === "volume_spike"
      ? [
          ["Mentions in the last hour", num(d.count)],
          ["Usual per hour", num(d.usual)],
          ["Times the usual", typeof d.multiple === "number" ? `${d.multiple.toFixed(1)}×` : "—"],
          ["Of which negative", num(d.negative)],
        ]
      : type === "sentiment_drop"
        ? [
            ["Mentions in the last hour", num(d.count)],
            ["Negative", num(d.negative)],
            ["Negative share", typeof d.share === "number" ? `${Math.round(d.share * 100)}%` : "—"],
            [
              "Usually",
              typeof d.usualShare === "number" ? `${Math.round(d.usualShare * 100)}%` : "—",
            ],
          ]
        : [
            ["Largest estimated reach", num(d.maxReach)],
            ["Threshold", num(d.threshold)],
            ["Mentions in the last hour", num(d.count)],
          ];
  const sort = type === "sentiment_drop" ? "negative" : type === "influencer" ? "reach" : "newest";
  const mentionsHref = `/w/${slug}/mentions?q=${q!.id}&range=custom&from=${day(fired - HOUR_MS)}&to=${day(fired)}&sort=${sort}`;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/w/${slug}/alerts`}
        className="text-sm text-[var(--primary)] underline underline-offset-2"
      >
        ← Back to alerts
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-[30px] font-semibold leading-[38px]" data-testid="event-title">
          {rule!.name}
        </h1>
        <SeverityBadge severity={ev.severity} />
        <StatusBadge status={ev.status} />
      </div>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        {TYPE_INFO[type].label} on{" "}
        <strong className="font-medium text-[var(--text)]">{q!.name}</strong> ·{" "}
        {absoluteTime(ev.firedAt.toISOString())}
      </p>
      <p className="mt-4 text-lg" data-testid="event-summary">
        {ev.summary}
      </p>
      <div className="mt-4">
        <EventActions
          ws={slug}
          eventId={ev.id}
          ruleId={rule!.id}
          status={ev.status}
          canEdit={canEdit(ws.role)}
          crisisId={crisis?.id ?? null}
          crisisAllowed={plan.features.crisisRoom}
          mentionsHref={mentionsHref}
        />
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="event-stats">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <dt className="text-xs text-[var(--text-muted)]">{k}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <HourlyChart title="The 24 hours leading up to it" hours={grid} marks={[{ t: fired }]} />
      </section>
      <p className="mt-4 text-sm text-[var(--text-muted)]">
        Rule: {describeRule(type, rule!.params as Record<string, unknown>)}. Won&apos;t repeat for{" "}
        {rule!.cooldownMin >= 60
          ? `${rule!.cooldownMin / 60} hour${rule!.cooldownMin === 60 ? "" : "s"}`
          : `${rule!.cooldownMin} minutes`}
        .
      </p>
    </div>
  );
}
