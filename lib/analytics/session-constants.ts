// Kept apart from session.ts so the middleware (Edge runtime) can import them without Next's server internals.

/** Cookie holding the visit's id. Middleware creates it and slides its expiry on every page request. */
export const SESSION_COOKIE = "rw_sid";
/** Header the middleware sets on the request itself, so the very first request of a visit already has an id. */
export const SESSION_HEADER = "x-session-id";
/** A visit ends after this long without a page request. */
export const SESSION_IDLE_SECONDS = 30 * 60;
