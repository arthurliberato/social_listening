import { redirect } from "next/navigation";
import { Identity } from "@/components/analytics/Identity";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { requireWorkspace } from "@/lib/auth/session";

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
  return (
    <div className="flex h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-[var(--primary)] focus:px-3 focus:py-2 focus:text-[var(--primary-contrast)]"
      >
        Skip to main content
      </a>
      <Identity userId={user.id} accountId={ws.accountId} workspaceId={ws.id} />
      <Topbar ws={ws.name} userName={user.name} />
      <div className="flex min-h-0 flex-1">
        <Sidebar ws={slug} />
        <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
