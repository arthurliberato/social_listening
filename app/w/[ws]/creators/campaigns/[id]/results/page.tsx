import Link from "next/link";
import { notFound } from "next/navigation";
import { LockedPanel, type LockCopy } from "@/components/creators/Locked";
import { Avatar } from "@/components/creators/Avatar";
import { CopyField } from "@/components/creators/results/CopyField";
import { ResultsChart } from "@/components/creators/results/ResultsChart";
import { TrackingSetup } from "@/components/creators/results/TrackingSetup";
import { trackServer } from "@/lib/analytics/server";
import { requireWorkspace } from "@/lib/auth/session";
import { getCampaign } from "@/lib/creators/campaigns";
import { usd } from "@/lib/creators/labels";
import { campaignResults, postbackBase } from "@/lib/creators/tracking";
import { PLANS, planUnlocking } from "@/lib/entitlements/plans";
import { accountPlan, canEdit } from "@/lib/queries";

export const metadata = { title: "Campaign results · Ripplewise" };
export const dynamic = "force-dynamic";

const money = (n: number | null) =>
  n === null
    ? "—"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

function Tile({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  testId: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </dd>
      {hint && <p className="mt-1 text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ ws: string; id: string }>;
}) {
  const { ws: slug, id } = await params;
  const { user, ws } = await requireWorkspace(slug);
  const data = await getCampaign(ws.id, id);
  if (!data) notFound();
  const { plan } = await accountPlan(ws.id);
  const c = data.campaign;
  const back = (
    <Link
      href={`/w/${slug}/creators/campaigns/${c.id}`}
      className="text-sm text-[var(--primary)] underline"
    >
      ← {c.name}
    </Link>
  );

  if (!plan.features.campaignResults) {
    const to = planUnlocking("campaignResults");
    const copy: LockCopy = {
      trigger: "campaign_results",
      title: "Tracking links and results",
      reason: `A tracking link for every creator, with clicks, conversions, cost per result and return on spend, is part of ${PLANS[to].label}.`,
      upgradeTo: to,
      bullets: [
        "A unique link for each confirmed creator",
        "Conversions reported from your own site",
        "Cost per click, cost per conversion and return on spend",
      ],
    };
    return (
      <div className="mx-auto max-w-3xl">
        {back}
        <h1 className="mt-3 text-[30px] font-semibold leading-[38px]">Results</h1>
        <div className="mt-5">
          <LockedPanel
            testId="results-locked"
            heading="Campaign results are locked"
            blurb="See which creators actually bring people to your site, and what each result costs."
            copy={copy}
          />
        </div>
      </div>
    );
  }

  const results = await campaignResults(c.id);
  await trackServer(
    "Campaign Results Viewed",
    { userId: user.id, workspaceId: ws.id },
    { campaign_id: c.id, clicks: results.total.clicks, conversions: results.total.conversions },
  );
  const t = results.total;
  return (
    <div className="mx-auto max-w-6xl">
      {back}
      <h1 className="mt-3 text-[30px] font-semibold leading-[38px]" data-testid="results-title">
        Results: {c.name}
      </h1>
      <p className="mt-1 text-[var(--text-muted)]">
        Visits through creators&apos; tracking links, and the conversions your site reports back.
        Crawlers and link previews are left out.
      </p>
      <div className="mt-5">
        <TrackingSetup
          ws={slug}
          campaignId={c.id}
          initialUrl={c.destinationUrl}
          initialKey={canEdit(ws.role) ? c.conversionKey : null}
          postbackBase={postbackBase()}
          canEdit={canEdit(ws.role)}
        />
      </div>

      {!c.destinationUrl ? (
        <div
          className="mt-6 rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
          data-testid="results-no-destination"
        >
          <p className="font-medium">Set a landing page to start tracking.</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Creators who are confirmed get a link as soon as it&apos;s set.
          </p>
        </div>
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Campaign totals">
            <Tile label="Clicks" value={t.clicks.toLocaleString()} testId="kpi-clicks" />
            <Tile
              label="Unique visitors"
              value={t.visitors.toLocaleString()}
              hint="First visit per person per day"
              testId="kpi-visitors"
            />
            <Tile
              label="Conversions"
              value={t.conversions.toLocaleString()}
              hint={t.conversionRate === null ? undefined : `${t.conversionRate}% of visitors`}
              testId="kpi-conversions"
            />
            <Tile label="Revenue" value={money(t.revenueUsd)} testId="kpi-revenue" />
            <Tile
              label="Spend"
              value={money(t.spendUsd)}
              hint="Agreed fees of confirmed creators"
              testId="kpi-spend"
            />
            <Tile label="Cost per click" value={money(t.cpc)} testId="kpi-cpc" />
            <Tile label="Cost per conversion" value={money(t.cpa)} testId="kpi-cpa" />
            <Tile
              label="Return on spend"
              value={t.roas === null ? "—" : `${t.roas}×`}
              testId="kpi-roas"
            />
          </dl>

          {!results.hasTraffic && (
            <p
              className="mt-6 rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-[var(--text-muted)]"
              data-testid="results-empty"
            >
              No visits yet. Once creators share their links, clicks show up here within moments.
            </p>
          )}
          <div className="mt-6">
            <ResultsChart points={results.daily} />
          </div>

          <h2 className="mt-8 text-xl font-semibold">By creator</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="results-table">
              <caption className="sr-only">Results for each creator on {c.name}</caption>
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  {[
                    "Creator",
                    "Link",
                    "Clicks",
                    "Visitors",
                    "Conversions",
                    "Revenue",
                    "Fee",
                    "Cost per conversion",
                    "Return",
                  ].map((h) => (
                    <th key={h} scope="col" className="px-2 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.perCreator.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-2 py-6 text-center text-[var(--text-muted)]"
                      data-testid="results-no-creators"
                    >
                      No creators are confirmed yet. A creator gets a link when they accept.
                    </td>
                  </tr>
                ) : (
                  results.perCreator.map((r) => (
                    <tr
                      key={r.creatorId}
                      className="border-b border-[var(--border)] align-top"
                      data-testid="results-row"
                    >
                      <th scope="row" className="px-2 py-3 font-normal">
                        <div className="flex items-center gap-3">
                          <Avatar name={r.name} seed={r.creatorId} size={32} />
                          <div>
                            <Link
                              href={`/w/${slug}/creators/${r.creatorId}`}
                              className="font-medium text-[var(--primary)] underline underline-offset-2"
                            >
                              {r.name}
                            </Link>
                            <div className="text-xs text-[var(--text-muted)]">@{r.handle}</div>
                          </div>
                        </div>
                      </th>
                      <td className="px-2 py-3">
                        {r.link ? (
                          <CopyField
                            label={`tracking link for ${r.name}`}
                            value={r.link}
                            testId="creator-link-field"
                          />
                        ) : (
                          <span className="text-[var(--text-muted)]">Not created yet</span>
                        )}
                      </td>
                      <td className="px-2 py-3 tabular-nums" data-testid="row-clicks">
                        {r.clicks.toLocaleString()}
                      </td>
                      <td className="px-2 py-3 tabular-nums">{r.visitors.toLocaleString()}</td>
                      <td className="px-2 py-3 tabular-nums" data-testid="row-conversions">
                        {r.conversions.toLocaleString()}
                      </td>
                      <td className="px-2 py-3 tabular-nums">{money(r.revenueUsd)}</td>
                      <td className="px-2 py-3 tabular-nums">{usd(r.feeUsd ?? 0)}</td>
                      <td className="px-2 py-3 tabular-nums">{money(r.cpa)}</td>
                      <td className="px-2 py-3 tabular-nums">
                        {r.roas === null ? "—" : `${r.roas}×`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
