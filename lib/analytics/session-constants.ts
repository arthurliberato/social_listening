// Kept apart from session.ts so the middleware (Edge runtime) can import it without Next's server internals.

/** Cookie holding the visit's id and when it was last refreshed: `<uuid>.<epoch seconds>`. */
export const SESSION_COOKIE = "rw_sid";
/** Header the middleware sets on the request itself, so the very first request of a visit already has an id. */
export const SESSION_HEADER = "x-session-id";
/** A visit ends after this long without a page request. */
export const SESSION_IDLE_SECONDS = 30 * 60;
/**
 * The cookie is rewritten at most this often, not on every request. Setting a cookie makes Next throw away the
 * browser's cached pages and re-render the one on screen, which broke open menus and keyboard shortcuts when it
 * happened on every response. The cost is that a visit ends between 25 and 30 idle minutes, not exactly 30.
 */
export const SESSION_REFRESH_SECONDS = 5 * 60;
const COOKIE_MAX_AGE = 24 * 60 * 60;

const COOKIE_RE = /^([0-9a-f-]{36})\.(\d{9,11})$/;

/**
 * Decide which visit a request belongs to. `cookie` is the rw_sid cookie's value (if any), `uuid` makes a new id.
 * Returns the id, and the cookie to set (null when the one the browser has is still fresh enough).
 */
export function resolveSession(
  cookie: string | undefined,
  nowSeconds: number,
  uuid: () => string,
): { id: string; set: { value: string; maxAge: number } | null } {
  const m = cookie ? COOKIE_RE.exec(cookie) : null;
  if (m && nowSeconds - Number(m[2]) <= SESSION_IDLE_SECONDS) {
    if (nowSeconds - Number(m[2]) < SESSION_REFRESH_SECONDS) return { id: m[1]!, set: null };
    return { id: m[1]!, set: { value: `${m[1]}.${nowSeconds}`, maxAge: COOKIE_MAX_AGE } };
  }
  const id = uuid();
  return { id, set: { value: `${id}.${nowSeconds}`, maxAge: COOKIE_MAX_AGE } };
}

/** The visit id inside a cookie value, if it is one of ours. */
export function sessionIdOf(cookie: string | undefined): string | null {
  return (cookie && COOKIE_RE.exec(cookie)?.[1]) || null;
}
