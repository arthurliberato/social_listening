import { describe, expect, it } from "vitest";
import { parseSim } from "./sim-context";

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

describe("rw_sim cookie", () => {
  it("reads labels and a simulated clock", () => {
    expect(
      parseSim(
        enc({ persona: "analyst_mid", run: "r1", model: "m", clock: "2026-03-02T09:30:00Z" }),
      ),
    ).toEqual({ persona: "analyst_mid", run: "r1", model: "m", clock: "2026-03-02T09:30:00Z" });
  });
  it("ignores a bad clock, bad base64 and a missing cookie", () => {
    expect(parseSim(enc({ clock: "not a date" })).clock).toBeNull();
    expect(parseSim("%%%").clock).toBeNull();
    expect(parseSim(undefined)).toEqual({ persona: null, run: null, model: null, clock: null });
  });
});
