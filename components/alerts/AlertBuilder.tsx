"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { backtestAction, createAlert, type BacktestResult } from "@/app/w/[ws]/alerts/actions";
import { PaywallModal, type PaywallProps } from "@/components/listening/PaywallModal";
import type { PaywallTrigger } from "@/lib/billing/paywalls";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { track } from "@/lib/analytics/client";
import { ALERT_TYPES, COOLDOWNS, TYPE_INFO, type AlertType } from "@/lib/alerts/rules";
import { PLANS, planUnlocking, type PlanTier } from "@/lib/entitlements/plans";

const DEFAULTS = {
  volume_spike: { a: 3, b: 20 },
  sentiment_drop: { a: 40, b: 15 },
  influencer: { a: 100_000, b: 0 },
} as const;

const COOLDOWN_LABEL: Record<number, string> = {
  30: "30 minutes",
  60: "1 hour",
  180: "3 hours",
  720: "12 hours",
  1440: "24 hours",
};

const select =
  "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm";

function paramsOf(type: AlertType, a: number, b: number) {
  if (type === "volume_spike") return { multiple: a, minVolume: b };
  if (type === "sentiment_drop") return { negativeShare: a / 100, minVolume: b };
  return { minReach: a };
}

export function AlertBuilder({
  ws,
  queries,
  allowed,
  limit,
  used,
  initialType,
  initialQuery,
}: {
  ws: string;
  queries: { id: string; name: string }[];
  /** Which alert types the plan includes. */
  allowed: Record<AlertType, boolean>;
  limit: number;
  used: number;
  initialType: AlertType;
  initialQuery: string;
}) {
  const router = useRouter();
  const [type, setType] = useState<AlertType>(allowed[initialType] ? initialType : "volume_spike");
  const [queryId, setQueryId] = useState(initialQuery || queries[0]?.id || "");
  const [a, setA] = useState<number>(DEFAULTS[type].a);
  const [b, setB] = useState<number>(DEFAULTS[type].b);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [email, setEmail] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const [test, setTest] = useState<BacktestResult | "loading" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState<PaywallProps | null>(null);
  const seq = useRef(0);
  const idp = useId();

  const qName = queries.find((q) => q.id === queryId)?.name ?? "";
  const autoName = `${TYPE_INFO[type].label}${qName ? ` · ${qName}` : ""}`;
  const shownName = nameTouched ? name : autoName;
  const params = paramsOf(type, a, b);

  // Live backtest: re-runs shortly after any threshold changes.
  useEffect(() => {
    if (!queryId) return;
    const mine = ++seq.current;
    setTest("loading");
    const t = setTimeout(async () => {
      const r = await backtestAction(ws, { queryId, type, params });
      if (mine === seq.current) setTest(r);
    }, 450);
    return () => clearTimeout(t);
  }, [ws, queryId, type, a, b]); // eslint-disable-line react-hooks/exhaustive-deps

  const openPaywall = (trigger: PaywallTrigger, reason: string, to: PlanTier) => {
    const p = PLANS[to];
    setPaywall({
      trigger,
      title:
        trigger === "alert_limit" ? "You've reached your alert limit" : "Upgrade to use this alert",
      reason,
      planLabel: p.label,
      priceLine: p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined,
      bullets: [
        `${p.alerts.toLocaleString()} alerts`,
        "Negative-sentiment surge alerts",
        p.features.crisisRoom ? "Crisis Rooms" : "Alerts by email",
      ],
      onClose: () => setPaywall(null),
    });
  };

  const pickType = (t: AlertType) => {
    if (!allowed[t]) {
      const feature = TYPE_INFO[t].feature!;
      return openPaywall(
        "sentiment_alerts",
        `${TYPE_INFO[t].label} alerts are on the ${PLANS[planUnlocking(feature)].label} plan and above.`,
        planUnlocking(feature),
      );
    }
    setType(t);
    setA(DEFAULTS[t].a);
    setB(DEFAULTS[t].b);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    const channels = email ? ["in_app", "email"] : ["in_app"];
    const r = await createAlert(ws, {
      name: shownName,
      queryId,
      type,
      params,
      channels,
      cooldownMin: cooldown,
    });
    setSaving(false);
    if (r.ok) {
      track("Alert Created", {
        alert_type: type,
        threshold: a,
        delivery_channel: channels.join("+"),
        backtest_fire_count: typeof test === "object" && test?.ok ? test.fires : null,
      });
      return router.push(`/w/${ws}/alerts?created=1`);
    }
    if (r.paywall && r.upgradeTo)
      return openPaywall(
        r.paywall === "alert_limit" ? "alert_limit" : "sentiment_alerts",
        r.error,
        r.upgradeTo,
      );
    setError(r.error);
  };

  const result = typeof test === "object" && test?.ok ? test : null;
  const failure = typeof test === "object" && test && !test.ok ? test.error : null;

  return (
    <form
      onSubmit={save}
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]"
      noValidate
    >
      {paywall && <PaywallModal {...paywall} />}
      <div className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">What should trigger it?</legend>
          {ALERT_TYPES.map((t) => (
            <label
              key={t}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${type === t ? "border-[var(--primary)] bg-[var(--surface-2)]" : "border-[var(--border)]"}`}
            >
              <input
                type="radio"
                name={`${idp}-type`}
                checked={type === t}
                onChange={() => pickType(t)}
                className="mt-1 h-4 w-4"
                data-testid={`type-${t}`}
              />
              <span>
                <span className="flex items-center gap-2 font-medium">
                  {TYPE_INFO[t].label}
                  {!allowed[t] && (
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-normal text-[var(--text-muted)]">
                      {PLANS[planUnlocking(TYPE_INFO[t].feature!)].label} plan
                    </span>
                  )}
                </span>
                <span className="block text-sm text-[var(--text-muted)]">{TYPE_INFO[t].blurb}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${idp}-q`} className="text-sm font-medium">
            Watch this query
          </label>
          <select
            id={`${idp}-q`}
            value={queryId}
            onChange={(e) => setQueryId(e.target.value)}
            className={select}
            data-testid="alert-query"
          >
            {queries.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {type === "volume_spike" && (
            <>
              <Field
                label="Spike size (× the usual hourly volume)"
                type="number"
                min={1.5}
                max={50}
                step={0.5}
                value={a}
                onChange={(e) => setA(Number(e.target.value))}
                data-testid="th-a"
                hint="3 means three times the normal pace."
              />
              <Field
                label="At least this many mentions in the hour"
                type="number"
                min={5}
                max={10000}
                value={b}
                onChange={(e) => setB(Number(e.target.value))}
                data-testid="th-b"
                hint="Stops tiny numbers from alerting."
              />
            </>
          )}
          {type === "sentiment_drop" && (
            <>
              <Field
                label="Negative share (%)"
                type="number"
                min={20}
                max={95}
                value={a}
                onChange={(e) => setA(Number(e.target.value))}
                data-testid="th-a"
                hint="Also needs to be clearly worse than this query's normal."
              />
              <Field
                label="At least this many mentions in the hour"
                type="number"
                min={5}
                max={10000}
                value={b}
                onChange={(e) => setB(Number(e.target.value))}
                data-testid="th-b"
              />
            </>
          )}
          {type === "influencer" && (
            <Field
              label="Estimated reach of at least"
              type="number"
              min={10000}
              max={100000000}
              step={10000}
              value={a}
              onChange={(e) => setA(Number(e.target.value))}
              data-testid="th-a"
              hint="Reach is an estimate of how many people a post could be seen by."
            />
          )}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">How should we tell you?</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked disabled className="h-4 w-4" />
            In the app (bell icon and Alerts page)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={email}
              onChange={(e) => setEmail(e.target.checked)}
              className="h-4 w-4"
              data-testid="channel-email"
            />
            Email owners, admins and editors in this workspace
          </label>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Alert name"
            value={shownName}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
            maxLength={80}
            data-testid="alert-name"
          />
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idp}-cd`} className="text-sm font-medium">
              Don&apos;t repeat for
            </label>
            <select
              id={`${idp}-cd`}
              value={cooldown}
              onChange={(e) => setCooldown(Number(e.target.value))}
              className={select}
              data-testid="alert-cooldown"
            >
              {COOLDOWNS.map((c) => (
                <option key={c} value={c}>
                  {COOLDOWN_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]" data-testid="alert-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={saving} disabled={!queryId} data-testid="save-alert">
            Create alert
          </Button>
          <span className="text-sm text-[var(--text-muted)]">
            {used} of {limit.toLocaleString()} alerts used
          </span>
        </div>
      </div>

      <aside
        className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
        aria-labelledby={`${idp}-bt`}
        data-testid="backtest"
      >
        <h2 id={`${idp}-bt`} className="font-semibold">
          Would it have fired?
        </h2>
        <div aria-live="polite" className="mt-2 text-sm">
          {failure ? (
            <p role="alert" className="text-[var(--danger)]">
              {failure}
            </p>
          ) : !result ? (
            <p className="text-[var(--text-muted)]" data-testid="backtest-loading">
              Replaying the last 30 days…
            </p>
          ) : result.empty ? (
            <p data-testid="backtest-empty">
              This query has no history yet, so there&apos;s nothing to replay. You can still create
              the alert.
            </p>
          ) : (
            <>
              <p className="text-lg font-semibold" data-testid="backtest-count">
                {result.fires === 0
                  ? "Never"
                  : `${result.fires} time${result.fires === 1 ? "" : "s"}`}{" "}
                <span className="text-sm font-normal text-[var(--text-muted)]">
                  in the last {result.days} days
                </span>
              </p>
              <p className="mt-1 text-[var(--text-muted)]" data-testid="backtest-advice">
                {result.fires === 0
                  ? "It wouldn't have fired. If you expected it to, loosen the threshold."
                  : result.fires > 8
                    ? "That's a lot of alerts — tighten the threshold if you only want the big moments."
                    : "That sounds like a healthy number of alerts."}
              </p>
              {result.at.length > 0 && (
                <ul className="mt-3 list-disc pl-5" aria-label="When it would have fired">
                  {result.at.map((t) => (
                    <li key={t}>
                      {new Date(t).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: "UTC",
                      })}{" "}
                      UTC
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-[var(--text-muted)]">
                Approximate: replayed hour by hour over the mentions already collected.
              </p>
            </>
          )}
        </div>
      </aside>
    </form>
  );
}
