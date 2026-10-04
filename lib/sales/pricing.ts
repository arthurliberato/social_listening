// Enterprise quotes: a platform fee plus a per-seat fee, with a discount for longer terms.
export const TERMS = [12, 24, 36] as const;
export const PLATFORM_CENTS_PER_MONTH = 150_000;
export const SEAT_CENTS_PER_MONTH = 4_000;
export const TERM_DISCOUNT: Record<number, number> = { 12: 0.1, 24: 0.15, 36: 0.2 };
export const MIN_SEATS = 5;
export const MAX_SEATS = 5_000;

/** Total contract value in cents, over the whole term. */
export function quoteValueCents(seats: number, termMonths: number): number {
  const monthly = PLATFORM_CENTS_PER_MONTH + SEAT_CENTS_PER_MONTH * seats;
  const disc = TERM_DISCOUNT[termMonths] ?? 0;
  return Math.round(monthly * termMonths * (1 - disc));
}

export const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
