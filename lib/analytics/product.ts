// Which product an event belongs to, so analysis can be cut by product without parsing routes.
// Each event in the tracking plan has a default; events that fire in more than one product ("platform" events, such
// as paywalls, errors and theme changes) take the product of the screen they fired on.
import { EVENTS, type EventName } from "./events";

export type Product = "listening" | "influencers" | "creator_portal" | "hub" | "platform";
export type ActorType = "member" | "creator" | "anonymous";

/** Paywalls come from server actions that don't know the route; the trigger says which product they were in. */
const INFLUENCER_PAYWALLS = new Set([
  "creator_list_limit",
  "creator_profile_quota",
  "creator_audience",
  "creator_export",
  "campaign_limit",
  "outreach_quota",
  "campaign_results",
]);

/** The product a path belongs to, or null when it isn't inside one (settings, marketing, auth...). */
export function productOfRoute(route: string | null | undefined): Product | null {
  if (!route) return null;
  if (/^\/creator\//.test(route)) return "creator_portal";
  if (/^\/hub(\/|$)/.test(route)) return "hub";
  if (/^\/w\/[^/]+\/creators(\/|$)/.test(route)) return "influencers";
  if (/^\/w\/[^/]+(\/|$)/.test(route)) return "listening";
  return null;
}

export function productFor(
  name: EventName,
  ctx: { route?: string | null; props?: Record<string, unknown> } = {},
): Product {
  const base = EVENTS[name].product as Product;
  if (base !== "platform") return base;
  const trigger = ctx.props?.paywall_trigger;
  if (typeof trigger === "string" && INFLUENCER_PAYWALLS.has(trigger)) return "influencers";
  return productOfRoute(ctx.route) ?? "platform";
}
