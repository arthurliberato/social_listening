import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { EVENTS, type EventName } from "@/lib/analytics/events";
import { trackServer } from "@/lib/analytics/server";

const Body = z.object({
  name: z.string(),
  props: z.record(z.string(), z.unknown()).default({}),
  route: z.string().max(300).optional(),
  ui_theme: z.string().max(10).optional(),
  device_id: z.string().max(100).optional(),
  forwarded: z.boolean().optional(),
  workspace_id: z.string().uuid().nullable().optional(),
});

/** Receives client-side events: mirrors them to Postgres and fans out per the tracking plan. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !(parsed.data.name in EVENTS))
    return NextResponse.json({ ok: false }, { status: 400 });
  const name = parsed.data.name as EventName;
  if (EVENTS[name].side !== "client") return NextResponse.json({ ok: false }, { status: 400 });
  const session = await auth();
  // Only keep properties declared for this event in the tracking plan.
  const allowed = new Set<string>(EVENTS[name].properties);
  const props = Object.fromEntries(
    Object.entries(parsed.data.props).filter(([k]) => allowed.has(k)),
  );
  await trackServer(
    name,
    { userId: session?.user?.id ?? null, workspaceId: parsed.data.workspace_id ?? null },
    props as never,
    {
      route: parsed.data.route,
      ui_theme: parsed.data.ui_theme,
      device_id: parsed.data.device_id,
      forwarded: parsed.data.forwarded,
      side: "client",
    },
  );
  return NextResponse.json({ ok: true });
}
