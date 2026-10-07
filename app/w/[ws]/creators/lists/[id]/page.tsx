import Link from "next/link";
import { notFound } from "next/navigation";
import { ListView } from "@/components/creators/ListView";
import type { LockCopy } from "@/components/creators/Locked";
import { requireWorkspace } from "@/lib/auth/session";
import { getList } from "@/lib/creators/service";
import { PLANS, planUnlocking } from "@/lib/entitlements/plans";
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
  const { list, items } = data;
  return (
    <div className="mx-auto max-w-6xl">
      <Link href={`/w/${slug}/creators/lists`} className="text-sm text-[var(--primary)] underline">
        ← All lists
      </Link>
      <ListView
        ws={slug}
        listId={list.id}
        name={list.name}
        editable={canEdit(ws.role)}
        exportUnlocked={plan.features.creatorExport}
        exportCopy={copy}
        initial={items.map((c) => ({
          id: c.id,
          displayName: c.displayName,
          handle: c.handle,
          platform: c.platform,
          country: c.country,
          niche: c.niche,
          followers: c.followers,
          engagementRate: c.engagementRate,
          authenticityScore: c.authenticityScore,
          ratePerPostUsd: c.ratePerPostUsd,
          avatarSeed: c.avatarSeed,
        }))}
      />
    </div>
  );
}
