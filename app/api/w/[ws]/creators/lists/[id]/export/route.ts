import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, exportsLog } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { userWorkspaces } from "@/lib/auth/session";
import { toCsv } from "@/lib/csv";
import { getList } from "@/lib/creators/service";
import { accountPlan } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** CSV of a creator list. A plan feature, checked here as well as in the UI. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ws: string; id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  const { ws: slug, id } = await params;
  const ws = (await userWorkspaces(session.user.id)).find((w) => w.slug === slug);
  if (!ws || ws.role === "client_viewer") return new NextResponse("Forbidden", { status: 403 });
  const { plan } = await accountPlan(ws.id);
  if (!plan.features.creatorExport)
    return new NextResponse("Creator list exports aren't on your plan", { status: 402 });
  const data = await getList(ws.id, id);
  if (!data) return new NextResponse("Not found", { status: 404 });

  const csv = toCsv(
    [
      "handle",
      "name",
      "platform",
      "niche",
      "country",
      "followers",
      "engagement_rate_pct",
      "avg_views",
      "authenticity_score",
      "fake_followers_pct",
      "brand_safety",
      "est_rate_usd",
      "note",
    ],
    data.items.map((c) => [
      `@${c.handle}`,
      c.displayName,
      c.platform,
      c.niche,
      c.country,
      c.followers,
      c.engagementRate,
      c.avgViews,
      c.authenticityScore,
      c.fakeFollowerPct,
      c.brandSafety,
      c.ratePerPostUsd,
      c.note,
    ]),
  );
  await db.insert(exportsLog).values({
    workspaceId: ws.id,
    userId: session.user.id,
    kind: "creators",
    format: "csv",
    label: `Creator list: ${data.list.name.slice(0, 60)}`,
    rowCount: data.items.length,
  });
  await trackServer(
    "Creator List Exported",
    { userId: session.user.id, workspaceId: ws.id },
    { list_id: id, creator_count: data.items.length, format: "csv" },
  );
  const safeName =
    data.list.name
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "list";
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="creators-${safeName}.csv"`,
    },
  });
}
