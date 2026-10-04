"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { track } from "@/lib/analytics/client";
import {
  mrrCents,
  money,
  periodPriceCents,
  YEARLY_MONTHS,
  type Interval,
} from "@/lib/billing/pricing";
import { PAYWALLS, isPaywallTrigger } from "@/lib/billing/paywalls";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";

const ORDER: PlanTier[] = ["starter", "growth", "agency", "enterprise"];
const rank = (t: PlanTier) => ORDER.indexOf(t);

export interface Current {
  tier: PlanTier;
  interval: Interval;
  status: string;
}

function features(t: PlanTier): string[] {
  const p = PLANS[t];
  const history =
    p.historyDays >= 365
      ? `${Math.round(p.historyDays / 365)} year${p.historyDays >= 730 ? "s" : ""}`
      : `${p.historyDays} days`;
  const out = [
    `${p.activeQueries} active queries`,
    `${p.mentionsPerMonth.toLocaleString()} mentions a month`,
    `${p.seats} seat${p.seats === 1 ? "" : "s"}`,
    `${p.workspaces.toLocaleString()} workspace${p.workspaces === 1 ? "" : "s"}`,
    `${history} of history`,
    p.refresh === "realtime"
      ? "Refreshed every 5 minutes"
      : p.refresh === "hourly"
        ? "Refreshed hourly"
        : "Refreshed twice a day",
    `${p.alerts.toLocaleString()} alerts`,
  ];
  if (p.features.sentimentAlerts) out.push("Negative-sentiment alerts");
  if (p.features.crisisRoom) out.push("Crisis Rooms");
  if (p.features.scheduledReports) out.push("Scheduled reports");
  if (p.features.shareOfVoice) out.push("Share of voice and emotion widgets");
  if (p.features.publicShareLinks) out.push("Public share links");
  if (p.features.whiteLabel) out.push("White-label reports");
  if (p.features.auditLog) out.push("Audit log");
  if (p.features.sso) out.push("Single sign-on");
  if (p.features.api) out.push("API access");
  return out;
}

export function PlanChooser({
  authed,
  canManage,
  current,
  from,
  recommended,
}: {
  authed: boolean;
  canManage: boolean;
  current: Current | null;
  from: string | null;
  recommended: PlanTier | null;
}) {
  const [interval, setInterval] = useState<Interval>(current?.interval ?? "monthly");
  const paid = !!current && (current.status === "active" || current.status === "past_due");
  const why = isPaywallTrigger(from) ? PAYWALLS[from] : null;

  useEffect(() => {
    track("Pricing Page Viewed", { billing_interval: "monthly", entry_point: from ?? "direct" });
  }, [from]);

  const choose = (to: PlanTier) =>
    track("Upgrade Started", {
      paywall_trigger: from ?? "plans_page",
      from_plan: current?.tier ?? null,
      to_plan: to,
      billing_interval: interval,
    });

  return (
    <div>
      {why && (
        <p
          role="status"
          className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
          data-testid="upgrade-why"
        >
          {why}.
          {recommended ? ` ${PLANS[recommended].label} is the smallest plan that fixes that.` : ""}
        </p>
      )}
      <fieldset
        className="mt-6 inline-flex rounded-md border border-[var(--border)] p-0.5"
        data-testid="interval-toggle"
      >
        <legend className="sr-only">Billing period</legend>
        {(["monthly", "yearly"] as Interval[]).map((i) => (
          <label
            key={i}
            className={`cursor-pointer rounded px-3 py-1.5 text-sm ${interval === i ? "bg-[var(--primary)] text-[var(--primary-contrast)]" : ""}`}
          >
            <input
              type="radio"
              name="interval"
              value={i}
              checked={interval === i}
              onChange={() => {
                setInterval(i);
                track("Plan Compare Toggled", { billing_interval: i });
              }}
              className="sr-only"
              data-testid={`interval-${i}`}
            />
            {i === "monthly" ? "Monthly" : `Yearly (${12 - YEARLY_MONTHS} months free)`}
          </label>
        ))}
      </fieldset>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ORDER.map((t) => {
          const p = PLANS[t];
          const price = periodPriceCents(t, interval);
          const isCurrent = paid && current!.tier === t && current!.interval === interval;
          const href = `/settings/billing/checkout?plan=${t}&interval=${interval}${from ? `&from=${from}` : ""}`;
          const label = !authed
            ? "Start 14-day free trial"
            : paid
              ? rank(t) > rank(current!.tier) || (t === current!.tier && interval === "yearly")
                ? `Upgrade to ${p.label}`
                : `Switch to ${p.label}`
              : `Choose ${p.label}`;
          const btn =
            "mt-auto inline-flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-medium";
          return (
            <li
              key={t}
              className={`flex flex-col rounded-lg border bg-[var(--surface)] p-4 ${recommended === t ? "border-[var(--primary)] ring-2 ring-[var(--primary)]" : "border-[var(--border)]"}`}
              data-testid={`plan-${t}`}
              data-recommended={recommended === t || undefined}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{p.label}</h2>
                {recommended === t && (
                  <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-xs font-medium text-[var(--primary-contrast)]">
                    Recommended
                  </span>
                )}
              </div>
              <p className="mt-1 text-3xl font-semibold" data-testid={`price-${t}`}>
                {price === null
                  ? "Custom"
                  : money(interval === "yearly" ? mrrCents(t, interval) : price)}
                {price !== null && (
                  <span className="text-sm font-normal text-[var(--text-muted)]"> / month</span>
                )}
              </p>
              <p className="min-h-5 text-xs text-[var(--text-muted)]">
                {price !== null && interval === "yearly"
                  ? `${money(price)} billed yearly`
                  : price !== null
                    ? "Billed monthly"
                    : "Quoted for your team"}
              </p>
              <ul className="my-4 flex flex-col gap-1.5 text-sm">
                {features(t).map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden className="text-[var(--text-muted)]">
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              {t === "enterprise" ? (
                <a
                  href={`/contact-sales?entry=${authed ? "upgrade_page" : "pricing_enterprise"}`}
                  className={`${btn} border border-[var(--border)] hover:bg-[var(--surface-2)]`}
                  data-testid="cta-enterprise"
                >
                  Talk to sales
                </a>
              ) : !authed ? (
                <Link
                  href={`/signup?plan=${t}`}
                  className={`${btn} bg-[var(--primary)] text-[var(--primary-contrast)]`}
                  data-testid={`cta-${t}`}
                >
                  {label}
                </Link>
              ) : !canManage ? (
                <span
                  className={`${btn} border border-dashed border-[var(--border)] text-[var(--text-muted)]`}
                  data-testid={`cta-${t}`}
                >
                  Ask a workspace owner
                </span>
              ) : isCurrent ? (
                <span
                  className={`${btn} border border-[var(--border)] text-[var(--text-muted)]`}
                  data-testid={`cta-${t}`}
                  aria-disabled="true"
                >
                  Your current plan
                </span>
              ) : (
                <Link
                  href={href}
                  onClick={() => choose(t)}
                  className={`${btn} ${recommended === t || !paid ? "bg-[var(--primary)] text-[var(--primary-contrast)]" : "border border-[var(--border)] hover:bg-[var(--surface-2)]"}`}
                  data-testid={`cta-${t}`}
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-sm text-[var(--text-muted)]">
        Every plan starts with a 14-day free trial, no card needed. Change or cancel any time from
        Billing; if you cancel, you keep access until the end of the period you paid for.
      </p>
    </div>
  );
}
