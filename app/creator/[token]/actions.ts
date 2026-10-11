"use server";

import { requestContractChanges, signContract } from "@/lib/creators/contracts";
import {
  respondToInvitation,
  submitContent,
  type Fail,
  type PortalView,
} from "@/lib/creators/outreach";
import { isToken } from "@/lib/creators/outreach-flow";
import { savePayoutDetails } from "@/lib/creators/payouts";
import { portalViewOf } from "@/lib/creators/portal-extras";

type Result = { ok: true; view: PortalView } | Fail;

async function withView(token: string, r: { ok: true } | Fail): Promise<Result> {
  if (!r.ok) return r;
  const view = await portalViewOf(token);
  return view ? { ok: true, view } : { ok: false, error: "We couldn't find that page." };
}

const notFound: Fail = { ok: false, error: "We couldn't find that page." };

export async function respondAction(
  token: string,
  kind: "accept" | "decline" | "counter",
  input: { counterUsd?: string; note?: string },
): Promise<Result> {
  if (!isToken(token) || !["accept", "decline", "counter"].includes(kind))
    return { ok: false, error: "We couldn't find that invitation." };
  return withView(token, await respondToInvitation(token, kind, input));
}

export async function submitContentAction(
  token: string,
  url: string,
  caption: string,
): Promise<Result> {
  if (!isToken(token)) return notFound;
  return withView(token, await submitContent(token, String(url ?? ""), String(caption ?? "")));
}

export async function signContractAction(
  token: string,
  name: string,
  agree: boolean,
): Promise<Result> {
  if (!isToken(token)) return notFound;
  return withView(token, await signContract(token, String(name ?? ""), agree === true));
}

export async function requestContractChangesAction(token: string, note: string): Promise<Result> {
  if (!isToken(token)) return notFound;
  return withView(token, await requestContractChanges(token, String(note ?? "")));
}

export async function savePayoutDetailsAction(
  token: string,
  input: { holderName: string; accountNumber: string; country: string },
): Promise<Result> {
  if (!isToken(token)) return notFound;
  return withView(
    token,
    await savePayoutDetails(token, {
      holderName: String(input?.holderName ?? ""),
      accountNumber: String(input?.accountNumber ?? ""),
      country: String(input?.country ?? ""),
    }),
  );
}
