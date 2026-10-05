import { analyticsEvents, db } from "@/db/client";
import { simNow } from "@/lib/simclock";
import { globalProps, type AnalyticsContext } from "./context";
import { EVENTS, type EventName, type EventProps, type Prop } from "./events";

export interface ClientExtras {
  route?: string;
  ui_theme?: string;
  device_id?: string;
  /** True when the browser already sent this event straight to Amplitude (avoid double counting). */
  forwarded?: boolean;
}

/**
 * Record an event: always mirror to Postgres (account-level SQL / BigQuery loads), then fan out to
 * Amplitude and GA4 per the tracking plan's `destinations`. Never throws into the request path.
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
    if (dest.includes("amplitude") && !extras.forwarded)
      await sendAmplitude(name, ctx.userId ?? null, extras.device_id, all, g, at);
    if (dest.includes("ga4") && def.ga4Name) await sendGa4(def.ga4Name, ctx.userId ?? null, all);
  } catch (err) {
    console.error("[analytics] failed to record", name, err);
  }
}

async function sendAmplitude(
  name: string,
  userId: string | null,
  deviceId: string | undefined,
  props: Record<string, Prop>,
  g: Awaited<ReturnType<typeof globalProps>>,
  at?: Date,
) {
  const key = process.env.AMPLITUDE_API_KEY;
  if (!key) return;
  const amp = await import("@amplitude/analytics-node");
  amp.init(key);
  const groups: Record<string, string> = {};
  if (g.accountId) groups.account = g.accountId;
  if (g.workspaceId) groups.workspace = g.workspaceId;
  amp.track(
    name,
    props as Record<string, never>,
    {
      user_id: userId ?? undefined,
      device_id: deviceId,
      groups,
      ...(at ? { time: at.getTime() } : {}),
    } as never,
  );
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
 * Push account-level properties to Amplitude (a "group identify" on the account group) so product
 * analytics can segment by health band, PQA and plan. Properties are scores and counts only: never
 * names or emails. A no-op without an Amplitude key.
 */
export async function groupIdentifyAccount(
  accountId: string,
  props: Record<string, string | number | boolean>,
) {
  const key = process.env.AMPLITUDE_API_KEY;
  if (!key) return;
  try {
    const amp = await import("@amplitude/analytics-node");
    amp.init(key);
    const id = new amp.Identify();
    for (const [k, v] of Object.entries(props)) id.set(k, v);
    await amp.groupIdentify("account", accountId, id).promise;
  } catch (err) {
    console.error("[analytics] group identify failed", err);
  }
}
