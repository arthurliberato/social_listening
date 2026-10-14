import { afterEach, describe, expect, it } from "vitest";
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

  describe("the wizard escape hatch", () => {
    afterEach(() => {
      delete process.env.FLAG_WEIGHTS;
    });
    const arm = (n: number) =>
      Array.from({ length: n }, (_, i) => variantFor("wizard_escape_hatch", `acct-${i}`));
    it("is off until an experiment is launched: everyone is in control", () => {
      expect(new Set(arm(500))).toEqual(new Set(["control"]));
    });
    it("splits when FLAG_WEIGHTS launches it, and stops again when removed", () => {
      process.env.FLAG_WEIGHTS = JSON.stringify({ wizard_escape_hatch: { escape: 100 } });
      const share = arm(4000).filter((v) => v === "escape").length / 4000;
      expect(share).toBeGreaterThan(0.45);
      expect(share).toBeLessThan(0.55);
      delete process.env.FLAG_WEIGHTS;
      expect(new Set(arm(200))).toEqual(new Set(["control"]));
    });
    it("ignores a malformed setting", () => {
      process.env.FLAG_WEIGHTS = "{not json";
      expect(new Set(arm(50))).toEqual(new Set(["control"]));
    });
  });
});
