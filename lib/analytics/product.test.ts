import { describe, expect, it } from "vitest";
import { EVENTS } from "./events";
import { productFor, productOfRoute } from "./product";

describe("event product", () => {
  it("every event in the plan has a known product", () => {
    for (const [name, e] of Object.entries(EVENTS))
      expect(["listening", "influencers", "creator_portal", "hub", "platform"], name).toContain(
        e.product,
      );
  });
  it("takes the plan's product for events that belong to one", () => {
    expect(productFor("Mention Tagged")).toBe("listening");
    expect(productFor("Campaign Created")).toBe("influencers");
    expect(productFor("Product Hub Viewed")).toBe("hub");
    // A product event keeps its product wherever it fires.
    expect(productFor("Mention Tagged", { route: "/hub" })).toBe("listening");
  });
  it("marks the creator's own events as the portal, not the brand's product", () => {
    for (const n of [
      "Creator Portal Viewed",
      "Creator Invitation Answered",
      "Creator Content Submitted",
    ] as const)
      expect(productFor(n)).toBe("creator_portal");
    expect(productFor("Creator Invitation Sent")).toBe("influencers");
  });
  it("resolves shared events from the screen they fired on", () => {
    expect(productFor("Error Displayed", { route: "/w/acme/mentions" })).toBe("listening");
    expect(productFor("Error Displayed", { route: "/w/acme/creators/lists" })).toBe("influencers");
    expect(productFor("Error Displayed", { route: "/creator/" + "a".repeat(48) })).toBe(
      "creator_portal",
    );
    expect(productFor("Theme Changed", { route: "/settings/appearance" })).toBe("platform");
    expect(productFor("Theme Changed")).toBe("platform");
  });
  it("tells which product a paywall was in from its trigger when there's no route", () => {
    expect(productFor("Paywall Viewed", { props: { paywall_trigger: "outreach_quota" } })).toBe(
      "influencers",
    );
    expect(productFor("Paywall Viewed", { props: { paywall_trigger: "query_limit" } })).toBe(
      "platform",
    );
    expect(
      productFor("Paywall Viewed", {
        route: "/w/a/alerts",
        props: { paywall_trigger: "alert_limit" },
      }),
    ).toBe("listening");
  });
  it("reads routes", () => {
    expect(productOfRoute("/w/a/creators")).toBe("influencers");
    expect(productOfRoute("/w/a/creatorsx")).toBe("listening"); // not the creators section
    expect(productOfRoute("/settings/billing")).toBeNull();
    expect(productOfRoute(null)).toBeNull();
  });
});
