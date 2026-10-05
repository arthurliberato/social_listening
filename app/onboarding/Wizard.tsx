"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { track } from "@/lib/analytics/client";
import {
  completeOnboarding,
  getQueryPreview,
  saveBrand,
  saveFirstQuery,
  saveGoals,
  saveRole,
  sendInvites,
  type StepResult,
} from "./actions";

const STEPS = ["role", "goals", "brand", "query", "invite"] as const;
const OPTIONAL = new Set(["goals", "invite"]);

const ROLES = [
  {
    id: "analyst",
    title: "Insights analyst",
    blurb: "Build precise queries and defensible numbers",
  },
  {
    id: "social",
    title: "Social media manager",
    blurb: "Track campaigns, find creators, respond fast",
  },
  {
    id: "comms",
    title: "Comms / PR lead",
    blurb: "Catch reputational spikes and brief executives",
  },
  { id: "agency", title: "Agency account lead", blurb: "Run listening for several clients" },
  { id: "exec", title: "Executive", blurb: "See what matters this week" },
  { id: "admin", title: "Admin / operations", blurb: "Seats, billing and security" },
];
const GOALS = [
  { id: "brand_monitoring", label: "Monitor my brand" },
  { id: "competitor", label: "Benchmark competitors" },
  { id: "campaign", label: "Measure a campaign" },
  { id: "crisis", label: "Detect and handle crises" },
  { id: "research", label: "Research a topic or market" },
];

export function Wizard({
  initialStep,
  initial,
}: {
  initialStep: number;
  initial: {
    role: string | null;
    goals: string[];
    brand: { brandName?: string; website?: string; handles?: string[]; competitors?: string[] };
  };
}) {
  const [step, setStep] = useState(Math.min(initialStep, STEPS.length - 1));
  const [role, setRole] = useState(initial.role ?? "");
  const [goals, setGoals] = useState<string[]>(initial.goals);
  const [brandName, setBrandName] = useState(initial.brand.brandName ?? "");
  const [website, setWebsite] = useState(initial.brand.website ?? "");
  const [handles, setHandles] = useState((initial.brand.handles ?? []).join(", "));
  const [competitors, setCompetitors] = useState<string[]>(initial.brand.competitors ?? []);
  const [compDraft, setCompDraft] = useState("");
  const [emails, setEmails] = useState("");
  const [preview, setPreview] = useState<{ booleanText: string; estimate: number } | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const startedAt = useRef(Date.now());
  const stepStarted = useRef(Date.now());
  const name = STEPS[step]!;

  useEffect(() => {
    stepStarted.current = Date.now();
    track("Onboarding Step Viewed", { step_name: name, step_index: step + 1 });
    if (name === "query") {
      setPreview(null);
      void getQueryPreview().then(setPreview);
    }
  }, [step, name]);

  function done(r: StepResult, extra: Record<string, number> = {}) {
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setError("");
    track("Onboarding Step Completed", {
      step_name: name,
      step_index: step + 1,
      duration_ms: Date.now() - stepStarted.current,
      ...extra,
    });
    return true;
  }

  function next() {
    start(async () => {
      if (name === "role") {
        if (!role) return setError("Pick the role that fits you best.");
        if (!done(await saveRole(role))) return;
      } else if (name === "goals") {
        if (!done(await saveGoals(goals))) return;
      } else if (name === "brand") {
        const h = handles
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        if (
          !done(await saveBrand({ brandName, website, handles: h, competitors }), {
            competitors_count: competitors.length,
          })
        )
          return;
      } else if (name === "query") {
        if (!done(await saveFirstQuery())) return;
      } else if (name === "invite") {
        const list = emails.split(/[,\s]+/).filter(Boolean);
        if (list.length) {
          if (!done(await sendInvites(list))) return;
        } else track("Onboarding Skipped", { step_name: name });
        await completeOnboarding(Date.now() - startedAt.current);
        return;
      }
      setStep((s) => s + 1);
    });
  }

  function skip() {
    track("Onboarding Skipped", { step_name: name });
    if (name === "invite") start(() => completeOnboarding(Date.now() - startedAt.current));
    else setStep((s) => s + 1);
  }

  return (
    <div
      className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6"
      data-testid="onboarding-wizard"
    >
      <nav aria-label="Progress" className="pt-4">
        <p className="text-sm text-[var(--text-muted)]" data-testid="onboarding-progress">
          Step {step + 1} of {STEPS.length}
        </p>
        <div
          className="mt-2 h-1.5 rounded-full bg-[var(--surface-2)]"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
        >
          <div
            className="h-full rounded-full bg-[var(--primary)]"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </nav>

      <main id="main" className="flex flex-1 flex-col gap-5">
        {name === "role" && (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-[24px] font-semibold leading-8">
              What best describes your role?
            </legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {ROLES.map((r) => (
                <label
                  key={r.id}
                  className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-4 ${role === r.id ? "border-[var(--primary)] bg-[var(--surface-2)]" : "border-[var(--border)] bg-[var(--surface)]"}`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name="role"
                      value={r.id}
                      checked={role === r.id}
                      onChange={() => setRole(r.id)}
                      data-testid={`role-${r.id}`}
                    />
                    {r.title}
                  </span>
                  <span className="text-sm text-[var(--text-muted)]">{r.blurb}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {name === "goals" && (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-[24px] font-semibold leading-8">
              What do you want to do first?
            </legend>
            <p className="text-[var(--text-muted)]">
              Pick any that apply. This tailors your starting dashboards.
            </p>
            {GOALS.map((g) => (
              <label key={g.id} className="flex min-h-9 items-center gap-2">
                <input
                  type="checkbox"
                  checked={goals.includes(g.id)}
                  onChange={(e) =>
                    setGoals(e.target.checked ? [...goals, g.id] : goals.filter((x) => x !== g.id))
                  }
                  data-testid={`goal-${g.id}`}
                />
                {g.label}
              </label>
            ))}
          </fieldset>
        )}

        {name === "brand" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-[24px] font-semibold leading-8">
              Which brand do you want to listen for?
            </h1>
            <Field
              label="Brand name"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              data-testid="brand-name"
              required
            />
            <Field
              label="Website (optional)"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
            <Field
              label="Social handles (optional)"
              value={handles}
              onChange={(e) => setHandles(e.target.value)}
              hint="Comma-separated, e.g. @yourbrand, @yourbrand_support"
              data-testid="brand-handles"
            />
            <div>
              <Field
                label="Competitors (up to 3)"
                value={compDraft}
                onChange={(e) => setCompDraft(e.target.value)}
                data-testid="competitor-input"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (compDraft.trim() && competitors.length < 3) {
                      setCompetitors([...competitors, compDraft.trim()]);
                      setCompDraft("");
                    }
                  }
                }}
                hint="Press Enter to add each one."
              />
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="Competitors added">
                {competitors.map((c) => (
                  <li
                    key={c}
                    className="flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-sm"
                  >
                    {c}
                    <button
                      type="button"
                      aria-label={`Remove ${c}`}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-[var(--surface-2)]"
                      onClick={() => setCompetitors(competitors.filter((x) => x !== c))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {name === "query" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-[24px] font-semibold leading-8">Here&apos;s your first query</h1>
            <p className="text-[var(--text-muted)]">
              We built it from your brand details. You can refine it any time with the query
              builder.
            </p>
            {!preview ? (
              <p role="status" className="text-[var(--text-muted)]">
                Counting recent mentions…
              </p>
            ) : (
              <>
                <pre
                  className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-sm"
                  data-testid="generated-query"
                >
                  {preview.booleanText}
                </pre>
                <p role="status" data-testid="query-estimate">
                  We found about <strong>{preview.estimate.toLocaleString()}</strong> mentions in
                  the last 30 days.
                </p>
                {preview.estimate === 0 && (
                  <p className="text-sm text-[var(--warning)]">
                    No matches yet. Check the spelling, or add a social handle and we&apos;ll widen
                    the net.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {name === "invite" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-[24px] font-semibold leading-8">Invite a teammate</h1>
            <p className="text-[var(--text-muted)]">
              Your trial includes 2 seats. Teammates get an email with a link to join your
              workspace.
            </p>
            <Field
              label="Teammate email"
              type="email"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              data-testid="invite-email"
            />
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]" data-testid="onboarding-error">
            {error}
          </p>
        )}
      </main>

      <footer className="flex items-center justify-between gap-3 pb-4">
        <Button
          variant="ghost"
          onClick={() => {
            setError("");
            setStep((s) => Math.max(0, s - 1));
          }}
          disabled={step === 0 || pending}
        >
          Back
        </Button>
        <div className="flex gap-3">
          {OPTIONAL.has(name) && (
            <Button
              variant="secondary"
              onClick={skip}
              disabled={pending}
              data-testid="onboarding-skip"
            >
              Skip for now
            </Button>
          )}
          <Button onClick={next} loading={pending} data-testid="onboarding-next">
            {name === "invite" ? "Finish" : name === "query" ? "Looks good" : "Next"}
          </Button>
        </div>
      </footer>
    </div>
  );
}
