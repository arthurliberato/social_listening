// When a scheduled report is next due. Pure, UTC, and always strictly after the reference time.
export const FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export interface When {
  frequency: Frequency;
  /** 0 = Sunday .. 6 = Saturday (weekly). */
  weekday: number;
  /** 1..28, so every month has it (monthly). */
  dayOfMonth: number;
  hourUtc: number;
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function nextRun(after: Date, w: When): Date {
  const y = after.getUTCFullYear();
  const m = after.getUTCMonth();
  const d = after.getUTCDate();
  const at = (yy: number, mm: number, dd: number) =>
    new Date(Date.UTC(yy, mm, dd, w.hourUtc, 0, 0, 0));
  if (w.frequency === "daily") {
    const t = at(y, m, d);
    return t > after ? t : at(y, m, d + 1);
  }
  if (w.frequency === "weekly") {
    const ahead = (w.weekday - after.getUTCDay() + 7) % 7;
    const t = at(y, m, d + ahead);
    return t > after ? t : at(y, m, d + ahead + 7);
  }
  const t = at(y, m, w.dayOfMonth);
  return t > after ? t : at(y, m + 1, w.dayOfMonth);
}

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;

export function describeSchedule(w: When): string {
  const time = `${String(w.hourUtc).padStart(2, "0")}:00 UTC`;
  if (w.frequency === "daily") return `Every day at ${time}`;
  if (w.frequency === "weekly") return `Every ${WEEKDAY_NAMES[w.weekday]} at ${time}`;
  return `On the ${ordinal(w.dayOfMonth)} of every month at ${time}`;
}
