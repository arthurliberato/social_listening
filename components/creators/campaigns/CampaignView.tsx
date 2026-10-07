"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/creators/Avatar";
import { BudgetMeter } from "./BudgetMeter";
import { AddFromList, EditDetails, StatusButtons } from "./CampaignControls";
import { RosterRow } from "./RosterRow";
import {
  OBJECTIVE_LABEL,
  STATUS_LABEL,
  isCreatorStatus,
  type CampaignStatus,
  type Objective,
} from "@/lib/creators/campaign-flow";
import type { CampaignSnapshot } from "@/lib/creators/campaigns";
import { PLATFORM_LABEL, countryName } from "@/lib/creators/labels";
import { compact } from "@/lib/format";

/**
 * The campaign page. It holds the campaign as a snapshot and every server action hands back a fresh one, so what's
 * on screen follows what the person just did without depending on a page re-render arriving.
 */
export function CampaignView({
  ws,
  initial,
  lists,
  canEdit,
  brand,
}: {
  brand: string;
  ws: string;
  initial: CampaignSnapshot;
  lists: { id: string; name: string; size: number }[];
  canEdit: boolean;
}) {
  const [snap, setSnap] = useState(initial);
  const { campaign: c, roster, budget } = snap;
  const open = c.status === "draft" || c.status === "active";
  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href={`/w/${ws}/creators/campaigns`}
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
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/w/${ws}/creators/campaigns/${c.id}/results`}
            className="inline-flex min-h-9 items-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium hover:bg-[var(--surface-2)]"
            data-testid="campaign-results-link"
          >
            Results and tracking
          </Link>
          <StatusButtons
            ws={ws}
            id={c.id}
            status={c.status as CampaignStatus}
            canEdit={canEdit}
            onSnapshot={setSnap}
          />
        </div>
      </div>
      {c.brief && (
        <p className="mt-3 max-w-prose whitespace-pre-line" data-testid="campaign-brief">
          {c.brief}
        </p>
      )}
      <div className="mt-4">
        <EditDetails
          ws={ws}
          id={c.id}
          canEdit={canEdit}
          onSnapshot={setSnap}
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
          <AddFromList ws={ws} id={c.id} canEdit={canEdit} lists={lists} onSnapshot={setSnap} />
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
                          href={`/w/${ws}/creators/${r.creatorId}`}
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
                      ws={ws}
                      campaignId={c.id}
                      editable={canEdit && open}
                      onSnapshot={setSnap}
                      brand={brand}
                      campaignName={c.name}
                      quota={snap.quota}
                      features={snap.features}
                      full={r}
                      row={{
                        creatorId: r.creatorId,
                        name: r.displayName,
                        status: r.status,
                        feeUsd: r.feeUsd,
                        note: r.note,
                        suggestedFee: r.suggestedFee,
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
