import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { dashboards, dashboardViews, db, widgets, workspaces } from "@/db/client";
import { SharedDashboard } from "@/components/dashboards/SharedDashboard";
import type { DraftWidget } from "@/components/dashboards/DashboardGrid";
import { trackServer } from "@/lib/analytics/server";
import { isWidgetType, type WidgetConfig } from "@/lib/dashboards/catalog";
import { workspaceAccount } from "@/lib/dashboards/service";
import { effectiveBranding } from "@/lib/team/branding";
import { parseFilters } from "@/lib/mentions/filters";

export const metadata: Metadata = {
  title: "Shared dashboard · Ripplewise",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

function Unavailable() {
  return (
    <main id="main" className="mx-auto max-w-md p-10">
      <h1 className="text-[24px] font-semibold">This link isn&apos;t available</h1>
      <p className="mt-2 text-[var(--text-muted)]">
        The dashboard may no longer be shared, or the link was turned off. Ask whoever sent it for a
        new one.
      </p>
      <Link href="/login" className="mt-4 inline-block underline">
        Log in to Ripplewise
      </Link>
    </main>
  );
}

/** Public, read-only dashboard (/share/<token>): the executive-viewer path. */
export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return <Unavailable />;
  const dash = (await db.select().from(dashboards).where(eq(dashboards.publicToken, token)))[0];
  if (!dash) return <Unavailable />;
  const { plan } = await workspaceAccount(dash.workspaceId);
  if (!plan.features.publicShareLinks) return <Unavailable />;
  const [w] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, dash.workspaceId));
  const brand = await effectiveBranding(dash.workspaceId);
  const rows = await db
    .select()
    .from(widgets)
    .where(eq(widgets.dashboardId, dash.id))
    .orderBy(asc(widgets.y), asc(widgets.x));
  const f = parseFilters((await searchParams) as Record<string, string | string[] | undefined>);
  const draft: DraftWidget[] = rows
    .filter((r) => isWidgetType(r.type))
    .map((r) => ({
      id: r.id,
      type: r.type as DraftWidget["type"],
      title: r.title,
      config: r.config as WidgetConfig,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
    }));

  await db.insert(dashboardViews).values({ dashboardId: dash.id, userId: null });
  await trackServer(
    "Dashboard Viewed",
    { workspaceId: dash.workspaceId },
    { dashboard_type: "public", viewer_is_creator: false, widgets_count: draft.length },
  );

  return (
    <main id="main" className="mx-auto max-w-[1600px] p-6">
      <header
        className="mb-4"
        style={
          brand.accent ? { borderTop: `4px solid ${brand.accent}`, paddingTop: 12 } : undefined
        }
      >
        <p className="text-sm text-[var(--text-muted)]" data-testid="share-banner">
          Shared by {brand.displayName || w?.name} · read-only
        </p>
        <h1 className="text-[30px] font-semibold leading-[38px]" data-testid="dash-title">
          {dash.name}
        </h1>
        {dash.description && (
          <p className="max-w-[72ch] text-[var(--text-muted)]">{dash.description}</p>
        )}
      </header>
      <SharedDashboard
        token={token}
        widgets={draft}
        range={{ range: f.range, from: f.from, to: f.to }}
        historyDays={plan.historyDays}
      />
      <footer
        className="mt-8 border-t border-[var(--border)] pt-4 text-sm text-[var(--text-muted)]"
        data-testid="share-footer"
      >
        {brand.footerText && <p data-testid="brand-footer">{brand.footerText}</p>}
        {!brand.hidePoweredBy && (
          <p>
            Built with Ripplewise.{" "}
            <Link href="/signup" className="underline">
              Start a free trial
            </Link>
          </p>
        )}
      </footer>
    </main>
  );
}
