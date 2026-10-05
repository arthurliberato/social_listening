import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { db, queries } from "@/db/client";
import { AskPanel } from "@/components/ai/AskPanel";
import { aiQuota } from "@/lib/ai/quota";
import { recentAnswers, type Citation } from "@/lib/ai/service";
import { requireWorkspace } from "@/lib/auth/session";
import { accountPlan } from "@/lib/queries";

export const metadata = { title: "Ask AI · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function AskPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const { ws } = await requireWorkspace(slug);
  const { accountId, tier } = await accountPlan(ws.id);
  const [quota, history, [live]] = await Promise.all([
    aiQuota(accountId, tier),
    recentAnswers(ws.id, "ask", 10),
    db.select({ n: count() }).from(queries).where(eq(queries.workspaceId, ws.id)),
  ]);
  const noQueries = (live?.n ?? 0) === 0;
  const blockedReason = ws.locked
    ? "This account is read-only right now, so AI features are paused. Billing can restore access."
    : noQueries
      ? "Create a query first. Answers are drawn from the mentions your queries collect."
      : undefined;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-[30px] font-semibold leading-[38px]">Ask AI</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        Ask a question in plain words. Every answer links to the mentions behind it.
      </p>
      {noQueries && !ws.locked && (
        <p className="mt-2 text-sm" data-testid="ask-empty">
          <Link
            href={`/w/${slug}/queries/new`}
            className="text-[var(--primary)] underline underline-offset-2"
          >
            Create your first query
          </Link>{" "}
          to give Ask AI something to read.
        </p>
      )}
      <div className="mt-6">
        <AskPanel
          ws={slug}
          canAsk={!blockedReason}
          blockedReason={blockedReason}
          quota={{ used: quota.used, limit: quota.limit }}
          history={history.map((h) => ({
            id: h.id,
            prompt: h.prompt,
            answer: h.answer,
            citations: h.citations as Citation[],
            provider: h.provider,
          }))}
        />
      </div>
    </div>
  );
}
