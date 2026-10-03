"use client";

import * as amplitude from "@amplitude/analytics-browser";
import { EVENTS, type EventName, type EventProps } from "./events";

let ampReady = false;
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

function initAmplitude() {
  const key = process.env.NEXT_PUBLIC_AMPLITUDE_KEY;
  if (ampReady || !key) return;
  amplitude.init(key, { deviceId: getDeviceId(), defaultTracking: false });
  ampReady = true;
}

/** Called once the user is known: sets the Amplitude user id and the account/workspace groups. */
export function identify(ids: {
  userId: string;
  accountId: string | null;
  workspaceId: string | null;
}) {
  initAmplitude();
  if (!ampReady) return;
  amplitude.setUserId(ids.userId);
  if (ids.accountId) amplitude.setGroup("account", ids.accountId);
  if (ids.workspaceId) amplitude.setGroup("workspace", ids.workspaceId);
}

export function resetIdentity() {
  if (ampReady) amplitude.reset();
}

let current: { workspaceId: string | null } = { workspaceId: null };
export function setClientWorkspace(workspaceId: string | null) {
  current = { workspaceId };
}

/** Typed client-side tracker: unknown event names or properties fail typechecking. */
export function track<N extends EventName>(name: N, props: EventProps<N> = {}) {
  if (typeof window === "undefined") return;
  if (EVENTS[name].side === "server") return; // server-owned events are recorded server-side only
  initAmplitude();
  const route = window.location.pathname;
  const ui_theme =
    document.documentElement.dataset.theme ??
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  if (ampReady) amplitude.track(name, { ...props, route, ui_theme });
  const body = JSON.stringify({
    name,
    props,
    route,
    ui_theme,
    device_id: getDeviceId(),
    forwarded: ampReady,
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
