// The one place the server talks to RudderStack. Events go to RudderStack's data plane, which delivers them on to the
// warehouse (BigQuery) and to any product-analytics tool added later; the app does not know or care which. Without
// the two settings below this is a no-op, and events are still mirrored to Postgres.
import Analytics from "@rudderstack/rudder-sdk-node";

export type Identity = { userId: string } | { anonymousId: string };
type Scalar = string | number | boolean | null | undefined;
type Obj = Record<string, Scalar | Scalar[]>;

/** The server's own events have no person: they belong to this stand-in rather than to nobody. */
export const SERVER_ANONYMOUS_ID = "server";

const writeKey = () => process.env.RUDDERSTACK_WRITE_KEY;
const dataPlane = () => process.env.RUDDERSTACK_DATA_PLANE_URL || process.env.RUDDERSTACK_DATA_PLANE;
export const rudderConfigured = () => !!writeKey() && !!dataPlane();

let client: Analytics | null = null;
let clientKey = "";

function getClient(): Analytics | null {
  const key = writeKey();
  const url = dataPlane();
  if (!key || !url) return null;
  // A new client if the settings changed (tests point it at a local data plane).
  if (!client || clientKey !== `${key}@${url}`) {
    client = new Analytics(key, {
      dataPlaneUrl: url,
      flushAt: 20,
      flushInterval: 5_000,
      // A failed delivery is logged, never thrown into a request.
      errorHandler: (e?: unknown) => console.error("[rudderstack]", e),
    });
    clientKey = `${key}@${url}`;
  }
  return client;
}

export function rudderTrack(o: {
  identity: Identity;
  event: string;
  properties: Obj;
  timestamp?: Date;
  /** Sent as context, so the warehouse can tell the app's version and the clock's source apart. */
  context?: Record<string, string | number | boolean>;
}) {
  const c = getClient();
  if (!c) return;
  c.track({
    ...o.identity,
    event: o.event,
    properties: o.properties,
    timestamp: o.timestamp,
    ...(o.context ? { context: o.context } : {}),
  });
}

/** Who someone is: ids and kinds only, never a name or an email. */
export function rudderIdentify(o: { identity: Identity; traits: Obj; timestamp?: Date }) {
  const c = getClient();
  if (!c) return;
  c.identify({ ...o.identity, traits: o.traits, timestamp: o.timestamp });
}

/** An account or workspace and what is known about it: scores and counts only, never a name or an email. */
export function rudderGroup(o: {
  identity: Identity;
  groupId: string;
  traits: Obj;
  timestamp?: Date;
}) {
  const c = getClient();
  if (!c) return;
  c.group({ ...o.identity, groupId: o.groupId, traits: o.traits, timestamp: o.timestamp });
}

/** Send what is queued now. For short-lived processes (jobs, scripts) and tests. */
export async function flushRudder(): Promise<void> {
  const c = client;
  if (!c) return;
  await new Promise<void>((resolve) => {
    c.flush((err?: Error) => {
      if (err) console.error("[rudderstack] flush failed", err);
      resolve();
    });
  });
}
