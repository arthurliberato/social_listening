import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Identity } from "@/components/analytics/Identity";
import { ProductHub } from "@/components/hub/ProductHub";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { UserMenu } from "@/components/shell/UserMenu";
import { requireUser, userWorkspaces } from "@/lib/auth/session";
import { PRODUCT_COOKIE, isProductKey } from "@/lib/products";

export const metadata = { title: "Choose a product · Ripplewise" };
export const dynamic = "force-dynamic";

/** Where everyone lands after signing in: a split screen with one half per product. */
export default async function HubPage() {
  const user = await requireUser();
  if (!user.emailVerifiedAt) redirect("/verify");
  if (!user.onboardingCompletedAt) redirect("/onboarding");
  const all = await userWorkspaces(user.id);
  if (all.length === 0) redirect("/onboarding");
  // Client viewers only ever see dashboards and reports, so there is no choice to make.
  const staff = all.filter((w) => w.role !== "client_viewer");
  if (staff.length === 0) redirect(`/w/${all[0]!.slug}/dashboards`);
  const lastRaw = (await cookies()).get(PRODUCT_COOKIE)?.value;
  const canManageBilling = staff.some((w) => w.role === "owner" || w.role === "admin");
  return (
    <div className="flex h-screen flex-col">
      <Identity userId={user.id} accountId={staff[0]!.accountId} workspaceId={staff[0]!.id} />
      <header
        role="banner"
        className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4"
      >
        <span className="font-semibold" data-testid="brand-name">
          Ripplewise
        </span>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <UserMenu name={user.name} canManageBilling={canManageBilling} isClient={false} />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col">
        <h1 className="sr-only">Choose a product</h1>
        <ProductHub
          workspaces={staff.map((w) => ({ slug: w.slug, name: w.name }))}
          last={isProductKey(lastRaw) ? lastRaw : null}
        />
      </main>
    </div>
  );
}
