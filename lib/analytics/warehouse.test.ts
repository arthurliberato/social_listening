import { describe, expect, it } from "vitest";
import { EVENTS, GLOBAL_PROPERTIES } from "./events";
import {
  checkPlan,
  isReservedColumn,
  isValidIdentifier,
  warehouseColumn,
  warehouseTable,
} from "./warehouse";

describe("names in the warehouse", () => {
  it("event names become snake_case tables and properties become columns", () => {
    expect(warehouseTable("Creator Invitation Sent")).toBe("creator_invitation_sent");
    expect(warehouseTable("Add-on Purchased")).toBe("add_on_purchased");
    expect(warehouseColumn("planTier")).toBe("plan_tier");
    expect(warehouseColumn("account_id")).toBe("account_id");
  });
  it("knows which names are RudderStack's own", () => {
    for (const c of ["id", "user_id", "timestamp", "event", "context_ip", "context_library_name"])
      expect(isReservedColumn(c), c).toBe(true);
    expect(isReservedColumn("account_id")).toBe(false);
    expect(isValidIdentifier("ok_name_1")).toBe(true);
    expect(isValidIdentifier("1bad")).toBe(false);
    expect(isValidIdentifier("x".repeat(64))).toBe(false);
  });
  it("finds the problems it is meant to find", () => {
    const bad = checkPlan(
      [
        { name: "Users", properties: [] },
        { name: "Plan Upgraded", properties: ["id", "planTier", "plan_tier"] },
        { name: "plan-upgraded", properties: [] },
      ],
      ["account_id"],
    ).map((p) => p.problem);
    expect(bad.some((p) => p.includes('"users"'))).toBe(true);
    expect(bad.some((p) => p.includes("reserved column"))).toBe(true);
    expect(bad.some((p) => p.includes("same column"))).toBe(true);
    expect(bad.some((p) => p.includes("shares the table"))).toBe(true);
  });
});

describe("the tracking plan, as BigQuery will receive it", () => {
  it("has nothing that would be merged, overwritten or rejected", () => {
    const events = Object.entries(EVENTS).map(([name, e]) => ({
      name,
      properties: e.properties as readonly string[],
    }));
    expect(events.length).toBeGreaterThan(100);
    expect(checkPlan(events, GLOBAL_PROPERTIES)).toEqual([]);
  });
});
