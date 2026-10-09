import { analyticsEvents, db } from "@/db/client";
import { simNow } from "@/lib/simclock";
import { globalProps, type AnalyticsContext } from "./context";
import { productFor } from "./product";
import {
  flushRudder,
  rudderGroup,
  rudderIdentify,
  rudderTrack,
  SERVER_ANONYMOUS_ID,
  type Identity,
} from "./rudder";
import { EVENTS, type EventName, type EventProps, type Prop } from "./events";

export interface ClientExtras {
  route?: string;
  ui_theme?: string;
  device_id?: string;
  /** True when something else already sent this event to RudderStack (avoid double counting). */
  forwarded?: boolean;
  /** The browser's user agent, for the warehouse's device columns. */
  user_agent?: string;
}

/**
 * Record an event: always mirror to Postgres, then fan out to RudderStack (which delivers to BigQuery and any
 * other destination) and to GA4 per the tracking plan's `destinations`. Never throws into the request path.
 * Email addresses and names must never be passed in props.
 */
export async function trackServer<N extends EventName>(
  name: N,
  ctx: AnalyticsContext,
  props: EventProps<N> = {},
  extras: ClientExtras & { side?: "client" | "server" } = {},
): Promise<void> {
  try {
    const def = EVENTS[name];
    const g = await globalProps(ctx);
    const all: Record<string, Prop> = {
      ...g.props,
      route: extras.route ?? null,
      ui_theme: extras.ui_theme ?? null,
      ...(props as Record<string, Prop>),
      // Global properties are set last: an event's own properties can never overwrite where it happened.
      product: productFor(name, { route: extras.route, props: props as Record<string, unknown> }),
      actor_type: g.props.actor_type,
    };
    // The agent's own clock when it has one (cookie `rw_sim`, see lib/simclock.ts), else the app's simulated now.
    const at = simNow();
    await db.insert(analyticsEvents).values({
      ts: at,
      name,
      side: extras.side ?? def.side,
      userId: ctx.userId ?? null,
      accountId: g.accountId,
      workspaceId: g.workspaceId,
      deviceId: extras.device_id ?? null,
      props: all,
    });
    const dest = def.destinations as readonly string[];
    if (dest.includes("rudderstack") && !extras.forwarded)
      sendRudder(name, rudderIdentity(ctx, extras.device_id), all, at, g, extras.user_agent);
    if (dest.includes("ga4") && def.ga4Name) await sendGa4(def.ga4Name, ctx.userId ?? null, all);
  } catch (err) {
    console.error("[analytics] failed to record", name, err);
  }
}

/**
 * Who the warehouse sees. Members are their UUID. A creator on an invitation page has no account, so they get a stable
 * synthetic id (`creator_<directory id>`), which lets a creator's journey (invited, viewed, answered, delivered, paid)
 * be followed as one user without storing anything personal. Everyone else is anonymous: a browser by its device id,
 * the server's own events by a fixed stand-in.
 */
export function rudderUserId(ctx: AnalyticsContext): string | null {
  return ctx.userId ?? (ctx.creatorId ? `creator_${ctx.creatorId}` : null);
}

function rudderIdentity(ctx: AnalyticsContext, deviceId?: string): Identity {
  const userId = rudderUserId(ctx);
  return userId ? { userId } : { anonymousId: deviceId ?? SERVER_ANONYMOUS_ID };
}

/** Who RudderStack has already been introduced to, so each person, account and workspace is introduced once. */
const introduced = new Set<string>();

/**
 * The first time this process sees a person with an account and workspace, tell RudderStack who they are (ids and kinds
 * only) and which account and workspace they belong to. A different workspace is a new introduction, which is how a
 * workspace switch reaches the warehouse. A restart simply introduces everyone again, which RudderStack treats as
 * an update.
 */
function introduce(identity: Identity, g: Awaited<ReturnType<typeof globalProps>>, at: Date) {
  if (!("userId" in identity)) return;
  const key = `${identity.userId}|${g.accountId}|${g.workspaceId}`;
  if (introduced.has(key)) return;
  introduced.add(key);
  if (introduced.size > 50_000) introduced.clear();
  const creator = identity.userId.startsWith("creator_");
  rudderIdentify({
    identity,
    traits: creator
      ? { user_type: "creator" }
      : { user_type: "member", ...(g.accountId ? { account_id: g.accountId } : {}) },
    timestamp: at,
  });
  if (g.accountId)
    rudderGroup({
      identity,
      groupId: g.accountId,
      traits: { group_type: "account" },
      timestamp: at,
    });
  if (g.workspaceId)
    rudderGroup({
      identity,
      groupId: g.workspaceId,
      traits: {
        group_type: "workspace",
        ...(g.accountId ? { account_id: g.accountId } : {}),
      },
      timestamp: at,
    });
}

function sendRudder(
  name: string,
  identity: Identity,
  props: Record<string, Prop>,
  at: Date,
  g: Awaited<ReturnType<typeof globalProps>>,
  userAgent?: string,
) {
  introduce(identity, g, at);
  rudderTrack({
    identity,
    event: name,
    properties: props,
    timestamp: at,
    ...(userAgent ? { context: { userAgent } } : {}),
  });
}

async function sendGa4(ga4Name: string, userId: string | null, props: Record<string, Prop>) {
  const id = process.env.GA4_MEASUREMENT_ID;
  const secret = process.env.GA4_API_SECRET;
  if (!id || !secret) return;
  // Strip anything that could identify a person; GA4 gets the funnel-level view only.
  const params = {
    plan_tier: props.plan_tier,
    is_synthetic: props.is_synthetic,
    account_id: props.account_id,
  };
  await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${id}&api_secret=${secret}`,
    {
      method: "POST",
      body: JSON.stringify({
        client_id: userId ?? "server",
        user_id: userId ?? undefined,
        events: [{ name: ga4Name, params }],
      }),
    },
  );
}

/**
 * Tell RudderStack what is known about an account (a `group` call), so the warehouse can segment by health band, PQA
 * and plan without a join. Properties are scores and counts only: never names or emails. A no-op without
 * RudderStack settings.
 */
export async function groupIdentifyAccount(
  accountId: string,
  props: Record<string, string | number | boolean>,
) {
  try {
    rudderGroup({
      identity: { anonymousId: SERVER_ANONYMOUS_ID },
      groupId: accountId,
      traits: { group_type: "account", ...props },
    });
    await flushRudder();
  } catch (err) {
    console.error("[analytics] group identify failed", err);
  }
}
