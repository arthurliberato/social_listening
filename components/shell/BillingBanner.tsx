import Link from "next/link";
import { GRACE_DAYS } from "@/lib/billing/pricing";

const day = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;

interface Acct {
  billingStatus: string;
  trialEndAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  nextRetryAt: Date | null;
}

/** One line that says where the account stands and what to do about it. Quiet when everything is fine. */
export function BillingBanner({
  acct,
  canManage,
  now,
}: {
  acct: Acct;
  canManage: boolean;
  now: Date;
}) {
  const link = (href: string, text: string) =>
    canManage ? (
      <Link href={href} className="font-medium underline" data-testid="billing-banner-link">
        {text}
      </Link>
    ) : (
      <span>Ask a workspace owner to take care of it.</span>
    );
  let tone: "info" | "warn" | "danger" | null = null;
  let body: React.ReactNode = null;

  switch (acct.billingStatus) {
    case "trialing": {
      if (!acct.trialEndAt) return null;
      const left = Math.max(0, Math.ceil((acct.trialEndAt.getTime() - now.getTime()) / DAY));
      tone = left <= 3 ? "warn" : "info";
      body = (
        <>
          Your free trial ends in {left} day{left === 1 ? "" : "s"} ({day(acct.trialEndAt)}).{" "}
          {link("/upgrade?from=trial_banner", "Choose a plan")}
        </>
      );
      break;
    }
    case "grace": {
      const ends = new Date((acct.trialEndAt?.getTime() ?? now.getTime()) + GRACE_DAYS * DAY);
      tone = "warn";
      body = (
        <>
          Your trial has ended. Choose a plan by {day(ends)} to keep collecting mentions; after that
          your workspace becomes read-only. {link("/upgrade?from=trial_banner", "Choose a plan")}
        </>
      );
      break;
    }
    case "past_due":
      tone = "warn";
      body = (
        <>
          We couldn&apos;t charge your card.
          {acct.nextRetryAt ? ` We'll try again on ${day(acct.nextRetryAt)}.` : ""} Nothing is
          switched off yet. {link("/settings/billing", "Update your card")}
        </>
      );
      break;
    case "locked":
    case "canceled":
      tone = "danger";
      body = (
        <>
          Your workspace is read-only: collection, alerts and scheduled reports are paused. You can
          still view and export everything.{" "}
          {link(
            acct.billingStatus === "locked" ? "/upgrade?from=locked" : "/upgrade?from=canceled",
            "Choose a plan to switch it back on",
          )}
        </>
      );
      break;
    case "active":
      if (acct.cancelAtPeriodEnd && acct.currentPeriodEnd) {
        tone = "info";
        body = (
          <>
            Your plan ends on {day(acct.currentPeriodEnd)}.{" "}
            {link("/settings/billing", "Resume your plan")}
          </>
        );
      }
      break;
  }
  if (!tone) return null;
  const color =
    tone === "danger" ? "var(--danger)" : tone === "warn" ? "var(--warning)" : "var(--border)";
  return (
    <p
      role="status"
      data-testid="billing-banner"
      data-status={acct.billingStatus}
      className="border-b px-4 py-2 text-sm"
      style={{ borderColor: color, color: tone === "info" ? "var(--text)" : color }}
    >
      {body}
    </p>
  );
}
