import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { db, historyPacks, queries } from "@/db/client";
import { HISTORY_PACK, PACK_TIERS, usd } from "@/lib/billing/history-pack";
import { defaultMethod, getAccount } from "@/lib/billing/service";
import { can as roleCan } from "@/lib/permissions";
import type { PlanTier } from "@/lib/entitlements/plans";
import { BackfillPoller } from "@/components/listening/BackfillPoller";
import { NewQueryButton } from "@/components/listening/NewQueryButton";
import { QueryRowActions } from "@/components/listening/QueryRowActions";
import { requireWorkspace, userWorkspaces } from "@/lib/auth/session";
import { accountPlan, activeQueryCount, canEdit } from "@/lib/queries";
import { PLANS } from "@/lib/entitlements/plans";

export const metadata = { title: "Queries · Ripplewise" };
export const dynamic = "force-dynamic";

const BACKFILL: Record<string, string> = {
  pending: "Queued…",
  running: "Collecting mentions…",
  done: "Up to date",
  quota_exhausted: "Monthly mention limit reached",
  failed: "Collection failed",
};

export default async function QueriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { ws: slug } = await params;
  const { saved } = await searchParams;
  const { user, ws } = await requireWorkspace(slug);
  const rows = await db
    .select()
    .from(queries)
    .where(eq(queries.workspaceId, ws.id))
    .orderBy(desc(queries.updatedAt));
  const { accountId, tier, plan } = await accountPlan(ws.id);
  const active = await activeQueryCount(accountId);
  const atLimit = active >= plan.activeQueries;
  const next =
    (["starter", "growth", "agency", "enterprise"] as const).find(
      (t) => PLANS[t].activeQueries > plan.activeQueries,
    ) ?? "enterprise";
  const [packs, acct, card] = await Promise.all([
    db.select().from(historyPacks).where(eq(historyPacks.accountId, ws.accountId)),
    getAccount(ws.accountId),
    defaultMethod(ws.accountId),
  ]);
  const packOf = new Map(packs.map((p) => [p.queryId, p]));
  const eligible =
    acct?.billingStatus === "active" && PACK_TIERS.includes(acct.planTier as PlanTier);
  const collecting =
    rows.some(
      (r) =>
        r.status === "live" && (r.backfillStatus === "pending" || r.backfillStatus === "running"),
    ) || packs.some((p) => p.status === "pending" || p.status === "running");
  const editable = canEdit(ws.role);
  // Where this person can copy a query: any workspace of the account they can edit (this one duplicates).
  const targets = (await userWorkspaces(user.id))
    .filter((w) => w.accountId === ws.accountId && canEdit(w.role))
    .map((w) => ({ slug: w.slug, name: w.id === ws.id ? `${w.name} (duplicate here)` : w.name }));

  return (
    <div className="mx-auto max-w-[1600px]">
      <BackfillPoller active={collecting} />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[30px] font-semibold leading-[38px]">Queries</h1>
        <p className="text-sm text-[var(--text-muted)]" data-testid="query-usage">
          {active} of {plan.activeQueries} active queries · {plan.label} plan
        </p>
        <div className="ml-auto">
          {editable && (
            <NewQueryButton
              ws={slug}
              atLimit={atLimit}
              upgradeTo={next}
              used={active}
              limit={plan.activeQueries}
            />
          )}
        </div>
      </div>
      {saved && (
        <p
          role="status"
          className="mt-3 rounded-md border border-[var(--success)] p-3 text-sm"
          data-testid="saved-banner"
        >
          Query saved. We&apos;re collecting its history now.
        </p>
      )}

      {rows.length === 0 ? (
        <section
          className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center"
          data-testid="queries-empty"
        >
          <h2 className="text-xl font-semibold">Start listening</h2>
          <p className="mx-auto mt-2 max-w-md text-[var(--text-muted)]">
            Create your first query — we&apos;ll pre-fill it with your brand.
          </p>
          {editable && (
            <div className="mt-4">
              <NewQueryButton
                ws={slug}
                atLimit={false}
                upgradeTo={next}
                used={active}
                limit={plan.activeQueries}
              />
            </div>
          )}
        </section>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-left text-sm" data-testid="queries-table">
            <caption className="sr-only">Queries in this workspace</caption>
            <thead className="border-b border-[var(--border)] text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="p-3 font-medium">
                  Name
                </th>
                <th scope="col" className="p-3 font-medium">
                  Status
                </th>
                <th scope="col" className="p-3 text-right font-medium">
                  Mentions
                </th>
                <th scope="col" className="p-3 font-medium">
                  Collection
                </th>
                <th scope="col" className="p-3 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr
                  key={q.id}
                  className="border-b border-[var(--border)] last:border-0"
                  data-testid="query-row"
                  data-status={q.status}
                >
                  <th scope="row" className="p-3 font-medium">
                    <Link
                      href={`/w/${slug}/queries/${q.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {q.name}
                    </Link>
                    <p className="mt-0.5 max-w-xl truncate font-mono text-xs font-normal text-[var(--text-muted)]">
                      {q.booleanText}
                    </p>
                  </th>
                  <td className="p-3">
                    {q.status === "live" ? "Live" : q.status === "paused" ? "Paused" : "Draft"}
                  </td>
                  <td className="p-3 text-right tabular-nums" data-testid="query-matched">
                    {q.backfillMatched.toLocaleString()}
                  </td>
                  <td className="p-3 text-[var(--text-muted)]" data-testid="query-backfill">
                    {q.status === "live" ? (BACKFILL[q.backfillStatus] ?? q.backfillStatus) : "—"}
                  </td>
                  <td className="p-3">
                    <QueryRowActions
                      ws={slug}
                      id={q.id}
                      name={q.name}
                      status={q.status}
                      canEdit={editable}
                      copyTargets={targets}
                      pack={{
                        status:
                          (packOf.get(q.id)?.status as
                            "pending" | "running" | "done" | "failed" | undefined) ?? null,
                        matched: packOf.get(q.id)?.matched ?? 0,
                        ready:
                          q.status === "live" &&
                          ["done", "quota_exhausted"].includes(q.backfillStatus),
                        eligible,
                        canBuy: roleCan(ws.role, "billing.manage"),
                        card: card ? `${card.last4}` : null,
                        price: usd(HISTORY_PACK.priceCents),
                        extraDays: HISTORY_PACK.extraDays,
                        maxMentions: HISTORY_PACK.maxMentions,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tier === "trial" && atLimit && (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Pause or delete a query to free a slot, or compare{" "}
          <Link href="/upgrade?from=mention_quota" className="underline">
            plans
          </Link>
          .
        </p>
      )}
    </div>
  );
}
