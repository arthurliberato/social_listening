/**
 * Product-side "likely spam" heuristic: what the *product* can observe (author bot score and
 * promotional wording). Deliberately independent of the corpus's ground-truth `is_spam` label, so
 * analysts can measure how well the product's own signal tracks the truth.
 */
export const SPAM_BOT_SCORE = 0.6;
export const SPAM_TEXT_RE =
  "(giveaway|promo code|hiring!|apply now|[0-9]+% off|dm for signals|to the moon|gift card|bit\\.ly)";

export function looksLikeSpam(text: string, botScore: number): boolean {
  return botScore >= SPAM_BOT_SCORE || new RegExp(SPAM_TEXT_RE, "i").test(text);
}
