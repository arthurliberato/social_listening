// Client-safe branding helpers (no database imports), shared by the settings form and the server.
export interface Branding {
  displayName: string;
  accent: string;
  footerText: string;
  hidePoweredBy: boolean;
}
export const NO_BRANDING: Branding = {
  displayName: "",
  accent: "",
  footerText: "",
  hidePoweredBy: false,
};

const luminance = (hex: string) => {
  const v = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
};
/** WCAG contrast of white text on this colour. */
export const contrastOnWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);
export const MIN_CONTRAST = 4.5;
export const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);
