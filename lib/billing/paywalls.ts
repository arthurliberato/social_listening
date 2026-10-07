// Every place a paywall can appear, in one list. Adding a placement means adding it here, which keeps
// the Upgrade page's "why you're here" line, the analytics values and the tests in step.
export const PAYWALLS = {
  query_limit: "You've used all the active queries on your plan",
  alert_limit: "You've used all the alerts on your plan",
  seat_limit: "You've used all the seats on your plan",
  history_window: "You asked for more history than your plan keeps",
  public_share: "Public share links aren't on your plan",
  gated_widget: "That dashboard widget isn't on your plan",
  sentiment_alerts: "Negative-sentiment alerts aren't on your plan",
  crisis_room: "Crisis Rooms aren't on your plan",
  scheduled_reports: "Scheduled reports aren't on your plan",
  report_section_locked: "That report section isn't on your plan",
  workspace_limit: "You've used all the workspaces on your plan",
  audit_log: "The audit log isn't on your plan",
  white_label: "White-label isn't on your plan",
  mention_quota: "You've used this month's mentions",
  ai_quota: "You've used this month's AI questions",
  creator_list_limit: "You've used all the creator lists on your plan",
  creator_profile_quota: "You've used this month's creator profiles",
  creator_audience: "Audience insights aren't on your plan",
  campaign_limit: "You've used all the active campaigns on your plan",
  creator_export: "Creator list exports aren't on your plan",
} as const;

export type PaywallTrigger = keyof typeof PAYWALLS;
export const PAYWALL_TRIGGERS = Object.keys(PAYWALLS) as PaywallTrigger[];
export const isPaywallTrigger = (s: string | null | undefined): s is PaywallTrigger =>
  !!s && s in PAYWALLS;
