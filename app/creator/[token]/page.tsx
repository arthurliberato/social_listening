import { PortalView } from "@/components/creators/portal/PortalView";
import { markPortalViewed } from "@/lib/creators/outreach";
import { isToken } from "@/lib/creators/outreach-flow";
import { portalViewOf } from "@/lib/creators/portal-extras";
import { portalFor } from "@/lib/creators/outreach";

export const metadata = { title: "Your invitation · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function CreatorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = isToken(token) ? await portalViewOf(token) : null;
  if (!view)
    return (
      <div data-testid="portal-missing">
        <h1 className="text-[30px] font-semibold leading-[38px]">We can&apos;t find that page</h1>
        <p className="mt-2 text-[var(--text-muted)]">
          The link may be mistyped or out of date. Check the email you were sent, or ask the brand
          to send it again.
        </p>
      </div>
    );
  // "First opened" is recorded once, from the same record the page was built from.
  const p = await portalFor(token);
  if (p) await markPortalViewed(p);
  return <PortalView token={token} initial={view} />;
}
