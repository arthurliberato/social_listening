import { NextResponse } from "next/server";
import { APP_URL } from "@/lib/email/service";
import { recordClick } from "@/lib/email/tracking";

export const dynamic = "force-dynamic";

/** Tracked link: records the click, then sends the reader on. Only in-app paths are allowed as targets. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let path: string | null = null;
  try {
    path = await recordClick(id, new URL(req.url).searchParams.get("to"));
  } catch (e) {
    console.error("[tracking] click failed", e);
  }
  return NextResponse.redirect(new URL(path ?? "/", APP_URL), 302);
}
