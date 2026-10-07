import type { BrandSafety } from "@/datagen/creators";

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
};

export const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Words as well as a number, so the score never relies on colour alone. */
export const authLabel = (score: number) =>
  score >= 80 ? "Strong" : score >= 60 ? "Fair" : "Weak";

export const SAFETY_LABEL: Record<BrandSafety, string> = {
  safe: "Safe",
  caution: "Review",
  risk: "At risk",
};

export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

const REGION =
  typeof Intl !== "undefined" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
export const countryName = (code: string) => {
  if (code === "Other") return "Other countries";
  try {
    return REGION?.of(code) ?? code;
  } catch {
    return code;
  }
};
