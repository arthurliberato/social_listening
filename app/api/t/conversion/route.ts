import { NextResponse } from "next/server";
import { recordConversion } from "@/lib/creators/tracking";

export const dynamic = "force-dynamic";

/**
 * The postback the brand's own site calls when a visitor who arrived through a tracking link converts:
 *   GET or POST /api/t/conversion?cid=<rw_cid from the landing URL>&key=<campaign key>&value=<dollars>&ref=<order id>
 * It needs the campaign's secret key, accepts each order reference once, and only credits a click made in the last 30 days.
 */
async function handle(input: Record<string, unknown>) {
  const r = await recordConversion({
    cid: input.cid,
    key: input.key,
    value: input.value,
    ref: input.ref,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.reason }, { status: r.status });
  return NextResponse.json({ ok: true, duplicate: r.duplicate });
}

export async function GET(req: Request) {
  return handle(Object.fromEntries(new URL(req.url).searchParams));
}

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  let body: Record<string, unknown> = {};
  try {
    body = ct.includes("json")
      ? await req.json()
      : Object.fromEntries(await req.formData().then((f) => [...f.entries()]));
  } catch {
    return NextResponse.json({ ok: false, error: "unreadable body" }, { status: 400 });
  }
  // Query parameters work too, so a simple server-to-server call can use either style.
  return handle({ ...Object.fromEntries(new URL(req.url).searchParams), ...body });
}
