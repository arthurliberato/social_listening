import { QueryBuilder } from "@/components/listening/QueryBuilder";
import { requireWorkspace } from "@/lib/auth/session";
import { accountPlan, canEdit } from "@/lib/queries";

export const metadata = { title: "New query · Ripplewise" };

export default async function NewQuery({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ entry?: string }>;
}) {
  const { ws: slug } = await params;
  const { entry } = await searchParams;
  const { ws } = await requireWorkspace(slug);
  const { tier } = await accountPlan(ws.id);
  return (
    <QueryBuilder
      ws={slug}
      canEdit={canEdit(ws.role)}
      plan={tier}
      entryPoint={entry ?? "direct"}
      isFromTemplate={false}
      initial={{
        name: "Untitled query",
        booleanText: "",
        mode: "guided",
        filters: { sources: [], languages: [], countries: [] },
        status: "draft",
      }}
    />
  );
}
