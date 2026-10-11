// Serving an uploaded file back: the bytes, with headers that make it safe to open.
import { and, eq } from "drizzle-orm";
import { campaignContent, campaignContentFiles, db } from "@/db/client";
import { downloadHeaders, sniffKind } from "./content-files";

const gone = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** The file for one version of a creator's content on a campaign, or a plain 404. */
export async function contentFileResponse(
  campaignId: string,
  creatorId: number,
  version: number,
): Promise<Response> {
  if (!Number.isInteger(version) || version < 1 || !Number.isInteger(creatorId)) return gone();
  const [row] = await db
    .select({ name: campaignContent.fileName, data: campaignContentFiles.data })
    .from(campaignContent)
    .innerJoin(campaignContentFiles, eq(campaignContentFiles.contentId, campaignContent.id))
    .where(
      and(
        eq(campaignContent.campaignId, campaignId),
        eq(campaignContent.creatorId, creatorId),
        eq(campaignContent.version, version),
      ),
    );
  if (!row?.name) return gone();
  // Serve what the bytes really are, not what was recorded at upload.
  const kind = sniffKind(row.data);
  if (!kind) return gone();
  return new Response(new Uint8Array(row.data), {
    headers: downloadHeaders(
      { name: row.name, mime: kind.mime, size: row.data.length },
      kind.inline,
    ),
  });
}
