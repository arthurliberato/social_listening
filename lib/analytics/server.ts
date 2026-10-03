import { analyticsEvents, db } from "@/db/client";
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
    await db.insert(analyticsEvents).values({
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
      await sendAmplitude(name, ctx.userId ?? null, extras.device_id, all, g);
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
    { user_id: userId ?? undefined, device_id: deviceId, groups } as never,
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
