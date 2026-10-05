import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, queries } from "@/db/client";
import { QueryBuilder } from "@/components/listening/QueryBuilder";
import { requireWorkspace } from "@/lib/auth/session";
import { accountPlan, canEdit } from "@/lib/queries";

export const metadata = { title: "Edit query · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function EditQuery({
  params,
}: {
  params: Promise<{ ws: string; id: string }>;
}) {
  const { ws: slug, id } = await params;
  const { ws } = await requireWorkspace(slug);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const q = (
    await db
      .select()
      .from(queries)
      .where(and(eq(queries.id, id), eq(queries.workspaceId, ws.id)))
  )[0];
  if (!q) notFound();
  const { tier } = await accountPlan(ws.id);
  return (
    <QueryBuilder
      key={q.id}
      ws={slug}
      canEdit={canEdit(ws.role)}
      plan={tier}
      entryPoint="list"
      isFromTemplate={q.isFromTemplate}
      initial={{
        id: q.id,
        name: q.name,
        booleanText: q.booleanText,
        mode: q.builderMode as "guided" | "advanced",
        filters: { sources: q.sources, languages: q.languages, countries: q.countries },
        status: q.status as "live" | "paused" | "draft",
        backfillStatus: q.backfillStatus,
      }}
    />
  );
}
