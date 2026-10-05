import { recordOpen } from "@/lib/email/tracking";

export const dynamic = "force-dynamic";

// 1x1 transparent GIF.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await recordOpen(id);
  } catch (e) {
    console.error("[tracking] open failed", e);
  }
  return new Response(PIXEL, {
    headers: { "content-type": "image/gif", "cache-control": "no-store, max-age=0" },
  });
}
