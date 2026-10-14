import { describe, expect, it } from "vitest";
import { resolveSession, sessionIdOf } from "./session-constants";

const ID = "11111111-1111-4111-8111-111111111111";
const NEW = "22222222-2222-4222-8222-222222222222";
const mint = () => NEW;

describe("resolveSession", () => {
  it("starts a visit when there is no cookie", () => {
    expect(resolveSession(undefined, 1_000_000_000, mint)).toEqual({
      id: NEW,
      set: { value: `${NEW}.1000000000`, maxAge: 86_400 },
    });
  });
  it("keeps the visit and sets nothing while the cookie is fresh", () => {
    expect(resolveSession(`${ID}.1000000000`, 1_000_000_100, mint)).toEqual({ id: ID, set: null });
  });
  it("keeps the visit but refreshes the cookie once it is a few minutes old", () => {
    expect(resolveSession(`${ID}.1000000000`, 1_000_000_400, mint)).toEqual({
      id: ID,
      set: { value: `${ID}.1000000400`, maxAge: 86_400 },
    });
  });
  it("starts a new visit after 30 idle minutes", () => {
    expect(resolveSession(`${ID}.1000000000`, 1_000_001_801, mint).id).toBe(NEW);
  });
  it("ignores a malformed cookie", () => {
    expect(resolveSession("nonsense", 1_000_000_000, mint).id).toBe(NEW);
    expect(sessionIdOf("nonsense")).toBeNull();
    expect(sessionIdOf(`${ID}.1000000000`)).toBe(ID);
  });
});
