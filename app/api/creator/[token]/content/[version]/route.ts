import { contentFileResponse } from "@/lib/creators/content-download";
import { portalFor } from "@/lib/creators/outreach";

export const dynamic = "force-dynamic";

/** A creator opening a file they uploaded. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; version: string }> },
) {
  const { token, version } = await params;
  const p = await portalFor(token);
  if (!p) return new Response("Not found", { status: 404 });
  return contentFileResponse(p.campaign.id, p.creator.id, Number(version));
}
