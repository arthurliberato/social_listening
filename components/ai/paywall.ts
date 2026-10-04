import type { PaywallProps } from "@/components/listening/PaywallModal";

export interface Upgrade {
  planLabel: string;
  bullets: string[];
  priceLine?: string;
}

/** Turn an exhausted-allowance failure into the standard paywall modal props. */
export function aiPaywall(
  error: string,
  u: Upgrade | undefined,
  onClose: () => void,
): PaywallProps {
  return {
    trigger: "ai_quota",
    title: "You've used this month's AI questions",
    reason: u
      ? error
      : `${error} Your allowance resets on the 1st. You're on the largest plan, so contact us if you need more.`,
    planLabel: u?.planLabel ?? "Enterprise",
    priceLine: u?.priceLine,
    bullets: u?.bullets ?? ["Your allowance resets on the 1st of the month"],
    onClose,
  };
}
