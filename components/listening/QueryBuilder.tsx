"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { previewAction, saveQuery } from "@/app/w/[ws]/queries/actions";
import { Button } from "@/components/ui/button";
import { ChipInput } from "@/components/listening/ChipInput";
import { PaywallModal, type PaywallProps } from "@/components/listening/PaywallModal";
import { PreviewPanel, type PreviewState } from "@/components/listening/PreviewPanel";
import { track } from "@/lib/analytics/client";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { COUNTRIES, LANGUAGES, SOURCE_TYPES } from "@/lib/query/constants";
import { compileGuided, emptyGuided, toGuided, type Guided } from "@/lib/query/guided";
import { analyze } from "@/lib/query/lint";

const BooleanEditor = dynamic(() => import("./BooleanEditor").then((m) => m.BooleanEditor), {
  ssr: false,
  loading: () => (
    <div
      className="h-36 rounded-md border border-[var(--border)] bg-[var(--surface)]"
      aria-hidden
    />
  ),
});

export interface Filters {
  sources: string[];
  languages: string[];
  countries: string[];
}
export interface BuilderInitial {
  id?: string;
  name: string;
  booleanText: string;
  mode: "guided" | "advanced";
  filters: Filters;
  status: "draft" | "live" | "paused";
  backfillStatus?: string;
}

const STATUS_LABEL = { draft: "Draft", live: "Live", paused: "Paused" } as const;

function FilterGroup({
  legend,
  options,
  selected,
  onChange,
  disabled,
  testId,
}: {
  legend: string;
  options: readonly string[];
  selected: string[];
  onChange: (s: string[]) => void;
  disabled: boolean;
  testId: string;
}) {
  return (
    <details className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {legend}{" "}
        <span className="font-normal text-[var(--text-muted)]">
          {selected.length ? `(${selected.length} selected)` : "(all)"}
        </span>
      </summary>
      <fieldset className="mt-2 flex flex-wrap gap-x-4 gap-y-1" disabled={disabled}>
        <legend className="sr-only">{legend}</legend>
        {options.map((o) => (
          <label key={o} className="flex min-h-6 items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(o)}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, o] : selected.filter((x) => x !== o))
              }
              data-testid={`${testId}-${o}`}
            />
            {o}
          </label>
        ))}
      </fieldset>
    </details>
  );
}

export function QueryBuilder({
  ws,
  initial,
  canEdit,
  plan,
  entryPoint,
  isFromTemplate,
}: {
  ws: string;
  initial: BuilderInitial;
  canEdit: boolean;
  plan: PlanTier;
  entryPoint: string;
  isFromTemplate: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [mode, setMode] = useState(initial.mode);
  const [guided, setGuided] = useState<Guided>(() =>
    initial.mode === "guided"
      ? initial.booleanText
        ? (analyze(initial.booleanText).ast && toGuided(analyze(initial.booleanText).ast!)) ||
          emptyGuided()
        : emptyGuided()
      : emptyGuided(),
  );
  const [advanced, setAdvanced] = useState(initial.booleanText);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [saveError, setSaveError] = useState("");
  const [paywall, setPaywall] = useState<PaywallProps | null>(null);
  const [switchWarning, setSwitchWarning] = useState(false);
  const [saving, startSave] = useTransition();
  const seq = useRef(0);
  const lastNoise = useRef<{ noise?: number; count?: number }>({});

  const booleanText = mode === "guided" ? compileGuided(guided) : advanced;
  const analysis = useMemo(() => analyze(booleanText), [booleanText]);
  const errors = analysis.issues.filter((i) => i.severity === "error");
  const readOnly = !canEdit;

  useEffect(() => {
    track("Query Builder Opened", {
      builder_mode: initial.mode,
      is_from_template: isFromTemplate,
      entry_point: entryPoint,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced live preview (800ms) with stale-response protection.
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    if (!booleanText.trim()) {
      setPreview({ status: "idle" });
      return;
    }
    if (!analysis.ok) {
      setPreview({ status: "invalid" });
      return;
    }
    const mine = ++seq.current;
    setPreview((p) => ({
      status: "loading",
      previous: p.status === "ready" ? p.data : p.status === "loading" ? p.previous : undefined,
    }));
    const t = setTimeout(async () => {
      try {
        const res = await previewAction(ws, booleanText, filters);
        if (mine !== seq.current) return;
        if (!res.ok) {
          setPreview({ status: "invalid" });
          return;
        }
        lastNoise.current = { noise: res.noiseScore, count: res.count };
        setPreview({ status: "ready", data: res });
        track("Query Previewed", {
          query_id: initial.id,
          builder_mode: mode,
          preview_result_count: res.count,
          noise_score: res.noiseScore,
          operator_count: res.stats.operators,
          has_near: res.stats.hasNear,
          exclusion_count: res.stats.exclusions,
        });
      } catch (e) {
        if (mine === seq.current)
          setPreview({
            status: "error",
            message: e instanceof Error ? e.message : "unexpected error",
          });
      }
    }, 800);
    return () => clearTimeout(t);
  }, [booleanText, filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Report each distinct validation failure once the user pauses typing.
  const lastError = useRef("");
  useEffect(() => {
    const code = errors[0]?.code ?? "";
    if (!code || code === lastError.current) {
      if (!code) lastError.current = "";
      return;
    }
    const t = setTimeout(() => {
      lastError.current = code;
      track("Query Validation Failed", { builder_mode: mode, error_type: code });
    }, 800);
    return () => clearTimeout(t);
  }, [errors[0]?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  function save() {
    if (readOnly || saving) return;
    setSaveError("");
    if (!name.trim()) return setSaveError("Give the query a name.");
    if (!analysis.ok)
      return setSaveError(errors[0]?.message ?? "Fix the query errors before saving.");
    startSave(async () => {
      const r = await saveQuery(ws, {
        id: initial.id,
        name,
        booleanText,
        builderMode: mode,
        filters,
        isFromTemplate,
        noiseScore: lastNoise.current.noise,
        previewCount: lastNoise.current.count,
      });
      if (r.ok) {
        router.push(`/w/${ws}/queries?saved=${r.id}`);
        return;
      }
      if (r.upgradeTo) {
        const p = PLANS[r.upgradeTo];
        setPaywall({
          trigger: "query_limit",
          title: "You've reached your query limit",
          reason: r.error,
          planLabel: r.upgradeLabel ?? p.label,
          priceLine: p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined,
          bullets: [
            `${p.activeQueries} active queries`,
            `${p.mentionsPerMonth.toLocaleString()} mentions per month`,
            `${p.historyDays >= 365 ? Math.round(p.historyDays / 365) + " year(s)" : p.historyDays + " days"} of history`,
          ],
          onClose: () => setPaywall(null),
        });
      } else setSaveError(r.error);
    });
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        track("Keyboard Shortcut Used", { shortcut: "mod+s", context: "query_builder" });
        saveRef.current();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  function switchTo(next: "guided" | "advanced", force = false) {
    if (next === mode) return;
    if (next === "advanced") {
      setAdvanced(compileGuided(guided));
      setMode("advanced");
      return;
    }
    if (!advanced.trim()) {
      setGuided(emptyGuided());
      setMode("guided");
      return;
    }
    const g = analysis.ast ? toGuided(analysis.ast) : null;
    if (g) {
      setGuided(g);
      setMode("guided");
      setSwitchWarning(false);
    } else if (force) {
      setGuided(emptyGuided());
      setMode("guided");
      setSwitchWarning(false);
    } else setSwitchWarning(true);
  }

  const tab = (m: "guided" | "advanced", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => switchTo(m)}
      data-testid={`mode-${m}`}
      className={`min-h-9 rounded-md px-4 text-sm font-medium ${mode === m ? "bg-[var(--primary)] text-[var(--primary-contrast)]" : "border border-[var(--border)] bg-[var(--surface)]"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      {paywall && <PaywallModal {...paywall} />}
      <header className="flex flex-wrap items-center gap-3">
        <input
          aria-label="Query name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={readOnly}
          data-testid="query-name"
          className="min-h-10 min-w-64 flex-1 rounded-md border border-transparent bg-transparent px-2 text-[24px] font-semibold leading-8 hover:border-[var(--border)]"
        />
        <span
          className="rounded-full border border-[var(--border)] px-3 py-0.5 text-sm"
          data-testid="query-status"
        >
          {STATUS_LABEL[initial.status]}
        </span>
      </header>
      {readOnly && (
        <p role="status" className="rounded-md border border-[var(--info)] p-3 text-sm">
          You have view-only access to queries in this workspace.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-4">
          <div role="tablist" aria-label="Builder mode" className="flex gap-2">
            {tab("guided", "Guided")}
            {tab("advanced", "Advanced")}
          </div>

          {switchWarning && (
            <div
              role="alertdialog"
              aria-labelledby="sw-h"
              className="rounded-md border border-[var(--warning)] p-3 text-sm"
              data-testid="switch-warning"
            >
              <p id="sw-h" className="font-medium">
                The guided form can&apos;t show this query.
              </p>
              <p className="mt-1 text-[var(--text-muted)]">
                It uses fields, nested groups or ordered NEAR. Switching will clear the guided form
                (your Boolean text is kept if you switch back).
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setSwitchWarning(false)}>
                  Keep editing
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => switchTo("guided", true)}
                  data-testid="switch-anyway"
                >
                  Switch anyway
                </Button>
              </div>
            </div>
          )}

          {mode === "guided" ? (
            <div className="flex flex-col gap-4" data-testid="guided-form">
              <ChipInput
                label="Must include any of"
                hint="Brand names, products, hashtags (#brand) or handles (@brand). Press Enter after each."
                chips={guided.any}
                onChange={(any) => setGuided({ ...guided, any })}
                placeholder="e.g. Juniper Roast"
                testId="guided-any"
                disabled={readOnly}
              />
              <ChipInput
                label="Must also include (optional)"
                chips={guided.also}
                onChange={(also) => setGuided({ ...guided, also })}
                placeholder="e.g. price, cost"
                testId="guided-also"
                disabled={readOnly}
              />
              {guided.also.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  Within
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={guided.within}
                    onChange={(e) =>
                      setGuided({
                        ...guided,
                        within: Math.max(0, Math.min(20, Number(e.target.value) || 0)),
                      })
                    }
                    disabled={readOnly}
                    data-testid="guided-within"
                    className="min-h-9 w-20 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-2"
                  />
                  words of the first group{" "}
                  <span className="text-[var(--text-muted)]">(0 = anywhere in the mention)</span>
                </label>
              )}
              <ChipInput
                label="Exclude"
                hint="Mentions containing any of these are dropped. Try: job, hiring, giveaway."
                chips={guided.exclude}
                onChange={(exclude) => setGuided({ ...guided, exclude })}
                placeholder="e.g. job, hiring"
                testId="guided-exclude"
                disabled={readOnly}
              />
              <div>
                <h3 className="text-sm font-medium">Boolean query</h3>
                <pre
                  className="mt-1 min-h-9 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2 font-mono text-sm"
                  data-testid="compiled-query"
                >
                  {booleanText || "—"}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Boolean query</label>
              <BooleanEditor
                value={advanced}
                onChange={setAdvanced}
                issues={analysis.issues}
                onSave={save}
                readOnly={readOnly}
              />
              <p className="text-xs text-[var(--text-muted)]">
                Operators are UPPERCASE: AND, OR, NOT, NEAR/5. Use quotes for phrases, * at the end
                of a word, and fields like lang:en or author:handle.
              </p>
            </div>
          )}

          {analysis.issues.length > 0 && (
            <ul
              aria-label="Query problems"
              className="flex flex-col gap-1"
              data-testid="query-issues"
            >
              {analysis.issues.map((i, n) => (
                <li
                  key={n}
                  data-severity={i.severity}
                  className={`text-sm ${i.severity === "error" ? "text-[var(--danger)]" : "text-[var(--warning)]"}`}
                >
                  <span aria-hidden>{i.severity === "error" ? "✕ " : "⚠ "}</span>
                  <span className="sr-only">
                    {i.severity === "error" ? "Error: " : "Warning: "}
                  </span>
                  {i.message}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Narrow by</h3>
            <FilterGroup
              legend="Sources"
              options={SOURCE_TYPES}
              selected={filters.sources}
              onChange={(sources) => setFilters({ ...filters, sources })}
              disabled={readOnly}
              testId="filter-source"
            />
            <FilterGroup
              legend="Languages"
              options={LANGUAGES}
              selected={filters.languages}
              onChange={(languages) => setFilters({ ...filters, languages })}
              disabled={readOnly}
              testId="filter-lang"
            />
            <FilterGroup
              legend="Countries"
              options={COUNTRIES}
              selected={filters.countries}
              onChange={(countries) => setFilters({ ...filters, countries })}
              disabled={readOnly}
              testId="filter-country"
            />
          </div>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <PreviewPanel state={preview} />
        </aside>
      </div>

      <footer className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-[var(--border)] bg-[var(--bg)] py-3">
        <Button onClick={save} loading={saving} disabled={readOnly} data-testid="save-query">
          Save <kbd className="ml-1 rounded border border-current px-1 text-xs opacity-80">⌘S</kbd>
        </Button>
        <Link
          href={`/w/${ws}/queries`}
          className="inline-flex min-h-9 items-center rounded-md border border-[var(--border)] px-4 text-sm font-medium"
        >
          Cancel
        </Link>
        <p role="alert" className="text-sm text-[var(--danger)]" data-testid="save-error">
          {saveError}
        </p>
        <span className="ml-auto text-xs text-[var(--text-muted)]">{PLANS[plan].label} plan</span>
      </footer>
    </div>
  );
}
