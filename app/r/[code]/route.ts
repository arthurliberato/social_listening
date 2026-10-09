import { NextResponse } from "next/server";
import { recordClick } from "@/lib/creators/tracking";

export const dynamic = "force-dynamic";

const GONE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>This link isn't active</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><main><h1>This link isn't active</h1><p>The campaign behind it has ended, or the link was mistyped. If you got it from someone, ask them for a new one.</p></main></body></html>`;

/** A creator's tracking link: record the visit, then send the person on to the campaign's page. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ua = req.headers.get("user-agent") ?? "";
  let hit: Awaited<ReturnType<typeof recordClick>> = null;
  try {
    hit = await recordClick(code, { ip, ua });
  } catch (e) {
    // A recording failure must not strand a visitor; but without a destination there is nowhere to send them.
    console.error("[tracking] click failed", e);
  }
  if (!hit)
    return new Response(GONE, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  return NextResponse.redirect(hit.redirectTo, {
    status: 302,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
