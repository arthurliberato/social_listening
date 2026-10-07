import { notFound } from "next/navigation";
import { CampaignView } from "@/components/creators/campaigns/CampaignView";
import { requireWorkspace } from "@/lib/auth/session";
import { getCampaign, snapshotOf } from "@/lib/creators/campaigns";
import { workspaceLists } from "@/lib/creators/service";
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
  return (
    <CampaignView
      ws={slug}
      initial={snapshotOf(data)}
      canEdit={canEdit(ws.role)}
      lists={lists.map((l) => ({ id: l.id, name: l.name, size: l.size }))}
    />
  );
}
