import { redirect } from "next/navigation";
import { Identity } from "@/components/analytics/Identity";
import { GlobalShortcuts } from "@/components/shell/GlobalShortcuts";
import { ToastProvider } from "@/components/ui/toast";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { requireWorkspace } from "@/lib/auth/session";
import { getMentionUsage } from "@/lib/usage";

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
  const usage = await getMentionUsage(ws.accountId);
  return (
    <ToastProvider>
      <div className="flex h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-[var(--primary)] focus:px-3 focus:py-2 focus:text-[var(--primary-contrast)]"
        >
          Skip to main content
        </a>
        <Identity userId={user.id} accountId={ws.accountId} workspaceId={ws.id} />
        <GlobalShortcuts ws={slug} />
        <Topbar ws={ws.name} userName={user.name} usage={usage} />
        {usage.pct >= 80 && (
          <p
            role="status"
            data-testid="quota-banner"
            className={`border-b px-4 py-2 text-sm ${usage.pct >= 100 ? "border-[var(--danger)] text-[var(--danger)]" : "border-[var(--warning)] text-[var(--warning)]"}`}
          >
            {usage.pct >= 100
              ? "You've used all your monthly mentions. New mentions have stopped collecting; existing ones stay visible."
              : `You've used ${usage.pct}% of your monthly mentions.`}{" "}
            <a href="/upgrade" className="underline">
              See plans
            </a>
          </p>
        )}
        <div className="flex min-h-0 flex-1">
          <Sidebar ws={slug} />
          <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
