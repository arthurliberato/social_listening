import { afterEach, describe, expect, it, vi } from "vitest";

// Next installs this global in its own runtime; outside it (tests, scripts) there is none.
vi.hoisted(() => {
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage =
    process.getBuiltinModule("node:async_hooks").AsyncLocalStorage;
});

import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { simNow } from "./simclock";

const cookie = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const inRequest = <T>(value: string | undefined, fn: () => T): T =>
  workUnitAsyncStorage.run(
    { type: "request", cookies: { get: () => (value ? { value } : undefined) } } as never,
    fn,
  );

afterEach(() => {
  delete process.env.ALLOW_SIM_CLOCK;
  delete process.env.SIM_CLOCK_OFFSET_MS;
});

describe("simNow", () => {
  const clock = "2026-02-10T14:05:00.000Z";

  it("is the agent's own clock inside a request, when allowed", () => {
    process.env.ALLOW_SIM_CLOCK = "true";
    expect(inRequest(cookie({ clock }), () => simNow().toISOString())).toBe(clock);
  });

  it("ignores the cookie unless ALLOW_SIM_CLOCK=true", () => {
    const t = inRequest(cookie({ clock }), () => simNow().getTime());
    expect(Math.abs(t - Date.now())).toBeLessThan(5_000);
  });

  it("ignores a malformed clock and requests without the cookie", () => {
    process.env.ALLOW_SIM_CLOCK = "true";
    for (const v of [cookie({ clock: "soon" }), "%%%", undefined]) {
      const t = inRequest(v, () => simNow().getTime());
      expect(Math.abs(t - Date.now())).toBeLessThan(5_000);
    }
  });

  it("outside a request uses the global clock and its offset", () => {
    process.env.ALLOW_SIM_CLOCK = "true";
    process.env.SIM_CLOCK_OFFSET_MS = String(2 * 3_600_000);
    const t = simNow().getTime();
    expect(Math.abs(t - (Date.now() + 2 * 3_600_000))).toBeLessThan(5_000);
  });

  it("clamps to the corpus window", () => {
    process.env.ALLOW_SIM_CLOCK = "true";
    expect(
      inRequest(cookie({ clock: "2001-01-01T00:00:00Z" }), () => simNow().getUTCFullYear()),
    ).toBe(2024);
    expect(
      inRequest(cookie({ clock: "2040-01-01T00:00:00Z" }), () => simNow().getUTCFullYear()),
    ).toBe(2027);
  });
});
