"use client";

import { useRef, useState } from "react";
import {
  resolveCounterAction,
  reviewContentAction,
  revokeInvitationAction,
  sendInvitationAction,
} from "@/app/w/[ws]/creators/campaigns/outreach-actions";
import { PaywallModal } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import type { CampaignSnapshot } from "@/lib/creators/campaigns";
import { defaultMessage } from "@/lib/creators/outreach-flow";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { useBusy } from "@/lib/use-busy";

type Row = CampaignSnapshot["roster"][number];
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const box =
  "min-h-8 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm disabled:opacity-60";
const small =
  "min-h-8 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-2)] disabled:opacity-60";

/** Outreach for one creator on one campaign: invite, follow the answer, settle a counter, review content. */
export function OutreachPanel({
  ws,
  campaignId,
  brand,
  campaignName,
  row,
  quota,
  editable,
  onSnapshot,
}: {
  ws: string;
  campaignId: string;
  brand: string;
  campaignName: string;
  row: Row;
  quota: { used: number; limit: number };
  editable: boolean;
  onSnapshot: (s: CampaignSnapshot) => void;
}) {
  const [form, setForm] = useState<null | "invite" | "revise" | "counter-revise" | "changes">(null);
  const [offer, setOffer] = useState(
    String(row.invite?.counterUsd ?? row.invite?.offeredUsd ?? row.suggestedFee),
  );
  const [message, setMessage] = useState(
    defaultMessage({ brand, campaign: campaignName, creator: row.displayName }),
  );
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState<{ reason: string; to: PlanTier } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, run] = useBusy();
  const linkRef = useRef<HTMLInputElement>(null);
  const ids = { campaignId, creatorId: row.creatorId };
  const inv = row.invite;

  const call = (fn: () => ReturnType<typeof sendInvitationAction>, after?: () => void) =>
    run(async () => {
      setError("");
      const r = await fn();
      if (!r.ok) {
        if (r.upgradeTo) return setPaywall({ reason: r.error, to: r.upgradeTo });
        return setError(r.error);
      }
      onSnapshot(r.snapshot);
      setForm(null);
      setFeedback("");
      after?.();
    });

  const canSend =
    editable &&
    ["shortlisted", "invited", "negotiating"].includes(row.status) &&
    !(inv && inv.status === "countered");
  const p = paywall ? PLANS[paywall.to] : null;

  const sendForm = (kind: "invite" | "revise" | "counter-revise") => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (kind === "counter-revise")
          call(() =>
            resolveCounterAction(ws, { ...ids, decision: "revise", revisedUsd: offer, message }),
          );
        else call(() => sendInvitationAction(ws, { ...ids, offeredUsd: offer, message }));
      }}
      className="grid max-w-lg gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
      aria-label={`${kind === "invite" ? "Invite" : "Send a revised offer to"} ${row.displayName}`}
      data-testid="invite-form"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`offer-${row.creatorId}`} className="text-xs text-[var(--text-muted)]">
          Offer per post (USD)
        </label>
        <input
          id={`offer-${row.creatorId}`}
          inputMode="numeric"
          value={offer}
          onChange={(e) => setOffer(e.target.value)}
          className={`${box} w-32 tabular-nums`}
          data-testid="invite-offer"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`msg-${row.creatorId}`} className="text-xs text-[var(--text-muted)]">
          Message to {row.displayName}
        </label>
        <textarea
          id={`msg-${row.creatorId}`}
          rows={5}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={`${box} py-2`}
          data-testid="invite-message"
        />
      </div>
      <p className="text-xs text-[var(--text-muted)]" data-testid="invite-quota">
        {quota.used} of {quota.limit} invitations used this month. The creator gets an email with a
        link to their own page.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy} data-testid="invite-send">
          {kind === "invite" ? "Send invitation" : "Send revised offer"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setForm(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );

  return (
    <div className="flex flex-col gap-2" data-testid="outreach">
      {inv && (
        <div className="text-sm" data-testid="invite-summary">
          <p>
            <strong data-testid="invite-status">
              {inv.status === "sent"
                ? !inv.open
                  ? "Invitation expired"
                  : inv.viewed
                    ? "Invitation opened"
                    : "Invitation sent"
                : inv.status === "countered"
                  ? "Creator countered"
                  : inv.status === "accepted"
                    ? "Offer accepted"
                    : inv.status === "declined"
                      ? "Offer declined"
                      : inv.status === "revoked"
                        ? "Invitation withdrawn"
                        : "Replaced by a newer offer"}
            </strong>{" "}
            · {usd(inv.offeredUsd)} offered · sent {day(inv.sentAt)}
            {inv.status === "sent" && inv.open ? ` · open until ${day(inv.expiresAt)}` : ""}
            {inv.round > 1 ? ` · round ${inv.round}` : ""}
          </p>
          {["sent", "countered", "accepted"].includes(inv.status) && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label htmlFor={`link-${row.creatorId}`} className="sr-only">
                Creator link for {row.displayName}
              </label>
              <input
                id={`link-${row.creatorId}`}
                ref={linkRef}
                readOnly
                value={inv.link}
                onFocus={(e) => e.currentTarget.select()}
                className={`${box} w-72 max-w-full font-mono text-xs`}
                data-testid="invite-link"
              />
              <button
                type="button"
                className={small}
                data-testid="copy-link"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inv.link);
                  } catch {
                    linkRef.current?.select();
                    document.execCommand?.("copy");
                  }
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2500);
                }}
              >
                Copy link<span className="sr-only"> for {row.displayName}</span>
              </button>
              <span role="status" className="text-xs text-[var(--text-muted)]">
                {copied ? "Copied" : ""}
              </span>
            </div>
          )}
        </div>
      )}

      {inv?.status === "countered" && editable && (
        <div
          className="rounded-lg border border-[var(--warning)] p-3 text-sm"
          data-testid="counter-panel"
        >
          <p>
            <strong>{row.displayName}</strong> proposed{" "}
            <strong data-testid="counter-amount-shown">{usd(inv.counterUsd ?? 0)}</strong> instead
            of {usd(inv.offeredUsd)}.
          </p>
          {inv.creatorNote && <p className="mt-1 text-[var(--text-muted)]">“{inv.creatorNote}”</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={small}
              disabled={busy}
              data-testid="counter-accept"
              onClick={() => call(() => resolveCounterAction(ws, { ...ids, decision: "accept" }))}
            >
              Accept {usd(inv.counterUsd ?? 0)}
              <span className="sr-only"> from {row.displayName}</span>
            </button>
            <button
              type="button"
              className={small}
              disabled={busy}
              data-testid="counter-revise"
              onClick={() => setForm("counter-revise")}
            >
              Send a revised offer<span className="sr-only"> to {row.displayName}</span>
            </button>
            <button
              type="button"
              className={small}
              disabled={busy}
              data-testid="counter-decline"
              onClick={() => call(() => resolveCounterAction(ws, { ...ids, decision: "decline" }))}
            >
              Decline<span className="sr-only"> {row.displayName}&apos;s proposal</span>
            </button>
          </div>
        </div>
      )}

      {row.status === "content_submitted" && row.content && (
        <div
          className="rounded-lg border border-[var(--border)] p-3 text-sm"
          data-testid="review-panel"
        >
          <p className="font-medium">Content to review (version {row.content.version})</p>
          <a
            href={row.content.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-all text-[var(--primary)] underline"
            data-testid="review-url"
          >
            {row.content.url}
          </a>
          {row.content.caption && (
            <p className="mt-1 whitespace-pre-line text-[var(--text-muted)]">
              {row.content.caption}
            </p>
          )}
          {editable && form !== "changes" && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={small}
                disabled={busy}
                data-testid="review-approve"
                onClick={() =>
                  call(() => reviewContentAction(ws, { ...ids, decision: "approve", feedback: "" }))
                }
              >
                Approve content<span className="sr-only"> from {row.displayName}</span>
              </button>
              <button
                type="button"
                className={small}
                disabled={busy}
                data-testid="review-changes"
                onClick={() => setForm("changes")}
              >
                Request changes<span className="sr-only"> from {row.displayName}</span>
              </button>
            </div>
          )}
          {editable && form === "changes" && (
            <form
              className="mt-2 grid gap-2"
              aria-label={`Request changes from ${row.displayName}`}
              onSubmit={(e) => {
                e.preventDefault();
                call(() => reviewContentAction(ws, { ...ids, decision: "changes", feedback }));
              }}
            >
              <label htmlFor={`fb-${row.creatorId}`} className="text-xs text-[var(--text-muted)]">
                What needs to change?
              </label>
              <textarea
                id={`fb-${row.creatorId}`}
                rows={3}
                maxLength={2000}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                className={`${box} py-2`}
                data-testid="review-feedback"
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={busy} data-testid="review-changes-send">
                  Send feedback
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setForm(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
      {row.content?.status === "changes_requested" && row.status === "confirmed" && (
        <p className="text-sm text-[var(--text-muted)]" data-testid="awaiting-resubmission">
          Changes requested on version {row.content.version}. Waiting for {row.displayName} to
          resubmit.
        </p>
      )}

      {form === "invite" && sendForm("invite")}
      {form === "revise" && sendForm("revise")}
      {form === "counter-revise" && sendForm("counter-revise")}

      {!form && canSend && (
        <div className="flex flex-wrap gap-2">
          {inv && inv.status === "sent" ? (
            <>
              <button
                type="button"
                className={small}
                disabled={busy}
                data-testid="invite-revise"
                onClick={() => {
                  setOffer(String(inv.offeredUsd));
                  setForm("revise");
                }}
              >
                Send a new offer<span className="sr-only"> to {row.displayName}</span>
              </button>
              <button
                type="button"
                className={small}
                disabled={busy}
                data-testid="invite-withdraw"
                onClick={() => call(() => revokeInvitationAction(ws, ids))}
              >
                Withdraw invitation<span className="sr-only"> for {row.displayName}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className={small}
              disabled={busy}
              data-testid="invite-open"
              onClick={() => setForm("invite")}
            >
              {inv ? "Send a new invitation" : "Send invitation"}
              <span className="sr-only"> to {row.displayName}</span>
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]" data-testid="outreach-error">
          {error}
        </p>
      )}
      {paywall && p && (
        <PaywallModal
          trigger="outreach_quota"
          title="You've used this month's creator invitations"
          reason={paywall.reason}
          planLabel={p.label}
          priceLine={p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined}
          bullets={[
            `${p.invitationsPerMonth} creator invitations per month`,
            `${p.activeCampaigns} active campaigns`,
            "Audience insights and list export",
          ]}
          onClose={() => setPaywall(null)}
        />
      )}
    </div>
  );
}
