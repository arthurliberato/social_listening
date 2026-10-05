import { redirect } from "next/navigation";
import { Identity } from "@/components/analytics/Identity";
import { GlobalShortcuts } from "@/components/shell/GlobalShortcuts";
import { ToastProvider } from "@/components/ui/toast";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { requireWorkspace, userWorkspaces } from "@/lib/auth/session";
import { effectiveBranding } from "@/lib/team/branding";
import { getMentionUsage } from "@/lib/usage";
import { desc, eq, and, count } from "drizzle-orm";
import { accounts, alertEvents, alertRules, db } from "@/db/client";
import { BillingBanner } from "@/components/shell/BillingBanner";
import { simNow } from "@/lib/simclock";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ ws: string }>;
}) {
  const { ws: slug } = await params;
  const { user, ws } = await requireWorkspace(slug);
  if (!user.emailVerifiedAt) redirect("/verify");
  if (!user.onboardingCompletedAt) redirect("/onboarding");
  const isClient = ws.realRole === "client_viewer";
  const [usage, myWorkspaces, brand] = await Promise.all([
    getMentionUsage(ws.accountId),
    userWorkspaces(user.id),
    isClient ? effectiveBranding(ws.id) : Promise.resolve({ displayName: "" }),
  ]);
  const [acct] = await db.select().from(accounts).where(eq(accounts.id, ws.accountId));
  const [[unread], recent] = await Promise.all([
    db
      .select({ n: count() })
      .from(alertEvents)
      .where(and(eq(alertEvents.workspaceId, ws.id), eq(alertEvents.status, "new"))),
    db
      .select({
        id: alertEvents.id,
        title: alertRules.name,
        summary: alertEvents.summary,
        firedAt: alertEvents.firedAt,
        status: alertEvents.status,
      })
      .from(alertEvents)
      .innerJoin(alertRules, eq(alertRules.id, alertEvents.ruleId))
      .where(eq(alertEvents.workspaceId, ws.id))
      .orderBy(desc(alertEvents.firedAt))
      .limit(5),
  ]);
  return (
    <ToastProvider>
      <div className="flex h-screen flex-col" data-plan={acct?.planTier}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-[var(--primary)] focus:px-3 focus:py-2 focus:text-[var(--primary-contrast)]"
        >
          Skip to main content
        </a>
        <Identity userId={user.id} accountId={ws.accountId} workspaceId={ws.id} />
        <GlobalShortcuts ws={slug} />
        <Topbar
          ws={ws.name}
          slug={slug}
          userName={user.name}
          usage={usage}
          unreadAlerts={unread?.n ?? 0}
          recentAlerts={recent.map((r) => ({ ...r, firedAt: r.firedAt.toISOString() }))}
          now={simNow().getTime()}
          canManageBilling={ws.realRole === "owner" || ws.realRole === "admin"}
          isClient={isClient}
          brandName={brand.displayName}
          workspaces={myWorkspaces.map((w) => ({ id: w.id, slug: w.slug, name: w.name }))}
          currentId={ws.id}
        />
        {!isClient && (
          <BillingBanner
            acct={acct!}
            canManage={ws.realRole === "owner" || ws.realRole === "admin"}
            now={simNow()}
          />
        )}
        {!isClient && usage.pct >= 80 && (
          <p
            role="status"
            data-testid="quota-banner"
            className={`border-b px-4 py-2 text-sm ${usage.pct >= 100 ? "border-[var(--danger)] text-[var(--danger)]" : "border-[var(--warning)] text-[var(--warning)]"}`}
          >
            {usage.pct >= 100
              ? "You've used all your monthly mentions. New mentions have stopped collecting; existing ones stay visible."
              : `You've used ${usage.pct}% of your monthly mentions.`}{" "}
            <a href="/upgrade?from=mention_quota" className="underline">
              See plans
            </a>
          </p>
        )}
        <div className="flex min-h-0 flex-1">
          <Sidebar ws={slug} clientOnly={isClient} />
          <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
