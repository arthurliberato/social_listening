// Client-safe constants (no database imports) shared by the builder UI and server actions.
export const SOURCE_TYPES = [
  "x",
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
  "reddit",
  "news",
  "blog",
  "forum",
  "review",
] as const;
export const LANGUAGES = ["en", "es", "pt", "fr", "de", "it"] as const;
export const COUNTRIES = [
  "US",
  "GB",
  "CA",
  "AU",
  "IN",
  "BR",
  "PT",
  "MX",
  "ES",
  "AR",
  "FR",
  "DE",
  "IT",
] as const;
