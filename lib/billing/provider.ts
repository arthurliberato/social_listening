// The payment processor behind a small interface. Only the simulated, test-mode provider ships;
// a Stripe-backed one would implement the same two methods (tokenize via Stripe Elements, charge via PaymentIntents).
import type { Behavior } from "./cards";

export interface ChargeRequest {
  accountId: string;
  amountCents: number;
  description: string;
  method: { id: string; behavior: Behavior };
  /** What the charge is for. Test cards that "fail on renewal" fail on renewal and retry, never on the first payment. */
  kind: "first" | "upgrade" | "renewal" | "retry";
}
export type ChargeResult =
  { ok: true; reference: string } | { ok: false; code: "card_declined"; message: string };

export interface BillingProvider {
  readonly name: "simulated" | "stripe";
  charge(req: ChargeRequest): Promise<ChargeResult>;
}

/** Test mode: charges succeed unless the card was saved with the "fails on renewal" test number. */
export const simulatedProvider: BillingProvider = {
  name: "simulated",
  async charge(req) {
    if (req.amountCents <= 0)
      return { ok: true, reference: `sim_free_${req.method.id.slice(0, 8)}` };
    if (req.method.behavior === "fail_renewal" && (req.kind === "renewal" || req.kind === "retry"))
      return {
        ok: false,
        code: "card_declined",
        message: "Your card was declined (insufficient funds).",
      };
    return { ok: true, reference: `sim_ch_${Math.random().toString(36).slice(2, 12)}` };
  },
};

let provider: BillingProvider = simulatedProvider;
export const getProvider = () => provider;
/** For tests that want to force specific processor behaviour. */
export const setProvider = (p: BillingProvider) => {
  provider = p;
};
