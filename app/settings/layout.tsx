import Link from "next/link";
import { redirect } from "next/navigation";
import { SettingsNav } from "@/components/billing/SettingsNav";
import { ToastProvider } from "@/components/ui/toast";
import { requireUser } from "@/lib/auth/session";
import { billingScope } from "@/lib/billing/context";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!user.emailVerifiedAt) redirect("/verify");
  const scope = await billingScope(user.id);
  return (
    <ToastProvider>
      <div className="min-h-screen" data-testid="settings">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-[var(--primary)] focus:px-3 focus:py-2 focus:text-[var(--primary-contrast)]"
        >
          Skip to main content
        </a>
        <header
          className="flex h-14 items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4"
          role="banner"
        >
          <span className="font-semibold">Ripplewise</span>
          <span className="text-[var(--text-muted)]">Settings</span>
          {scope && (
            <Link
              href={`/w/${scope.workspaceSlug}/home`}
              className="ml-auto text-sm underline"
              data-testid="back-to-workspace"
            >
              Back to {scope.workspaceName}
            </Link>
          )}
        </header>
        <div className="mx-auto grid max-w-6xl gap-6 p-6 sm:grid-cols-[180px_minmax(0,1fr)]">
          <SettingsNav canManage={!!scope?.canManage} />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
