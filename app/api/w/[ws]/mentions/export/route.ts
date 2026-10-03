import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { trackServer } from "@/lib/analytics/server";
import { userWorkspaces } from "@/lib/auth/session";
import { accountPlan } from "@/lib/queries";
import { loadFeed } from "@/lib/mentions/feed";
import { parseFilters } from "@/lib/mentions/filters";

export const dynamic = "force-dynamic";
const MAX_ROWS = 10_000;

const cell = (v: unknown) => {
  let s = String(v ?? "");
  // Neutralise spreadsheet formula injection from user-generated text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/** CSV of the current filtered feed (up to 10,000 rows). */
export async function GET(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  const { ws: slug } = await params;
  const ws = (await userWorkspaces(session.user.id)).find((w) => w.slug === slug);
  if (!ws) return new NextResponse("Forbidden", { status: 403 });
  const { plan } = await accountPlan(ws.id);
  const filters = parseFilters(new URL(req.url).searchParams);
  const feed = await loadFeed({
    workspaceId: ws.id,
    userId: session.user.id,
    filters,
    historyDays: plan.historyDays,
    limit: MAX_ROWS,
  });

  const header = [
    "id",
    "published_at",
    "source",
    "content_type",
    "author",
    "followers",
    "language",
    "country",
    "sentiment",
    "classifier_sentiment",
    "edited",
    "tags",
    "flagged",
    "likes",
    "shares",
    "comments",
    "views",
    "reach",
    "title",
    "text",
    "url",
  ];
  const lines = [header.join(",")];
  for (const r of feed.rows) {
    lines.push(
      [
        r.id,
        r.publishedAt,
        r.sourceType,
        r.contentType,
        `@${r.author.handle}`,
        r.author.followers,
        r.lang,
        r.country,
        r.sentiment,
        r.predicted,
        r.overridden,
        r.tags.join("|"),
        r.flagged,
        r.likes,
        r.shares,
        r.comments,
        r.views,
        r.reach,
        r.title,
        r.text,
        r.url,
      ]
        .map(cell)
        .join(","),
    );
  }
  await trackServer(
    "Export Downloaded",
    { userId: session.user.id, workspaceId: ws.id },
    { format: "csv", row_count: feed.rows.length },
  );
  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="mentions-${slug}.csv"`,
    },
  });
}
