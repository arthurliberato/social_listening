"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { acceptOfferAction, cancelAction, saveOfferAction } from "@/app/settings/billing/actions";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";
import { SAVE_OFFER } from "@/lib/billing/pricing";

const REASONS: [string, string][] = [
  ["too_expensive", "It costs more than it's worth to us"],
  ["missing_feature", "It's missing something we need"],
  ["not_using", "We're not using it enough"],
  ["switched_tool", "We moved to another tool"],
  ["temporary", "We only needed it for a while"],
  ["other", "Something else"],
];

/**
 * Cancel in three steps from Billing: (1) Cancel plan, (2) say why, (3) confirm. The save offer appears at
 * most once per account, on the confirm step, with equal-weight buttons, and never blocks cancelling.
 */
export function CancelFlow({
  endsOn,
  tenureDays,
  alreadyCanceled,
}: {
  endsOn: string;
  tenureDays: number;
  alreadyCanceled: boolean;
}) {
  const [step, setStep] = useState<"reason" | "confirm" | "done" | "kept">(
    alreadyCanceled ? "done" : "reason",
  );
  const [reason, setReason] = useState("");
  const [offer, setOffer] = useState(false);
  const [busy, setBusy] = useState<"next" | "cancel" | "offer" | null>(null);
  const [error, setError] = useState("");
  const started = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (started.current || alreadyCanceled) return;
    started.current = true;
    track("Cancellation Started", { tenure_days: tenureDays });
  }, [tenureDays, alreadyCanceled]);
  useEffect(() => heading.current?.focus(), [step]);

  const next = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) return setError("Pick the main reason. It really does help us.");
    setError("");
    setBusy("next");
    track("Cancellation Reason Submitted", { reason });
    const r = await saveOfferAction();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setOffer(r.show);
    setStep("confirm");
  };
  const cancel = async () => {
    setBusy("cancel");
    setError("");
    const r = await cancelAction(reason);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setStep("done");
  };
  const accept = async () => {
    setBusy("offer");
    setError("");
    const r = await acceptOfferAction();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setStep("kept");
  };
  const date = endsOn.slice(0, 10);
  const h = "text-[30px] font-semibold leading-[38px] outline-none";

  if (step === "done")
    return (
      <div data-testid="cancel-done">
        <h1 ref={heading} tabIndex={-1} className={h}>
          Your plan is cancelled
        </h1>
        <p className="mt-3">
          You keep full access until {date}, and you won&apos;t be charged again. We&apos;ve emailed
          you a confirmation.
        </p>
        <p className="mt-2 text-[var(--text-muted)]">
          After that your workspace is read-only. Your data is kept and you can still export it.
        </p>
        <Link
          href="/settings/billing"
          className="mt-4 inline-flex min-h-9 items-center rounded-md border border-[var(--border)] px-4 text-sm font-medium hover:bg-[var(--surface-2)]"
          data-testid="back-to-billing"
        >
          Back to billing (you can resume there)
        </Link>
      </div>
    );
  if (step === "kept")
    return (
      <div data-testid="offer-accepted">
        <h1 ref={heading} tabIndex={-1} className={h}>
          Glad you&apos;re staying
        </h1>
        <p className="mt-3">
          Your next {SAVE_OFFER.cycles} renewals are {SAVE_OFFER.pct}% off. Nothing else changes.
        </p>
        <Link
          href="/settings/billing"
          className="mt-4 inline-flex min-h-9 items-center rounded-md border border-[var(--border)] px-4 text-sm font-medium hover:bg-[var(--surface-2)]"
        >
          Back to billing
        </Link>
      </div>
    );

  if (step === "confirm")
    return (
      <div data-testid="cancel-confirm">
        <h1 ref={heading} tabIndex={-1} className={h}>
          Confirm cancellation
        </h1>
        <ul className="mt-4 list-disc pl-5 text-sm">
          <li>You keep full access until {date}.</li>
          <li>You won&apos;t be charged again.</li>
          <li>
            After that your workspace is read-only. Your data is kept, and you can still export it.
          </li>
          <li>You can resume any time before {date}, or come back later.</li>
        </ul>
        {offer && (
          <section
            className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
            aria-labelledby="offer-h"
            data-testid="save-offer"
          >
            <h2 id="offer-h" className="font-semibold">
              If price is the issue
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Keep your plan and pay {SAVE_OFFER.pct}% less on your next {SAVE_OFFER.cycles}{" "}
              renewals. This is a one-time offer. It&apos;s fine to say no.
            </p>
            <Button
              variant="secondary"
              className="mt-3"
              onClick={accept}
              loading={busy === "offer"}
              data-testid="accept-offer"
            >
              Keep my plan for {SAVE_OFFER.pct}% off
            </Button>
          </section>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={cancel}
            loading={busy === "cancel"}
            data-testid="confirm-cancel"
          >
            Cancel my plan
          </Button>
          <Link
            href="/settings/billing"
            className="inline-flex min-h-9 items-center rounded-md border border-[var(--border)] px-4 text-sm font-medium hover:bg-[var(--surface-2)]"
            data-testid="keep-plan-link"
          >
            Keep my plan
          </Link>
        </div>
      </div>
    );

  return (
    <div data-testid="cancel-reason">
      <h1 ref={heading} tabIndex={-1} className={h}>
        Cancel your plan
      </h1>
      <p className="mt-1 text-[var(--text-muted)]">
        What&apos;s the main reason? It takes one click and it&apos;s how we improve.
      </p>
      <form onSubmit={next} className="mt-4 flex flex-col gap-4" noValidate>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Main reason for cancelling</legend>
          {REASONS.map(([v, l]) => (
            <label key={v} className="flex min-h-6 items-center gap-2 text-sm">
              <input
                type="radio"
                name="reason"
                value={v}
                checked={reason === v}
                onChange={() => setReason(v)}
                className="h-4 w-4"
                data-testid={`reason-${v}`}
              />
              {l}
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]" data-testid="reason-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={busy === "next"} data-testid="reason-continue">
            Continue
          </Button>
          <Link
            href="/settings/billing"
            className="inline-flex min-h-9 items-center rounded-md border border-[var(--border)] px-4 text-sm font-medium hover:bg-[var(--surface-2)]"
          >
            Keep my plan
          </Link>
        </div>
      </form>
    </div>
  );
}
