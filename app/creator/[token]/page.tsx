import { PortalView } from "@/components/creators/portal/PortalView";
import { markPortalViewed, portalFor, portalView } from "@/lib/creators/outreach";
import { isToken } from "@/lib/creators/outreach-flow";

export const metadata = { title: "Your invitation · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function CreatorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const p = isToken(token) ? await portalFor(token) : null;
  if (!p)
    return (
      <div data-testid="portal-missing">
        <h1 className="text-[30px] font-semibold leading-[38px]">We can&apos;t find that page</h1>
        <p className="mt-2 text-[var(--text-muted)]">
          The link may be mistyped or out of date. Check the email you were sent, or ask the brand
          to send it again.
        </p>
      </div>
    );
  await markPortalViewed(p);
  return <PortalView token={token} initial={portalView(p)} />;
}
