"use client";

import { useState } from "react";
import { requestContractChangesAction, signContractAction } from "@/app/creator/[token]/actions";
import { Button } from "@/components/ui/button";
import type { PortalView } from "@/lib/creators/outreach";
import { useBusy } from "@/lib/use-busy";

const box =
  "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm";
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

/** The agreement as the brand sent it: read it, then sign (a typed name and an explicit yes) or ask for changes. */
export function ContractSection({
  token,
  contract,
  brand,
  onView,
}: {
  token: string;
  contract: NonNullable<PortalView["contract"]>;
  brand: string;
  onView: (v: PortalView) => void;
}) {
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, run] = useBusy();

  return (
    <section
      aria-labelledby="contract-h"
      className="mt-6"
      data-testid="portal-contract"
      data-status={contract.status}
    >
      <h2 id="contract-h" className="text-xl font-semibold">
        Your agreement
      </h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]" data-testid="contract-status">
        {contract.status === "signed"
          ? `Signed by ${contract.signedName} on ${day(contract.signedAt!)}.`
          : contract.status === "changes_requested"
            ? "You asked for changes. We'll email you when " + brand + " sends a revised agreement."
            : `Version ${contract.version}, waiting for your signature.`}
      </p>
      <div
        tabIndex={0}
        role="region"
        aria-label="Agreement text"
        className="mt-3 max-h-80 overflow-auto whitespace-pre-line rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm"
        data-testid="contract-text"
      >
        {contract.text}
      </div>

      {contract.status === "changes_requested" && contract.requestNote && (
        <p className="mt-2 text-sm text-[var(--text-muted)]">Your note: {contract.requestNote}</p>
      )}

      {contract.status === "sent" && (
        <>
          <form
            noValidate
            aria-label="Sign the agreement"
            className="mt-4 grid max-w-md gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                setError("");
                const r = await signContractAction(token, name, agree);
                if (!r.ok) return setError(r.error);
                onView(r.view);
              });
            }}
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="sign-name" className="text-sm font-medium">
                Type your full name to sign
              </label>
              <input
                id="sign-name"
                value={name}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
                className={box}
                data-testid="sign-name"
              />
            </div>
            <label className="flex min-h-9 items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="mt-1"
                data-testid="sign-agree"
              />
              I&apos;ve read this agreement and I agree to its terms.
            </label>
            <div>
              <Button type="submit" loading={busy} data-testid="sign-submit">
                Sign agreement
              </Button>
            </div>
          </form>
          <div className="mt-3">
            <button
              type="button"
              aria-expanded={asking}
              onClick={() => setAsking(!asking)}
              className="min-h-8 rounded-md px-1 text-sm text-[var(--primary)] underline"
              data-testid="contract-ask-toggle"
            >
              Ask for changes instead
            </button>
            {asking && (
              <form
                noValidate
                aria-label="Ask for changes"
                className="mt-2 grid max-w-md gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    setError("");
                    const r = await requestContractChangesAction(token, note);
                    if (!r.ok) return setError(r.error);
                    onView(r.view);
                  });
                }}
              >
                <label htmlFor="contract-note" className="text-sm font-medium">
                  What would you like changed?
                </label>
                <textarea
                  id="contract-note"
                  rows={3}
                  maxLength={1500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={`${box} py-2`}
                  data-testid="contract-note"
                />
                <div>
                  <Button
                    type="submit"
                    variant="secondary"
                    loading={busy}
                    data-testid="contract-note-send"
                  >
                    Send to {brand}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]" data-testid="contract-error">
          {error}
        </p>
      )}
    </section>
  );
}
