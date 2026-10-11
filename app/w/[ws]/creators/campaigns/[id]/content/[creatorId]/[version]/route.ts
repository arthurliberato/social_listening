import { requireWorkspace } from "@/lib/auth/session";
import { getCampaign } from "@/lib/creators/campaigns";
import { contentFileResponse } from "@/lib/creators/content-download";

export const dynamic = "force-dynamic";

/** A member of the workspace opening a file a creator uploaded for one of its campaigns. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ws: string; id: string; creatorId: string; version: string }> },
) {
  const { ws: slug, id, creatorId, version } = await params;
  const { ws } = await requireWorkspace(slug);
  const campaign = await getCampaign(ws.id, id);
  if (!campaign) return new Response("Not found", { status: 404 });
  return contentFileResponse(id, Number(creatorId), Number(version));
}
