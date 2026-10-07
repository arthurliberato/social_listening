// The two products that share one login, one workspace list, one plan and one design system.
export const PRODUCTS = [
  {
    key: "listening",
    label: "Social listening",
    blurb:
      "Track conversation about your brand, get alerted when something is happening, and explain it.",
    landing: "home",
    cta: "Open Social listening",
  },
  {
    key: "influencers",
    label: "Influencers",
    blurb: "Find creators, check who's real, and shortlist who to work with.",
    landing: "creators",
    cta: "Open Influencers",
  },
] as const;

export type ProductKey = (typeof PRODUCTS)[number]["key"];
export const isProductKey = (s: string | undefined | null): s is ProductKey =>
  PRODUCTS.some((p) => p.key === s);

export const PRODUCT_COOKIE = "rw_product";

/** Which product a workspace path belongs to. */
export const productOfPath = (pathname: string): ProductKey =>
  /^\/w\/[^/]+\/creators(\/|$)/.test(pathname) ? "influencers" : "listening";
