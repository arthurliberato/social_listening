import { describe, expect, it } from "vitest";
import { selectAgents, type BatchAgent } from "./select";

const mk = (id: string, account: string, role: string, profile?: string): BatchAgent => ({
  agent_id: id,
  account_id: account,
  role,
  account_profile: profile,
});
const all = [
  mk("a1_u01", "a1", "division_leader", "growth"),
  mk("a1_u02", "a1", "analyst", "growth"),
  mk("a1_u05", "a1", "analyst", "growth"),
  mk("a2_u02", "a2", "analyst", "agency-low"),
  mk("a3_u01", "a3", "division_leader", "starter-limit"),
  mk("a4_u02", "a4", "analyst"),
];

describe("selectAgents", () => {
  it("defaults to analysts, one per account, in manifest order", () => {
    expect(selectAgents(all).map((a) => a.agent_id)).toEqual(["a1_u02", "a2_u02", "a4_u02"]);
  });
  it("can take more than one per account", () => {
    expect(selectAgents(all, { perAccount: 2 }).map((a) => a.agent_id)).toEqual([
      "a1_u02",
      "a1_u05",
      "a2_u02",
      "a4_u02",
    ]);
  });
  it("filters by profile and leaves out agents that have none", () => {
    expect(
      selectAgents(all, { profiles: ["growth", "agency-low"] }).map((a) => a.agent_id),
    ).toEqual(["a1_u02", "a2_u02"]);
  });
  it("filters by role", () => {
    expect(selectAgents(all, { roles: ["division_leader"] }).map((a) => a.agent_id)).toEqual([
      "a1_u01",
      "a3_u01",
    ]);
  });
  it("caps the batch size", () => {
    expect(selectAgents(all, { count: 2 })).toHaveLength(2);
  });
  it("shuffles repeatably with a seed", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      mk(`x${i}_u02`, `x${i}`, "analyst", "growth"),
    );
    const a = selectAgents(many, { seed: 7 }).map((x) => x.agent_id);
    expect(selectAgents(many, { seed: 7 }).map((x) => x.agent_id)).toEqual(a);
    expect(a).not.toEqual(many.map((x) => x.agent_id));
    expect([...a].sort()).toEqual(many.map((x) => x.agent_id).sort());
  });
  it("takes explicit ids as given, ignoring filters, and rejects unknown ones", () => {
    expect(
      selectAgents(all, { agents: ["a3_u01"], roles: ["analyst"] }).map((a) => a.agent_id),
    ).toEqual(["a3_u01"]);
    expect(() => selectAgents(all, { agents: ["nope"] })).toThrow(/not in the manifest/);
  });
});
