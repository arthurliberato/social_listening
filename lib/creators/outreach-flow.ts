// The rules of creator outreach, kept free of the database so they can be tested directly. The server code in
// outreach.ts and the portal actions apply them; the interface only offers what they allow.

export const INVITE_TTL_DAYS = 14;
export const MAX_OFFER_USD = 1_000_000;

export type InviteStatus =
  "sent" | "accepted" | "declined" | "countered" | "superseded" | "revoked";
export type Response = "accept" | "decline" | "counter";

/** 48 hex characters, the same shape as the quote links; unguessable and not derived from anything. */
export const newToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export const isToken = (s: string) => /^[0-9a-f]{48}$/.test(s);

export const expiryFrom = (now: Date) => new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);

export interface InviteLike {
  status: string;
  offeredUsd: number;
  expiresAt: Date;
}

/** What the creator is looking at: an invitation they can answer, or one they can't (and why). */
export function inviteState(i: InviteLike, now: Date): "open" | "expired" | InviteStatus {
  if (i.status === "sent") return i.expiresAt.getTime() > now.getTime() ? "open" : "expired";
  return i.status as InviteStatus;
}

export function checkOffer(
  usd: unknown,
): { ok: true; usd: number } | { ok: false; reason: string } {
  const n = typeof usd === "string" && usd.trim() !== "" ? Number(usd) : usd;
  if (typeof n !== "number" || !Number.isInteger(n))
    return { ok: false, reason: "Enter the amount in whole dollars." };
  if (n < 1) return { ok: false, reason: "The amount must be at least $1." };
  if (n > MAX_OFFER_USD)
    return {
      ok: false,
      reason: `The amount can't be more than $${MAX_OFFER_USD.toLocaleString("en-US")}.`,
    };
  return { ok: true, usd: n };
}

export function checkResponse(
  invite: InviteLike,
  now: Date,
  kind: Response,
  counterUsd?: unknown,
): { ok: true; counter?: number } | { ok: false; reason: string } {
  const state = inviteState(invite, now);
  if (state === "expired")
    return { ok: false, reason: "This invitation has expired. Ask the brand to send a new one." };
  if (state === "superseded" || state === "revoked")
    return {
      ok: false,
      reason: "This invitation is no longer active. Check your email for a newer one.",
    };
  if (state !== "open") return { ok: false, reason: "You've already answered this invitation." };
  if (kind !== "counter") return { ok: true };
  const c = checkOffer(counterUsd);
  if (!c.ok) return c;
  if (c.usd === invite.offeredUsd)
    return {
      ok: false,
      reason: "That's the amount already offered. Accept it, or propose a different one.",
    };
  return { ok: true, counter: c.usd };
}

/** Where a creator's place on the campaign moves when they answer. */
export const STATUS_AFTER_RESPONSE = {
  accept: "confirmed",
  decline: "declined",
  counter: "negotiating",
} as const;

/** A creator can only answer while they're invited or negotiating; anything later has already been decided. */
export const ANSWERABLE_FROM = ["invited", "negotiating"] as const;
/** Sending (or re-sending) an invitation is possible from these places on the campaign. */
export const INVITABLE_FROM = ["shortlisted", "invited", "negotiating"] as const;
/** Content can be submitted once confirmed, and again after changes were requested. */
export const SUBMITTABLE_FROM = ["confirmed"] as const;

export function checkSubmission(
  url: string,
  caption: string,
): { ok: true; url: string; caption: string } | { ok: false; reason: string } {
  const u = url.trim();
  if (!u) return { ok: false, reason: "Add the link to your post." };
  if (u.length > 500) return { ok: false, reason: "That link is too long." };
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return { ok: false, reason: "Enter a full link, starting with https://" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    return { ok: false, reason: "Enter a full link, starting with https://" };
  if (caption.length > 2000)
    return { ok: false, reason: "Keep the caption under 2,000 characters." };
  return { ok: true, url: parsed.toString(), caption: caption.trim() };
}

export function checkReview(
  decision: "approve" | "changes",
  feedback: string,
): { ok: true; feedback: string } | { ok: false; reason: string } {
  const f = feedback.trim();
  if (decision === "changes" && f.length < 5)
    return { ok: false, reason: "Say what needs to change, so the creator knows what to fix." };
  if (f.length > 2000) return { ok: false, reason: "Keep the feedback under 2,000 characters." };
  return { ok: true, feedback: f };
}

export function defaultMessage(o: { brand: string; campaign: string; creator: string }) {
  const first = o.creator.split(/\s+/)[0] ?? o.creator;
  return `Hi ${first},\n\nWe're ${o.brand} and we'd love to work with you on "${o.campaign}". The offer, the brief and the dates are on the page linked below, where you can accept, decline, or suggest a different fee.\n\nThanks,\n${o.brand}`;
}

export const creatorAddress = (handle: string) => `${handle.toLowerCase()}@creators.example.test`;
