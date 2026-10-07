import Link from "next/link";
import { NewCampaignForm } from "@/components/creators/campaigns/NewCampaignForm";
import { requireWorkspace } from "@/lib/auth/session";
import { OBJECTIVE_LABEL, type Objective } from "@/lib/creators/campaign-flow";
import { accountActiveCampaigns, workspaceCampaigns } from "@/lib/creators/campaigns";
import { usd } from "@/lib/creators/labels";
import { accountPlan, canEdit } from "@/lib/queries";

export const metadata = { title: "Campaigns · Ripplewise" };
export const dynamic = "force-dynamic";

const STATUS_WORD = {
  draft: "Draft",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
} as const;

export default async function CampaignsPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const { ws } = await requireWorkspace(slug);
  const { accountId, plan } = await accountPlan(ws.id);
  const [list, used] = await Promise.all([
    workspaceCampaigns(ws.id),
    accountActiveCampaigns(accountId),
  ]);
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[30px] font-semibold leading-[38px]">Campaigns</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        Plan a campaign, bring in creators from your lists, and follow each one from invitation to
        payment.
      </p>
      <div className="mt-5">
        <NewCampaignForm
          ws={slug}
          canEdit={canEdit(ws.role)}
          used={used}
          limit={plan.activeCampaigns}
        />
      </div>
      {list.length === 0 ? (
        <div
          className="mt-6 rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
          data-testid="campaigns-empty"
        >
          <p className="font-medium">No campaigns yet.</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Create one above. You can add creators from a list once it exists.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="campaigns-table">
            <caption className="sr-only">Campaigns in this workspace</caption>
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                {["Campaign", "Status", "Objective", "Creators", "Committed", "Budget"].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-[var(--border)]"
                  data-testid="campaign-row"
                >
                  <th scope="row" className="px-2 py-2 font-normal">
                    <Link
                      href={`/w/${slug}/creators/campaigns/${c.id}`}
                      className="font-medium text-[var(--primary)] underline underline-offset-2"
                    >
                      {c.name}
                    </Link>
                  </th>
                  <td className="px-2 py-2">
                    {STATUS_WORD[c.status as keyof typeof STATUS_WORD] ?? c.status}
                  </td>
                  <td className="px-2 py-2">
                    {OBJECTIVE_LABEL[c.objective as Objective] ?? c.objective}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{c.creatorCount}</td>
                  <td className="px-2 py-2 tabular-nums">
                    {usd(c.budget.committed)}
                    {c.budget.over && (
                      <span className="ml-1 text-xs text-[var(--danger)]">(over budget)</span>
                    )}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{usd(c.budgetUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
