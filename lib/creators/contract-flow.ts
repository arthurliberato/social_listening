// The rules of creator contracts and payouts, kept free of the database so they can be tested directly: what the
// terms are and how they read, what counts as a signature, when a creator may be paid, and how the simulated payout
// rail behaves. The server code in contracts.ts and payouts.ts applies them; the interface only offers what they allow.

export const USAGE_OPTIONS = [0, 30, 90, 180, 365] as const; // days the brand may reuse the content
export const PAYMENT_DAY_OPTIONS = [0, 7, 14, 30] as const; // days after approval the brand pays
export const SETTLE_DAYS = 2; // simulated days for a payout to settle

export type ContractStatus = "sent" | "signed" | "changes_requested" | "superseded" | "withdrawn";

export interface Terms {
  deliverables: string;
  usageDays: number;
  exclusivityDays: number;
  paymentDays: number;
  /** YYYY-MM-DD the content is due by, or null for "as agreed". */
  dueOn: string | null;
  extra: string;
}

export function checkTerms(
  input: Partial<Record<keyof Terms, unknown>>,
): { ok: true; terms: Terms } | { ok: false; reason: string } {
  const deliverables = String(input.deliverables ?? "").trim();
  if (deliverables.length < 3) return { ok: false, reason: "Say what the creator will deliver." };
  if (deliverables.length > 500)
    return { ok: false, reason: "Keep the deliverables under 500 characters." };
  const usageDays = Number(input.usageDays ?? 0);
  if (!(USAGE_OPTIONS as readonly number[]).includes(usageDays))
    return { ok: false, reason: "Pick one of the usage periods listed." };
  const exclusivityDays = Number(input.exclusivityDays ?? 0);
  if (!Number.isInteger(exclusivityDays) || exclusivityDays < 0 || exclusivityDays > 365)
    return { ok: false, reason: "Exclusivity is a whole number of days from 0 to 365." };
  const paymentDays = Number(input.paymentDays ?? 0);
  if (!(PAYMENT_DAY_OPTIONS as readonly number[]).includes(paymentDays))
    return { ok: false, reason: "Pick one of the payment timings listed." };
  const dueRaw = input.dueOn === undefined || input.dueOn === null ? "" : String(input.dueOn);
  if (dueRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dueRaw))
    return { ok: false, reason: "Enter the due date as a calendar date." };
  const extra = String(input.extra ?? "").trim();
  if (extra.length > 1500)
    return { ok: false, reason: "Keep additional terms under 1,500 characters." };
  return {
    ok: true,
    terms: { deliverables, usageDays, exclusivityDays, paymentDays, dueOn: dueRaw || null, extra },
  };
}

const days = (n: number, none: string) => (n === 0 ? none : `${n} days`);

/**
 * The agreement as the creator reads and signs it. It is rendered once, stored word for word, and hashed, so what
 * was signed can't change afterwards even if the template does.
 */
export function renderContract(o: {
  brand: string;
  creator: string;
  campaign: string;
  feeUsd: number;
  terms: Terms;
}): string {
  const t = o.terms;
  const lines = [
    `CREATOR AGREEMENT`,
    ``,
    `Between ${o.brand} (the brand) and ${o.creator} (the creator), for the campaign "${o.campaign}".`,
    ``,
    `1. Deliverables. ${t.deliverables}`,
    `2. Fee. The brand will pay the creator $${o.feeUsd.toLocaleString("en-US")} for the deliverables above.`,
    `3. Timing. ${t.dueOn ? `The content is due by ${t.dueOn}.` : "The content is due on the dates agreed for the campaign."}`,
    `4. Approval. The brand will review the content and either approve it or ask for specific changes. The creator may resubmit.`,
    `5. Payment. ${t.paymentDays === 0 ? "The brand will pay as soon as the content is approved." : `The brand will pay within ${t.paymentDays} days of approving the content.`}`,
    `6. Usage rights. ${t.usageDays === 0 ? "The brand may share the content only on the creator's own post." : `The brand may reuse the content in its own channels for ${t.usageDays} days after it is approved.`}`,
    `7. Exclusivity. ${t.exclusivityDays === 0 ? "The creator may work with other brands in the same category." : `For ${t.exclusivityDays} days after posting, the creator will not promote a direct competitor of the brand.`}`,
    `8. Disclosure. The creator will label the content as a paid partnership as the platform and local law require.`,
  ];
  if (t.extra) lines.push(`9. Additional terms. ${t.extra}`);
  return lines.join("\n");
}

export const termsSummary = (t: Terms) =>
  `${days(t.usageDays, "own post only")} usage · ${days(t.exclusivityDays, "no")} exclusivity · pay ${t.paymentDays === 0 ? "on approval" : `within ${t.paymentDays} days`}`;

export function checkSignature(
  name: string,
  agree: boolean,
): { ok: true; name: string } | { ok: false; reason: string } {
  const n = name.trim().replace(/\s+/g, " ");
  if (n.length < 2) return { ok: false, reason: "Type your full name to sign." };
  if (n.length > 100) return { ok: false, reason: "That name is too long." };
  if (!agree) return { ok: false, reason: "Tick the box to confirm you agree to the terms." };
  return { ok: true, name: n };
}

// ---- Payout details and the simulated rail ----

export type PayoutStatus = "processing" | "paid" | "failed" | "canceled";

/**
 * Test accounts, in the manner of a payment processor's test mode. No account number is ever stored, only its
 * last four digits and how it behaves.
 */
export const TEST_ACCOUNTS = [
  { number: "000123456789", what: "Works every time" },
  {
    number: "000999999991",
    what: "Saves fine, then every payout to it fails (to see a failed payout)",
  },
  { number: "000999999992", what: "Can't be verified when you try to save it" },
] as const;

export type AccountBehavior = "ok" | "fail_payout";

export function checkPayoutDetails(input: {
  holderName: string;
  accountNumber: string;
  country: string;
}):
  | { ok: true; holderName: string; last4: string; country: string; behavior: AccountBehavior }
  | { ok: false; field: "holderName" | "accountNumber" | "country"; reason: string } {
  const holderName = input.holderName.trim().replace(/\s+/g, " ");
  if (holderName.length < 2)
    return { ok: false, field: "holderName", reason: "Enter the name on the account." };
  const n = input.accountNumber.replace(/[\s-]/g, "");
  if (!/^\d{8,17}$/.test(n))
    return { ok: false, field: "accountNumber", reason: "An account number is 8 to 17 digits." };
  const country = input.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country))
    return { ok: false, field: "country", reason: "Pick the account's country." };
  if (n === "000999999992")
    return {
      ok: false,
      field: "accountNumber",
      reason: "We couldn't verify that account. Check the number or try another.",
    };
  return {
    ok: true,
    holderName,
    last4: n.slice(-4),
    country,
    behavior: n === "000999999991" ? "fail_payout" : "ok",
  };
}

export interface PayState {
  rosterStatus: string;
  feeUsd: number | null;
  hasDetails: boolean;
  /** Is there a contract that has been sent and is not signed (a withdrawn or replaced one doesn't count)? */
  contractOutstanding: boolean;
  /** An initiated payout that hasn't failed or been canceled. */
  activePayout: boolean;
}

/** Why a creator can't be paid yet, in the words the brand should read; null means go ahead. */
export function payBlocker(s: PayState): string | null {
  if (s.rosterStatus === "paid") return "This creator has already been paid.";
  if (s.rosterStatus !== "approved") return "Approve the creator's content before paying.";
  if (!s.feeUsd || s.feeUsd <= 0) return "Set the agreed fee first.";
  if (s.contractOutstanding) return "The creator hasn't signed the agreement yet.";
  if (!s.hasDetails) return "The creator hasn't added their payout details yet.";
  if (s.activePayout) return "A payout is already on its way.";
  return null;
}

export const settleAt = (initiated: Date) =>
  new Date(initiated.getTime() + SETTLE_DAYS * 86_400_000);

/** What happens when a payout comes due, given how the creator's account behaves. */
export function outcomeFor(
  behavior: string,
): { status: "paid" } | { status: "failed"; reason: string } {
  return behavior === "fail_payout"
    ? { status: "failed", reason: "The bank rejected the transfer (account closed)." }
    : { status: "paid" };
}

/** Can the creator submit content? Not while an agreement waits for their signature. */
export const contractBlocksContent = (contractOutstanding: boolean) => contractOutstanding;
