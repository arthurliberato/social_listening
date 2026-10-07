import Link from "next/link";
import { Avatar } from "@/components/creators/Avatar";
import { PaywallButton, type LockCopy } from "@/components/creators/Locked";
import { trackServer } from "@/lib/analytics/server";
import { requireWorkspace } from "@/lib/auth/session";
import {
  COMPARE_MIN,
  bestOf,
  compareHref,
  costPer1kViews,
  parseCompareIds,
  type Measure,
} from "@/lib/creators/compare";
import {
  PLATFORM_LABEL,
  SAFETY_LABEL,
  authLabel,
  countryName,
  titleCase,
  usd,
} from "@/lib/creators/labels";
import { creatorsByIds, type CreatorSummary } from "@/lib/creators/service";
import { PLANS } from "@/lib/entitlements/plans";
import { compact } from "@/lib/format";
import { accountPlan } from "@/lib/queries";

export const metadata = { title: "Compare creators · Ripplewise" };
export const dynamic = "force-dynamic";

const num = (v: number | null, f: (n: number) => string) => (v === null ? "—" : f(v));

/** The numbers worth putting side by side. `better` says which direction wins; facts have no winner. */
const MEASURES: Measure<CreatorSummary>[] = [
  {
    key: "followers",
    label: "Followers",
    better: null,
    value: (c) => c.followers,
    show: (v) => num(v, compact),
  },
  {
    key: "engagement",
    label: "Engagement rate",
    better: "high",
    value: (c) => c.engagementRate,
    show: (v) => num(v, (n) => `${n.toFixed(2)}%`),
  },
  {
    key: "views",
    label: "Average views",
    better: "high",
    value: (c) => c.avgViews,
    show: (v) => num(v, compact),
  },
  {
    key: "posts",
    label: "Posts per week",
    better: null,
    value: (c) => c.postsPerWeek,
    show: (v) => num(v, (n) => String(n)),
  },
  {
    key: "growth",
    label: "30-day growth",
    better: "high",
    value: (c) => c.growth30d,
    show: (v) => num(v, (n) => `${n > 0 ? "+" : ""}${n}%`),
  },
  {
    key: "authenticity",
    label: "Authenticity",
    better: "high",
    value: (c) => c.authenticityScore,
    show: (v) => num(v, (n) => `${n} · ${authLabel(n)}`),
  },
  {
    key: "rate",
    label: "Estimated rate per post",
    better: "low",
    value: (c) => c.ratePerPostUsd,
    show: (v) => num(v, usd),
  },
  {
    key: "cpm",
    label: "Cost per 1,000 views",
    better: "low",
    value: (c) => costPer1kViews(c.ratePerPostUsd, c.avgViews),
    show: (v) => num(v, (n) => `$${n.toFixed(2)}`),
  },
];

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ws: slug } = await params;
  const sp = await searchParams;
  const { user, ws } = await requireWorkspace(slug);
  const { plan } = await accountPlan(ws.id);
  const asked = parseCompareIds(sp.ids, plan.compareSize);
  const rows = await creatorsByIds(asked.ids);

  const back = (
    <Link href={`/w/${slug}/creators`} className="text-sm text-[var(--primary)] underline">
      ← Back to discovery
    </Link>
  );

  if (rows.length < COMPARE_MIN)
    return (
      <div className="mx-auto max-w-3xl">
        {back}
        <h1 className="mt-3 text-[30px] font-semibold leading-[38px]">Compare creators</h1>
        <div
          className="mt-5 rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
          data-testid="compare-empty"
        >
          <p className="font-medium">Pick at least two creators to compare.</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Tick the Compare box on the creators you&apos;re weighing up in discovery, then open the
            comparison.
          </p>
          <Link
            href={`/w/${slug}/creators`}
            className="mt-3 inline-block text-[var(--primary)] underline"
          >
            Go to discovery
          </Link>
        </div>
      </div>
    );

  await trackServer(
    "Creators Compared",
    { userId: user.id, workspaceId: ws.id },
    { creator_count: rows.length, truncated: asked.truncated },
  );

  const more = (["starter", "growth", "agency", "enterprise"] as const).find(
    (t) => PLANS[t].compareSize > plan.compareSize,
  );
  const lock: LockCopy | null = more
    ? {
        trigger: "creator_compare_limit",
        title: "Compare more creators",
        reason: `Your plan compares up to ${plan.compareSize} creators at a time.`,
        upgradeTo: more,
        bullets: [
          `Compare up to ${PLANS[more].compareSize} creators side by side`,
          "More saved searches",
          "Audience insights and list export",
        ],
      }
    : null;
  const ids = rows.map((r) => r.id);

  return (
    <div className="mx-auto max-w-6xl">
      {back}
      <h1 className="mt-3 text-[30px] font-semibold leading-[38px]">Compare creators</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        Side by side, with the best on each measure marked. Cost per 1,000 views is the fairest way
        to compare creators of different sizes.
      </p>
      {asked.truncated && (
        <p role="status" className="mt-3 text-sm" data-testid="compare-truncated">
          Your plan compares up to {plan.compareSize} creators at a time, so this shows the first{" "}
          {rows.length}.{" "}
          {lock && (
            <PaywallButton
              copy={lock}
              className="min-h-8 rounded-md px-1 text-[var(--primary)] underline"
              testId="compare-more"
            >
              See plans that compare more
            </PaywallButton>
          )}
        </p>
      )}

      <div className="mt-5 overflow-x-auto">
        <table
          className="w-full min-w-[40rem] border-collapse text-left text-sm"
          data-testid="compare-table"
        >
          <caption className="sr-only">
            Comparison of {rows.map((r) => r.displayName).join(", ")}. Where one creator is best on
            a measure it is marked “Best”.
          </caption>
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th
                scope="col"
                className="w-48 px-2 py-3 text-left text-xs font-medium text-[var(--text-muted)]"
              >
                Measure
              </th>
              {rows.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className="px-2 py-3 align-top font-normal"
                  data-testid="compare-col"
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={c.displayName} seed={c.avatarSeed} />
                    <div>
                      <Link
                        href={`/w/${slug}/creators/${c.id}`}
                        className="font-medium text-[var(--primary)] underline underline-offset-2"
                      >
                        {c.displayName}
                      </Link>
                      <div className="text-xs text-[var(--text-muted)]">@{c.handle}</div>
                    </div>
                  </div>
                  {rows.length > COMPARE_MIN && (
                    <Link
                      href={compareHref(
                        slug,
                        ids.filter((x) => x !== c.id),
                      )}
                      className="mt-1 inline-block min-h-6 text-xs text-[var(--text-muted)] underline"
                      data-testid="compare-remove"
                    >
                      Remove<span className="sr-only"> {c.displayName} from the comparison</span>
                    </Link>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              {
                label: "Platform",
                show: (c: CreatorSummary) => PLATFORM_LABEL[c.platform] ?? c.platform,
              },
              { label: "Niche", show: (c: CreatorSummary) => titleCase(c.niche) },
              { label: "Country", show: (c: CreatorSummary) => countryName(c.country) },
              {
                label: "Brand safety",
                show: (c: CreatorSummary) =>
                  SAFETY_LABEL[c.brandSafety as keyof typeof SAFETY_LABEL],
              },
            ].map((fact) => (
              <tr key={fact.label} className="border-b border-[var(--border)]">
                <th scope="row" className="px-2 py-2 font-medium">
                  {fact.label}
                </th>
                {rows.map((c) => (
                  <td key={c.id} className="px-2 py-2">
                    {fact.show(c)}
                  </td>
                ))}
              </tr>
            ))}
            {MEASURES.map((m) => {
              const values = rows.map((c) => m.value(c));
              const best = bestOf(values, m.better);
              return (
                <tr
                  key={m.key}
                  className="border-b border-[var(--border)]"
                  data-testid={`compare-row-${m.key}`}
                >
                  <th scope="row" className="px-2 py-2 font-medium">
                    {m.label}
                  </th>
                  {rows.map((c, i) => (
                    <td
                      key={c.id}
                      className="px-2 py-2 tabular-nums"
                      data-best={best.includes(i) || undefined}
                    >
                      {m.show(values[i]!)}
                      {best.includes(i) && (
                        <span
                          className="ml-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium"
                          data-testid="best"
                        >
                          Best
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm text-[var(--text-muted)]">
        Audience demographics and follower quality stay on each creator&apos;s profile.
      </p>
    </div>
  );
}
