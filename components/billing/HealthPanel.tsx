import type { Latest } from "@/lib/scoring/latest";

const BAND = {
  healthy: { label: "Healthy", icon: "●", note: "Your team is getting steady value." },
  watch: { label: "Needs attention", icon: "▲", note: "Usage is thinning out in places." },
  at_risk: { label: "At risk", icon: "■", note: "Little recent activity. Worth a look." },
} as const;

/** For owners and admins: how the account is doing, in words, with the reasons behind the number. */
export function HealthPanel({ score }: { score: Latest | null }) {
  return (
    <section
      aria-labelledby="health-h"
      className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid="health-panel"
    >
      <h2 id="health-h" className="font-medium">
        Account health
      </h2>
      {!score ? (
        <p className="mt-1 text-sm text-[var(--text-muted)]" data-testid="health-empty">
          Health is calculated overnight. Check back tomorrow.
        </p>
      ) : (
        <>
          <p className="mt-1" data-testid="health-band" data-band={score.band}>
            <span aria-hidden className="mr-1">
              {BAND[score.band].icon}
            </span>
            <strong>{BAND[score.band].label}</strong>
            <span className="ml-2 tabular-nums text-[var(--text-muted)]">{score.health}/100</span>
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            {BAND[score.band].note} Updated {score.day}.
          </p>
          <details className="mt-2 text-sm">
            <summary className="min-h-6 cursor-pointer">What goes into this</summary>
            <ul className="mt-2 list-disc pl-5">
              {score.healthReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
