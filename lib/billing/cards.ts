// Test-mode card handling. The simulated provider mirrors the well-known test numbers of real processors.
export type Behavior = "ok" | "fail_renewal";

export interface CardInput {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  name: string;
}

export const TEST_CARDS = [
  { number: "4242 4242 4242 4242", what: "Succeeds every time" },
  {
    number: "4000 0000 0000 0341",
    what: "Saves fine, then every renewal charge fails (to see dunning)",
  },
  { number: "4000 0000 0000 0002", what: "Declined when you try to save it" },
] as const;

const digits = (s: string) => s.replace(/[\s-]/g, "");

export function luhn(n: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = n.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function brandOf(n: string): string {
  if (/^4/.test(n)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "Amex";
  return "Card";
}

export type CardResult =
  | { ok: true; brand: string; last4: string; behavior: Behavior }
  | { ok: false; field?: "number" | "expiry" | "cvc" | "name"; error: string };

/** Validates a card the way a checkout form must, then applies the test-number rules. */
export function checkCard(c: CardInput, now: Date): CardResult {
  const n = digits(c.number);
  if (!/^\d{13,19}$/.test(n) || !luhn(n))
    return {
      ok: false,
      field: "number",
      error: "That card number doesn't look right. Check it and try again.",
    };
  const y = c.expYear < 100 ? 2000 + c.expYear : c.expYear;
  if (!(c.expMonth >= 1 && c.expMonth <= 12))
    return { ok: false, field: "expiry", error: "Enter the expiry as MM/YY." };
  const endOfExpiryMonth = Date.UTC(y, c.expMonth, 1);
  if (endOfExpiryMonth <= now.getTime())
    return { ok: false, field: "expiry", error: "That card has expired." };
  if (!/^\d{3,4}$/.test(c.cvc))
    return { ok: false, field: "cvc", error: "The security code is 3 or 4 digits." };
  if (!c.name.trim()) return { ok: false, field: "name", error: "Enter the name on the card." };
  if (n === "4000000000000002")
    return { ok: false, field: "number", error: "Your card was declined. Try a different card." };
  return {
    ok: true,
    brand: brandOf(n),
    last4: n.slice(-4),
    behavior: n === "4000000000000341" ? "fail_renewal" : "ok",
  };
}

/** "4242424242424242" → "4242 4242 4242 4242" while typing. */
export const formatCardNumber = (s: string) =>
  digits(s)
    .slice(0, 19)
    .replace(/(.{4})/g, "$1 ")
    .trim();

/** "1230" / "12/30" → { expMonth: 12, expYear: 2030 } or null. */
export function parseExpiry(s: string): { expMonth: number; expYear: number } | null {
  const m = /^\s*(\d{1,2})\s*\/?\s*(\d{2}|\d{4})\s*$/.exec(s);
  if (!m) return null;
  const y = Number(m[2]);
  return { expMonth: Number(m[1]), expYear: y < 100 ? 2000 + y : y };
}
