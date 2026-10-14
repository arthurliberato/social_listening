import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

import { SESSION_COOKIE, SESSION_HEADER, sessionIdOf } from "./session-constants";

const ID = /^[0-9a-f-]{36}$/;

/**
 * The id of the visit the current request belongs to, or null outside a request (a job, a script). It is read from
 * Next's request store rather than `cookies()`, because the tracker is synchronous at this point and runs wherever
 * events are recorded. Not personal data: a random id that expires after 30 idle minutes.
 */
export function currentSessionId(): string | null {
  try {
    const store = workUnitAsyncStorage.getStore();
    if (store?.type !== "request") return null;
    // Pages carry the id in a header set by the middleware; API routes skip the middleware and use the cookie.
    const h = store.headers.get(SESSION_HEADER);
    return (h && ID.test(h) ? h : null) ?? sessionIdOf(store.cookies.get(SESSION_COOKIE)?.value);
  } catch {
    return null; // outside a request, or Next changed its internals
  }
}
