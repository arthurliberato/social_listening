"use server";

import {
  respondToInvitation,
  submitContent,
  portalViewFor,
  type Fail,
  type PortalView,
} from "@/lib/creators/outreach";
import { isToken } from "@/lib/creators/outreach-flow";

type Result = { ok: true; view: PortalView } | Fail;

async function withView(token: string, r: { ok: true } | Fail): Promise<Result> {
  if (!r.ok) return r;
  const view = await portalViewFor(token);
  return view ? { ok: true, view } : { ok: false, error: "We couldn't find that page." };
}

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
  if (!isToken(token)) return { ok: false, error: "We couldn't find that page." };
  return withView(token, await submitContent(token, String(url ?? ""), String(caption ?? "")));
}
