import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/creators/Avatar";
import { BudgetMeter } from "@/components/creators/campaigns/BudgetMeter";
import {
  AddFromList,
  EditDetails,
  StatusButtons,
} from "@/components/creators/campaigns/CampaignControls";
import { RosterRow } from "@/components/creators/campaigns/RosterRow";
import { requireWorkspace } from "@/lib/auth/session";
import {
  OBJECTIVE_LABEL,
  STATUS_LABEL,
  isCreatorStatus,
  type CampaignStatus,
  type Objective,
} from "@/lib/creators/campaign-flow";
import { getCampaign } from "@/lib/creators/campaigns";
import { PLATFORM_LABEL, countryName } from "@/lib/creators/labels";
import { workspaceLists } from "@/lib/creators/service";
import { compact } from "@/lib/format";
import { canEdit } from "@/lib/queries";

export const metadata = { title: "Campaign · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ ws: string; id: string }>;
}) {
  const { ws: slug, id } = await params;
  const { ws } = await requireWorkspace(slug);
  const data = await getCampaign(ws.id, id);
  if (!data) notFound();
  const lists = await workspaceLists(ws.id);
  const { campaign: c, roster, budget } = data;
  const editable = canEdit(ws.role);
  const open = c.status === "draft" || c.status === "active";
  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href={`/w/${slug}/creators/campaigns`}
        className="text-sm text-[var(--primary)] underline"
      >
        ← All campaigns
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-semibold leading-[38px]" data-testid="campaign-title">
            {c.name}
          </h1>
          <p className="text-[var(--text-muted)]">
            <span data-testid="campaign-status">
              {c.status[0]!.toUpperCase() + c.status.slice(1)}
            </span>
            {" · "}
            {OBJECTIVE_LABEL[c.objective as Objective] ?? c.objective}
            {c.startsOn || c.endsOn ? ` · ${c.startsOn ?? "…"} to ${c.endsOn ?? "…"}` : ""}
          </p>
        </div>
        <StatusButtons ws={slug} id={c.id} status={c.status as CampaignStatus} canEdit={editable} />
      </div>
      {c.brief && (
        <p className="mt-3 max-w-prose whitespace-pre-line" data-testid="campaign-brief">
          {c.brief}
        </p>
      )}
      <div className="mt-4">
        <EditDetails
          ws={slug}
          id={c.id}
          canEdit={editable}
          initial={{
            name: c.name,
            objective: c.objective,
            brief: c.brief,
            budgetUsd: c.budgetUsd,
            startsOn: c.startsOn,
            endsOn: c.endsOn,
          }}
        />
      </div>
      <div className="mt-6">
        <BudgetMeter b={budget} />
      </div>
      {open && (
        <div className="mt-6">
          <AddFromList
            ws={slug}
            id={c.id}
            canEdit={editable}
            lists={lists.map((l) => ({ id: l.id, name: l.name, size: l.size }))}
          />
        </div>
      )}
      <h2 className="mt-8 text-xl font-semibold">Creators</h2>
      {roster.length === 0 ? (
        <div
          className="mt-3 rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
          data-testid="roster-empty"
        >
          <p className="font-medium">No creators on this campaign yet.</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Add a list of creators above to start.
          </p>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="roster-table">
            <caption className="sr-only">
              Creators on {c.name} and where each is in the pipeline
            </caption>
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                {["Creator", "Followers", "Status", "Manage"].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => (
                <tr
                  key={r.creatorId}
                  className="border-b border-[var(--border)] align-top"
                  data-testid="roster-row"
                >
                  <th scope="row" className="px-2 py-3 font-normal">
                    <div className="flex items-center gap-3">
                      <Avatar name={r.displayName} seed={r.avatarSeed} />
                      <div>
                        <Link
                          href={`/w/${slug}/creators/${r.creatorId}`}
                          className="font-medium text-[var(--primary)] underline underline-offset-2"
                        >
                          {r.displayName}
                        </Link>
                        <div className="text-xs text-[var(--text-muted)]">
                          @{r.handle} · {PLATFORM_LABEL[r.platform]} · {countryName(r.country)}
                        </div>
                      </div>
                    </div>
                  </th>
                  <td className="px-2 py-3 tabular-nums">{compact(r.followers)}</td>
                  <td className="px-2 py-3" data-testid="roster-status">
                    {isCreatorStatus(r.status) ? STATUS_LABEL[r.status] : r.status}
                  </td>
                  <td className="px-2 py-3">
                    <RosterRow
                      ws={slug}
                      campaignId={c.id}
                      editable={editable && open}
                      row={{
                        creatorId: r.creatorId,
                        name: r.displayName,
                        status: r.status,
                        feeUsd: r.feeUsd,
                        note: r.note,
                        suggestedFee: r.ratePerPostUsd,
                      }}
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
