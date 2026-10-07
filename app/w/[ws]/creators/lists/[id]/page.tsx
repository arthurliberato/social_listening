import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/creators/Avatar";
import { DeleteListButton } from "@/components/creators/ListsPanel";
import { ExportButton } from "@/components/creators/ExportButton";
import type { LockCopy } from "@/components/creators/Locked";
import { RemoveFromListButton } from "@/components/creators/RemoveFromListButton";
import { requireWorkspace } from "@/lib/auth/session";
import { PLATFORM_LABEL, authLabel, countryName, titleCase, usd } from "@/lib/creators/labels";
import { getList } from "@/lib/creators/service";
import { PLANS, planUnlocking } from "@/lib/entitlements/plans";
import { compact } from "@/lib/format";
import { accountPlan, canEdit } from "@/lib/queries";

export const metadata = { title: "Creator list · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function ListPage({
  params,
}: {
  params: Promise<{ ws: string; id: string }>;
}) {
  const { ws: slug, id } = await params;
  const { ws } = await requireWorkspace(slug);
  const data = await getList(ws.id, id);
  if (!data) notFound();
  const { plan } = await accountPlan(ws.id);
  const to = planUnlocking("creatorExport");
  const copy: LockCopy = {
    trigger: "creator_export",
    title: "Export creator lists",
    reason: `Exporting a shortlist to CSV is part of ${PLANS[to].label}.`,
    upgradeTo: to,
    bullets: [
      "CSV export of creator lists",
      "Audience insights on every profile",
      `${PLANS[to].creatorLists} creator lists`,
    ],
  };
  const editable = canEdit(ws.role);
  const { list, items } = data;
  return (
    <div className="mx-auto max-w-6xl">
      <Link href={`/w/${slug}/creators/lists`} className="text-sm text-[var(--primary)] underline">
        ← All lists
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-semibold leading-[38px]" data-testid="list-name">
            {list.name}
          </h1>
          <p className="text-[var(--text-muted)]">
            {items.length} creator{items.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {items.length > 0 && (
            <ExportButton
              href={`/api/w/${slug}/creators/lists/${list.id}/export`}
              unlocked={plan.features.creatorExport}
              copy={copy}
            />
          )}
          {editable && <DeleteListButton ws={slug} listId={list.id} name={list.name} />}
        </div>
      </div>
      {items.length === 0 ? (
        <div
          className="mt-6 rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
          data-testid="list-empty"
        >
          <p className="font-medium">This list is empty.</p>
          <Link
            href={`/w/${slug}/creators`}
            className="mt-2 inline-block text-[var(--primary)] underline"
          >
            Find creators to add
          </Link>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="list-table">
            <caption className="sr-only">Creators in {list.name}</caption>
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                {[
                  "Creator",
                  "Niche",
                  "Followers",
                  "Engagement",
                  "Authenticity",
                  "Est. rate / post",
                  "Remove",
                ].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)]" data-testid="list-item">
                  <th scope="row" className="px-2 py-2 font-normal">
                    <div className="flex items-center gap-3">
                      <Avatar name={c.displayName} seed={c.avatarSeed} />
                      <div>
                        <Link
                          href={`/w/${slug}/creators/${c.id}`}
                          className="font-medium text-[var(--primary)] underline underline-offset-2"
                        >
                          {c.displayName}
                        </Link>
                        <div className="text-xs text-[var(--text-muted)]">
                          @{c.handle} · {PLATFORM_LABEL[c.platform]} · {countryName(c.country)}
                        </div>
                      </div>
                    </div>
                  </th>
                  <td className="px-2 py-2">{titleCase(c.niche)}</td>
                  <td className="px-2 py-2 tabular-nums">{compact(c.followers)}</td>
                  <td className="px-2 py-2 tabular-nums">{c.engagementRate.toFixed(2)}%</td>
                  <td className="px-2 py-2 tabular-nums">
                    {c.authenticityScore}{" "}
                    <span className="text-xs text-[var(--text-muted)]">
                      {authLabel(c.authenticityScore)}
                    </span>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{usd(c.ratePerPostUsd)}</td>
                  <td className="px-2 py-2">
                    <RemoveFromListButton
                      ws={slug}
                      listId={list.id}
                      creatorId={c.id}
                      name={c.displayName}
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
