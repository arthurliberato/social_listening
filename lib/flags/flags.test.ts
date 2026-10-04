import { describe, expect, it } from "vitest";
import { variantFor, variantLabel } from "./index";

describe("flags", () => {
  it("assigns the same variant to the same person every time", () => {
    for (let i = 0; i < 50; i++)
      expect(variantFor("sales_cta_copy", `user-${i}`)).toBe(
        variantFor("sales_cta_copy", `user-${i}`),
      );
  });
  it("splits roughly by weight", () => {
    let expert = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (variantFor("sales_cta_copy", `u${i}`) === "expert") expert++;
    expect(expert / n).toBeGreaterThan(0.45);
    expect(expert / n).toBeLessThan(0.55);
  });
  it("labels every variant, and falls back to control for an unknown one", () => {
    expect(variantLabel("sales_cta_copy", "expert")).toMatch(/expert/i);
    expect(variantLabel("sales_cta_copy", "gone")).toBe("Talk to sales");
  });
});
