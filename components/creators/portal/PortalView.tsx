"use client";

import { useState } from "react";
import { respondAction, submitContentAction } from "@/app/creator/[token]/actions";
import { Button } from "@/components/ui/button";
import { OBJECTIVE_LABEL, type Objective } from "@/lib/creators/campaign-flow";
import type { PortalState, PortalView as View } from "@/lib/creators/outreach";
import { useBusy } from "@/lib/use-busy";
import { CopyField } from "@/components/creators/results/CopyField";
import { ContractSection } from "./ContractSection";
import { PayoutSection } from "./PayoutSection";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
const box =
  "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm";

const HEADING: Record<PortalState, (v: View) => string> = {
  open: (v) => `${v.brand} invited you to work together`,
  expired: () => "This invitation has expired",
  countered: () => "Your proposal is with the brand",
  declined: () => "This invitation was declined",
  superseded: () => "There's a newer offer for you",
  revoked: () => "This invitation was withdrawn",
  confirmed: () => "You're confirmed",
  in_review: (v) => `Your content is with ${v.brand}`,
  approved: () => "Your content was approved",
  paid: () => "You've been paid",
};

/**
 * The creator's page, reached with the link alone. It holds what it shows and takes the fresh state back from every
 * action, so an answer is on screen as soon as the server has it.
 */
export function PortalView({ token, initial }: { token: string; initial: View }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");

  const respond = (kind: "accept" | "decline" | "counter") =>
    run(async () => {
      setError("");
      const r = await respondAction(token, kind, { counterUsd: amount, note });
      if (!r.ok) return setError(r.error);
      setV(r.view);
      setConfirmDecline(false);
      setCounterOpen(false);
    });

  const latest = v.content[v.content.length - 1];
  const changes = latest?.status === "changes_requested" ? latest : null;
  const accepted =
    v.state === "confirmed" ||
    v.state === "in_review" ||
    v.state === "approved" ||
    v.state === "paid";
  // An agreement waiting on the creator (or on a revision) has to be dealt with before content goes in.
  const contractBlocks =
    !!v.contract && (v.contract.status === "sent" || v.contract.status === "changes_requested");

  return (
    <div data-testid="portal" data-state={v.state}>
      <p className="text-sm text-[var(--text-muted)]">
        For {v.creator.name} (@{v.creator.handle})
      </p>
      <h1 className="mt-1 text-[30px] font-semibold leading-[38px]" data-testid="portal-heading">
        {HEADING[v.state](v)}
      </h1>

      <section
        aria-labelledby="campaign-h"
        className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <h2 id="campaign-h" className="font-medium">
          {v.campaign.name}
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-[var(--text-muted)]">Goal</dt>
            <dd>{OBJECTIVE_LABEL[v.campaign.objective as Objective] ?? v.campaign.objective}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--text-muted)]">Dates</dt>
            <dd>
              {v.campaign.startsOn || v.campaign.endsOn
                ? `${v.campaign.startsOn ?? "…"} to ${v.campaign.endsOn ?? "…"}`
                : "To be agreed"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--text-muted)]">
              {v.agreedUsd ? "Agreed fee" : "Offered fee"}
            </dt>
            <dd className="font-semibold tabular-nums" data-testid="portal-fee">
              {usd(v.agreedUsd ?? v.offeredUsd)}
            </dd>
          </div>
        </dl>
        {v.campaign.brief && (
          <p className="mt-3 whitespace-pre-line text-sm" data-testid="portal-brief">
            {v.campaign.brief}
          </p>
        )}
      </section>

      {v.state === "open" && (
        <>
          {v.message && (
            <p className="mt-5 whitespace-pre-line" data-testid="portal-message">
              {v.message}
            </p>
          )}
          <p className="mt-3 text-sm text-[var(--text-muted)]">Open until {day(v.expiresAt)}.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={() => respond("accept")} loading={busy} data-testid="portal-accept">
              Accept {usd(v.offeredUsd)}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setCounterOpen(!counterOpen)}
              aria-expanded={counterOpen}
              data-testid="portal-counter-toggle"
            >
              Suggest a different fee
            </Button>
            <Button
              variant="secondary"
              onClick={() => setConfirmDecline(true)}
              data-testid="portal-decline"
            >
              Decline
            </Button>
          </div>
          {counterOpen && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                respond("counter");
              }}
              className="mt-4 grid max-w-md gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
              aria-label="Suggest a different fee"
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="counter-amount" className="text-sm font-medium">
                  Your fee (USD)
                </label>
                <input
                  id="counter-amount"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={box}
                  data-testid="counter-amount"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="counter-note" className="text-sm font-medium">
                  Note to the brand (optional)
                </label>
                <textarea
                  id="counter-note"
                  rows={3}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={`${box} py-2`}
                  data-testid="counter-note"
                />
              </div>
              <div>
                <Button type="submit" loading={busy} data-testid="counter-submit">
                  Send proposal
                </Button>
              </div>
            </form>
          )}
          {confirmDecline && (
            <div
              role="group"
              aria-label="Confirm decline"
              className="mt-4 max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <p>
                Decline this invitation? You won&apos;t be able to change your mind from this page.
              </p>
              <div className="mt-3 flex gap-3">
                <Button
                  variant="destructive"
                  onClick={() => respond("decline")}
                  loading={busy}
                  data-testid="decline-confirm"
                >
                  Yes, decline
                </Button>
                <Button variant="secondary" onClick={() => setConfirmDecline(false)}>
                  Keep the invitation
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {v.state === "countered" && (
        <div className="mt-5" data-testid="portal-countered">
          <p>
            You proposed <strong>{usd(v.counterUsd ?? 0)}</strong> instead of {usd(v.offeredUsd)}.
          </p>
          {v.creatorNote && (
            <p className="mt-2 text-[var(--text-muted)]">Your note: {v.creatorNote}</p>
          )}
          <p className="mt-2 text-[var(--text-muted)]">
            We&apos;ll email you when {v.brand} replies.
          </p>
        </div>
      )}

      {v.state === "expired" && (
        <p className="mt-5 text-[var(--text-muted)]">
          This offer was open until {day(v.expiresAt)}. Ask {v.brand} to send a new one and
          you&apos;ll get a fresh email.
        </p>
      )}
      {v.state === "superseded" && (
        <p className="mt-5 text-[var(--text-muted)]">
          {v.brand} sent you a revised offer. Open the newest email from them to answer it; this
          link no longer works.
        </p>
      )}
      {v.state === "revoked" && (
        <p className="mt-5 text-[var(--text-muted)]">
          {v.brand} withdrew this invitation. Nothing is needed from you.
        </p>
      )}
      {v.state === "declined" && (
        <p className="mt-5 text-[var(--text-muted)]">
          No further action is needed. Thank you for letting us know.
        </p>
      )}

      {accepted && v.contract && (
        <ContractSection token={token} contract={v.contract} brand={v.brand} onView={setV} />
      )}

      {accepted && (
        <section aria-labelledby="content-h" className="mt-6">
          <h2 id="content-h" className="text-xl font-semibold">
            Your content
          </h2>
          {v.state === "approved" && (
            <p className="mt-2" data-testid="portal-approved">
              Approved. {usd(v.agreedUsd ?? 0)} is next; we&apos;ll email you when it&apos;s sent.
            </p>
          )}
          {v.state === "paid" && (
            <p className="mt-2" data-testid="portal-paid">
              {usd(v.agreedUsd ?? 0)} was marked as paid. Thank you!
            </p>
          )}
          {v.trackingLink && (
            <div
              className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
              data-testid="portal-tracking"
            >
              <p className="font-medium">Your tracking link</p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Use this link in your post or bio, so visits and sales that come from you are
                credited to you.
              </p>
              <div className="mt-2">
                <CopyField
                  label="your tracking link"
                  value={v.trackingLink}
                  testId="portal-tracking-link"
                />
              </div>
            </div>
          )}
          {changes && v.state === "confirmed" && (
            <div
              role="status"
              className="mt-3 rounded-lg border border-[var(--warning)] p-4"
              data-testid="portal-feedback"
            >
              <p className="font-medium">
                {v.brand} asked for changes (version {changes.version}):
              </p>
              <p className="mt-1 whitespace-pre-line">{changes.feedback}</p>
            </div>
          )}
          {v.state === "confirmed" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  setError("");
                  const r = await submitContentAction(token, url, caption);
                  if (!r.ok) return setError(r.error);
                  setV(r.view);
                  setUrl("");
                  setCaption("");
                });
              }}
              noValidate
              className="mt-3 grid max-w-xl gap-3"
              aria-label="Submit content"
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="content-url" className="text-sm font-medium">
                  Link to your post
                </label>
                <input
                  id="content-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://"
                  className={box}
                  data-testid="content-url"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="content-caption" className="text-sm font-medium">
                  Caption (optional)
                </label>
                <textarea
                  id="content-caption"
                  rows={3}
                  maxLength={2000}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  className={`${box} py-2`}
                  data-testid="content-caption"
                />
              </div>
              {contractBlocks && (
                <p className="text-sm text-[var(--text-muted)]" data-testid="content-blocked">
                  Sign your agreement above before you submit content.
                </p>
              )}
              <div>
                <Button
                  type="submit"
                  loading={busy}
                  disabled={contractBlocks}
                  data-testid="content-submit"
                >
                  {changes ? "Submit a new version" : "Submit for review"}
                </Button>
              </div>
            </form>
          )}
          {v.content.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2" data-testid="portal-versions">
              {[...v.content].reverse().map((c) => (
                <li
                  key={c.version}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
                >
                  <p className="font-medium">
                    Version {c.version} ·{" "}
                    {c.status === "approved"
                      ? "Approved"
                      : c.status === "changes_requested"
                        ? "Changes requested"
                        : "Waiting for review"}
                  </p>
                  <a
                    href={c.url}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    className="break-all text-[var(--primary)] underline"
                  >
                    {c.url}
                  </a>
                  {c.caption && (
                    <p className="mt-1 whitespace-pre-line text-[var(--text-muted)]">{c.caption}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {accepted && v.payout.enabled && (
        <PayoutSection token={token} payout={v.payout} agreedUsd={v.agreedUsd} onView={setV} />
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-[var(--danger)]" data-testid="portal-error">
          {error}
        </p>
      )}
    </div>
  );
}
