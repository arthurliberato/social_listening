import Link from "next/link";
import { NewListForm } from "@/components/creators/ListsPanel";
import { requireWorkspace } from "@/lib/auth/session";
import { workspaceLists } from "@/lib/creators/service";
import { accountListCount } from "@/lib/creators/service";
import { accountPlan, canEdit } from "@/lib/queries";
import { db, workspaces } from "@/db/client";
import { eq } from "drizzle-orm";

export const metadata = { title: "Creator lists · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function ListsPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const { ws } = await requireWorkspace(slug);
  const { accountId, plan } = await accountPlan(ws.id);
  const [lists, used] = await Promise.all([
    workspaceLists(ws.id),
    db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.accountId, accountId))
      .then((r) => accountListCount(r.map((w) => w.id))),
  ]);
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-[30px] font-semibold leading-[38px]">Creator lists</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        Shortlists of creators you&apos;re considering, for a campaign, a client or a launch.
      </p>
      <div className="mt-5">
        <NewListForm ws={slug} canEdit={canEdit(ws.role)} used={used} limit={plan.creatorLists} />
      </div>
      {lists.length === 0 ? (
        <div
          className="mt-6 rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
          data-testid="lists-empty"
        >
          <p className="font-medium">No lists yet.</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Create one above, or add creators to a new list straight from discovery.
          </p>
          <Link
            href={`/w/${slug}/creators`}
            className="mt-3 inline-block text-[var(--primary)] underline"
          >
            Discover creators
          </Link>
        </div>
      ) : (
        <ul
          className="mt-6 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]"
          data-testid="lists"
        >
          {lists.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between gap-3 p-4"
              data-testid="list-row"
            >
              <div>
                <Link
                  href={`/w/${slug}/creators/lists/${l.id}`}
                  className="font-medium text-[var(--primary)] underline underline-offset-2"
                >
                  {l.name}
                </Link>
                {l.description && (
                  <p className="text-sm text-[var(--text-muted)]">{l.description}</p>
                )}
              </div>
              <span className="text-sm tabular-nums text-[var(--text-muted)]">
                {l.size} creator{l.size === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
