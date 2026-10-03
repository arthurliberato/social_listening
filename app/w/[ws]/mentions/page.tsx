import { MentionsFeed } from "@/components/listening/feed/MentionsFeed";
import { requireWorkspace } from "@/lib/auth/session";
import { loadFeed } from "@/lib/mentions/feed";
import { parseFilters } from "@/lib/mentions/filters";
import { accountPlan, canEdit } from "@/lib/queries";
import { listSavedViews, workspaceTags } from "./actions";

export const metadata = { title: "Mentions · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function MentionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ws: slug } = await params;
  const sp = await searchParams;
  const { user, ws } = await requireWorkspace(slug);
  const filters = parseFilters(sp);
  const { tier, plan } = await accountPlan(ws.id);
  const [feed, savedViews, tags] = await Promise.all([
    loadFeed({
      workspaceId: ws.id,
      userId: user.id,
      filters,
      historyDays: plan.historyDays,
      markSeen: true,
    }),
    listSavedViews(slug),
    workspaceTags(slug),
  ]);
  const from = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const entry = from === "alert" || from === "email" ? from : "nav";
  return (
    <MentionsFeed
      ws={slug}
      canEdit={canEdit(ws.role)}
      tier={tier}
      historyDays={plan.historyDays}
      feed={feed}
      filters={filters}
      savedViews={savedViews}
      tags={tags}
      entryPoint={entry}
    />
  );
}
