// Billing and trial-lifecycle email copy. Plain, specific, and always says what to do next.
import { APP_URL } from "@/lib/email/service";
import { money } from "./pricing";

const BILLING = `${APP_URL}/settings/billing`;
const PLANS_URL = `${APP_URL}/upgrade`;
const date = (d: Date) => d.toISOString().slice(0, 10);

export const receiptEmail = (o: {
  number: string;
  description: string;
  amountCents: number;
  discountCents: number;
  plan: string;
  nextChargeOn: Date | null;
}) => ({
  subject: `Receipt ${o.number} from Ripplewise — ${money(o.amountCents)}`,
  text: [
    `Thanks. We charged ${money(o.amountCents)} for ${o.description}.`,
    o.discountCents ? `That includes a discount of ${money(o.discountCents)}.` : "",
    "",
    `Receipt number: ${o.number}`,
    `Plan: ${o.plan}`,
    o.nextChargeOn
      ? `Next charge: ${date(o.nextChargeOn)} (you can change or cancel before then)`
      : "",
    "",
    `View all invoices: ${BILLING}`,
  ]
    .filter((l, i, a) => !(l === "" && (i === 0 || a[i - 1] === "")) || i === 2)
    .join("\n"),
});

export const trialEndingEmail = (daysLeft: number, endsOn: Date) => ({
  subject:
    daysLeft <= 1
      ? "Your Ripplewise trial ends tomorrow"
      : `Your Ripplewise trial ends in ${daysLeft} days`,
  text: [
    `Your free trial ends on ${date(endsOn)}.`,
    "",
    "Pick a plan to keep collecting mentions, alerts and reports without a break. Plans start at $79 a month, and you can cancel any time from Billing.",
    "",
    `Choose a plan: ${PLANS_URL}`,
    "",
    "If you do nothing, you keep read-only access for 3 days, then your data is held (not deleted) until you pick a plan.",
  ].join("\n"),
});

export const trialEndedEmail = (graceEnds: Date) => ({
  subject: "Your Ripplewise trial has ended",
  text: [
    "Your free trial has ended, but nothing has been switched off yet.",
    "",
    `You have until ${date(graceEnds)} to choose a plan. After that your workspace becomes read-only: collection, alerts and scheduled reports pause, and you can still view and export everything.`,
    "",
    `Choose a plan: ${PLANS_URL}`,
  ].join("\n"),
});

export const lockedEmail = (reason: "trial" | "payment") => ({
  subject:
    reason === "trial"
      ? "Your Ripplewise workspace is now read-only"
      : "Your Ripplewise subscription was suspended",
  text: [
    reason === "trial"
      ? "Your trial and grace period are over, so your workspace is read-only."
      : "We couldn't collect payment after several tries, so your subscription is suspended and your workspace is read-only.",
    "",
    "Nothing is deleted. You can still view and export your data. Collection, alerts and scheduled reports are paused.",
    "",
    reason === "trial"
      ? `Choose a plan to switch everything back on: ${PLANS_URL}`
      : `Add a working card to switch everything back on: ${BILLING}`,
  ].join("\n"),
});

export const paymentFailedEmail = (o: {
  attempt: number;
  amountCents: number;
  retryOn: Date | null;
  reason: string;
}) => ({
  subject: o.retryOn
    ? `Payment failed — we'll try again on ${date(o.retryOn)}`
    : "Final notice: payment failed and your subscription is being suspended",
  text: [
    `We tried to charge ${money(o.amountCents)} for your Ripplewise plan and it didn't go through (${o.reason}).`,
    "",
    o.retryOn
      ? `We'll try again on ${date(o.retryOn)}. Your access isn't affected in the meantime. To fix it now, update your card and we'll retry straight away.`
      : "This was our last attempt. Your workspace is now read-only until the payment goes through.",
    "",
    `Update your card: ${BILLING}`,
  ].join("\n"),
});

export const canceledEmail = (endsOn: Date) => ({
  subject: "Your Ripplewise cancellation is confirmed",
  text: [
    `Your plan is cancelled. You keep full access until ${date(endsOn)}, and you won't be charged again.`,
    "",
    "Changed your mind? You can resume any time before then and nothing changes.",
    "",
    `Resume or review: ${BILLING}`,
    "",
    "After that your workspace becomes read-only. Your data is kept and you can still export it.",
  ].join("\n"),
});

export const downgradeBlockedEmail = (target: string, blockers: string[]) => ({
  subject: `We couldn't move you to ${target}`,
  text: [
    `You asked to switch to ${target} at your renewal, but your account is over some of its limits, so we've kept your current plan and renewed it.`,
    "",
    ...blockers.map((b) => `• ${b}`),
    "",
    `Fix those, then choose the plan again: ${BILLING}`,
  ].join("\n"),
});
