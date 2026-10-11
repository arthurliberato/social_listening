"use client";

import { EVENTS, type EventName, type EventProps } from "./events";

let deviceId: string | null = null;

function getDeviceId(): string {
  if (deviceId) return deviceId;
  try {
    const m = /(?:^|; )rw_did=([^;]+)/.exec(document.cookie);
    deviceId = m?.[1] ?? crypto.randomUUID();
    if (!m) document.cookie = `rw_did=${deviceId}; path=/; max-age=63072000; samesite=lax`;
  } catch {
    deviceId = "unknown";
  }
  return deviceId;
}

/**
 * Nothing is sent to RudderStack from the browser. The browser tells our server what happened (below); the server
 * attaches the account, plan, role and the rest of the global properties, which only it knows, and sends the event on.
 * It also introduces the user, their account and their workspace to RudderStack the first time it sees them (see
 * lib/analytics/server.ts), so there is no sign-in, workspace-switch or sign-out call to make here: the device id
 * stays on this browser, and the signed-in user is read from the session.
 */
export function resetIdentity() {
  /* intentionally empty: see above */
}

let current: { workspaceId: string | null } = { workspaceId: null };
export function setClientWorkspace(workspaceId: string | null) {
  current = { workspaceId };
}

/** Typed client-side tracker: unknown event names or properties fail typechecking. */
export function track<N extends EventName>(name: N, props: EventProps<N> = {}) {
  if (typeof window === "undefined") return;
  if (EVENTS[name].side === "server") return; // server-owned events are recorded server-side only
  const route = window.location.pathname;
  const ui_theme =
    document.documentElement.dataset.theme ??
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const body = JSON.stringify({
    name,
    props,
    route,
    ui_theme,
    device_id: getDeviceId(),
    forwarded: false,
    workspace_id: current.workspaceId,
  });
  if (!navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }))) {
    void fetch("/api/track", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
    });
  }
}
