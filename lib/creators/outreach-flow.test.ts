import { describe, expect, it } from "vitest";
import {
  checkOffer,
  checkResponse,
  checkReview,
  checkSubmission,
  expiryFrom,
  inviteState,
  isToken,
  newToken,
} from "./outreach-flow";

const NOW = new Date("2026-10-07T12:00:00Z");
const open = { status: "sent", offeredUsd: 500, expiresAt: expiryFrom(NOW) };

describe("outreach rules", () => {
  it("makes unguessable, well-formed tokens", () => {
    const a = newToken();
    expect(isToken(a)).toBe(true);
    expect(newToken()).not.toBe(a);
    expect(isToken("abc")).toBe(false);
    expect(isToken(`${a}0`)).toBe(false);
  });
  it("expires invitations on time, and only 'sent' ones expire", () => {
    expect(inviteState(open, NOW)).toBe("open");
    expect(inviteState(open, new Date(open.expiresAt.getTime() + 1))).toBe("expired");
    expect(
      inviteState({ ...open, status: "accepted" }, new Date(open.expiresAt.getTime() + 1)),
    ).toBe("accepted");
  });
  it("lets a creator answer an open invitation once", () => {
    expect(checkResponse(open, NOW, "accept")).toEqual({ ok: true });
    expect(checkResponse(open, NOW, "decline")).toEqual({ ok: true });
    for (const status of ["accepted", "declined", "countered"])
      expect(checkResponse({ ...open, status }, NOW, "accept")).toMatchObject({ ok: false });
    expect(checkResponse({ ...open, status: "superseded" }, NOW, "accept")).toMatchObject({
      ok: false,
    });
    expect(checkResponse({ ...open, status: "revoked" }, NOW, "accept")).toMatchObject({
      ok: false,
    });
  });
  it("refuses an answer after expiry with a way forward", () => {
    const late = new Date(open.expiresAt.getTime() + 1000);
    const r = checkResponse(open, late, "accept");
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/expired/);
  });
  it("validates counter-offers", () => {
    expect(checkResponse(open, NOW, "counter", "750")).toEqual({ ok: true, counter: 750 });
    expect(checkResponse(open, NOW, "counter", 500)).toMatchObject({ ok: false }); // same as offered
    for (const bad of ["", "abc", 0, -5, 12.5, 2_000_000, null, undefined])
      expect(checkResponse(open, NOW, "counter", bad)).toMatchObject({ ok: false });
  });
  it("checks offers", () => {
    expect(checkOffer("1200")).toEqual({ ok: true, usd: 1200 });
    expect(checkOffer(1.5)).toMatchObject({ ok: false });
  });
  it("accepts only real web links as content", () => {
    expect(checkSubmission("https://social.example.test/p/1", " Hello ")).toEqual({
      ok: true,
      url: "https://social.example.test/p/1",
      caption: "Hello",
    });
    for (const bad of [
      "",
      "not a link",
      "javascript:alert(1)",
      "ftp://x.test/a",
      `https://x.test/${"a".repeat(600)}`,
    ])
      expect(checkSubmission(bad, "")).toMatchObject({ ok: false });
    expect(checkSubmission("https://x.test/a", "x".repeat(2001))).toMatchObject({ ok: false });
  });
  it("asks for feedback when requesting changes, but not when approving", () => {
    expect(checkReview("approve", "")).toEqual({ ok: true, feedback: "" });
    expect(checkReview("changes", "  ")).toMatchObject({ ok: false });
    expect(checkReview("changes", "Please show the logo earlier")).toMatchObject({ ok: true });
  });
});
