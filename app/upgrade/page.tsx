import { PLANS, type PlanTier } from "@/lib/entitlements/plans";

export const metadata = { title: "Plans · Ripplewise" };

const ORDER: PlanTier[] = ["starter", "growth", "agency", "enterprise"];

/** Read-only plan comparison. Checkout and plan changes arrive with the billing milestone. */
export default function Upgrade() {
  return (
    <main id="main" className="mx-auto max-w-5xl p-6">
      <h1 className="text-[30px] font-semibold leading-[38px]">Plans</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        Online checkout isn&apos;t available yet. Plan changes will be self-serve soon; Enterprise
        is quoted by our team.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ORDER.map((t) => {
          const p = PLANS[t];
          return (
            <section
              key={t}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
              data-testid={`plan-${t}`}
            >
              <h2 className="font-semibold">{p.label}</h2>
              <p className="text-2xl font-semibold">
                {p.priceMonthly === null ? "Custom" : `$${p.priceMonthly}`}
                <span className="text-sm font-normal text-[var(--text-muted)]">
                  {p.priceMonthly === null ? "" : "/mo"}
                </span>
              </p>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                <li>{p.activeQueries} active queries</li>
                <li>{p.mentionsPerMonth.toLocaleString()} mentions/month</li>
                <li>
                  {p.seats} seat{p.seats === 1 ? "" : "s"}
                </li>
                <li>
                  {p.workspaces} workspace{p.workspaces === 1 ? "" : "s"}
                </li>
                <li>
                  {p.historyDays >= 365
                    ? `${Math.round(p.historyDays / 365)} year${p.historyDays >= 730 ? "s" : ""}`
                    : `${p.historyDays} days`}{" "}
                  of history
                </li>
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
