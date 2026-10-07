// Single source of truth for plan limits. Enforced server-side via can()/limits(), mirrored in UI.

export type PlanTier = "trial" | "starter" | "growth" | "agency" | "enterprise";
export type RefreshTier = "hourly" | "12h" | "realtime";

export interface Entitlements {
  label: string;
  priceMonthly: number | null; // USD; null = sales-quoted
  activeQueries: number;
  mentionsPerMonth: number;
  seats: number;
  workspaces: number;
  historyDays: number;
  refresh: RefreshTier;
  alerts: number;
  askAiPerMonth: number;
  /** Influencers product: new creator profiles opened per month, and shortlists. */
  creatorProfilesPerMonth: number;
  creatorLists: number;
  /** Campaigns that are drafts or running; completed and archived ones don't count. */
  activeCampaigns: number;
  /** Creator invitations sent per month (each new or revised offer counts). */
  invitationsPerMonth: number;
  features: {
    sentimentAlerts: boolean;
    crisisRoom: boolean;
    scheduledReports: boolean;
    whiteLabel: boolean;
    shareOfVoice: boolean;
    emotionWidget: boolean;
    publicShareLinks: boolean;
    sso: boolean;
    auditLog: boolean;
    api: boolean;
    logoRecognition: boolean;
    creatorAudience: boolean; // audience demographics and authenticity on creator profiles
    creatorExport: boolean; // CSV export of creator lists
    campaignResults: boolean; // tracking links and the campaign results page
  };
}

const none = {
  sentimentAlerts: false,
  crisisRoom: false,
  scheduledReports: false,
  whiteLabel: false,
  shareOfVoice: false,
  emotionWidget: false,
  publicShareLinks: false,
  sso: false,
  auditLog: false,
  api: false,
  logoRecognition: false,
  creatorAudience: false,
  creatorExport: false,
  campaignResults: false,
};

export const PLANS: Record<PlanTier, Entitlements> = {
  trial: {
    label: "Trial",
    priceMonthly: 0,
    activeQueries: 3,
    mentionsPerMonth: 5_000,
    seats: 2,
    workspaces: 1,
    historyDays: 30,
    refresh: "hourly",
    alerts: 2,
    askAiPerMonth: 10,
    creatorProfilesPerMonth: 15,
    creatorLists: 2,
    activeCampaigns: 1,
    invitationsPerMonth: 5,
    features: { ...none },
  },
  starter: {
    label: "Starter",
    priceMonthly: 79,
    activeQueries: 3,
    mentionsPerMonth: 10_000,
    seats: 1,
    workspaces: 1,
    historyDays: 30,
    refresh: "12h",
    alerts: 3,
    askAiPerMonth: 10,
    creatorProfilesPerMonth: 25,
    creatorLists: 2,
    activeCampaigns: 1,
    invitationsPerMonth: 10,
    features: { ...none },
  },
  growth: {
    label: "Growth",
    priceMonthly: 249,
    activeQueries: 10,
    mentionsPerMonth: 50_000,
    seats: 5,
    workspaces: 1,
    historyDays: 365,
    refresh: "hourly",
    alerts: 20,
    askAiPerMonth: 100,
    creatorProfilesPerMonth: 250,
    creatorLists: 10,
    activeCampaigns: 5,
    invitationsPerMonth: 200,
    features: {
      ...none,
      sentimentAlerts: true,
      crisisRoom: true,
      scheduledReports: true,
      creatorAudience: true,
      creatorExport: true,
      campaignResults: true,
      shareOfVoice: true,
      emotionWidget: true,
      publicShareLinks: true,
    },
  },
  agency: {
    label: "Agency",
    priceMonthly: 599,
    activeQueries: 30,
    mentionsPerMonth: 200_000,
    seats: 15,
    workspaces: 10,
    historyDays: 730,
    refresh: "realtime",
    alerts: 100,
    askAiPerMonth: 500,
    creatorProfilesPerMonth: 1000,
    creatorLists: 50,
    activeCampaigns: 25,
    invitationsPerMonth: 1000,
    features: {
      ...none,
      sentimentAlerts: true,
      crisisRoom: true,
      scheduledReports: true,
      creatorAudience: true,
      creatorExport: true,
      campaignResults: true,
      shareOfVoice: true,
      emotionWidget: true,
      publicShareLinks: true,
      whiteLabel: true,
    },
  },
  enterprise: {
    label: "Enterprise",
    priceMonthly: null,
    activeQueries: 50,
    mentionsPerMonth: 1_000_000,
    seats: 50,
    workspaces: 1_000,
    historyDays: 1825,
    refresh: "realtime",
    alerts: 10_000,
    askAiPerMonth: 5_000,
    creatorProfilesPerMonth: 10000,
    creatorLists: 1000,
    activeCampaigns: 500,
    invitationsPerMonth: 10000,
    features: {
      sentimentAlerts: true,
      crisisRoom: true,
      scheduledReports: true,
      whiteLabel: true,
      shareOfVoice: true,
      emotionWidget: true,
      publicShareLinks: true,
      sso: true,
      auditLog: true,
      api: true,
      logoRecognition: true,
      creatorAudience: true,
      creatorExport: true,
      campaignResults: true,
    },
  },
};

export const TRIAL_DAYS = 14;

export function limits(tier: PlanTier): Entitlements {
  return PLANS[tier];
}

/** Cheapest plan that unlocks a feature, for paywall copy. */
export function planUnlocking(feature: keyof Entitlements["features"]): PlanTier {
  return (
    (["starter", "growth", "agency", "enterprise"] as PlanTier[]).find(
      (t) => PLANS[t].features[feature],
    ) ?? "enterprise"
  );
}

/** Shortlists: the plan caps how many lists a workspace's account can hold. */
export function canCreateCreatorList(
  tier: PlanTier,
  existingLists: number,
): { ok: true } | { ok: false; reason: string; upgradeTo: PlanTier } {
  const p = PLANS[tier];
  if (existingLists < p.creatorLists) return { ok: true };
  return {
    ok: false,
    reason: `Your ${p.label} plan includes ${p.creatorLists} creator list${p.creatorLists === 1 ? "" : "s"}.`,
    upgradeTo:
      (["starter", "growth", "agency", "enterprise"] as PlanTier[]).find(
        (t) => PLANS[t].creatorLists > p.creatorLists,
      ) ?? "enterprise",
  };
}

/** Campaigns: the plan caps how many can be in draft or running at once. */
export function canCreateCampaign(
  tier: PlanTier,
  activeCampaigns: number,
): { ok: true } | { ok: false; reason: string; upgradeTo: PlanTier } {
  const p = PLANS[tier];
  if (activeCampaigns < p.activeCampaigns) return { ok: true };
  return {
    ok: false,
    reason: `Your ${p.label} plan includes ${p.activeCampaigns} active campaign${p.activeCampaigns === 1 ? "" : "s"}. Complete or archive one, or upgrade.`,
    upgradeTo:
      (["starter", "growth", "agency", "enterprise"] as PlanTier[]).find(
        (t) => PLANS[t].activeCampaigns > p.activeCampaigns,
      ) ?? "enterprise",
  };
}

export type Action = "create_query" | "invite_member" | "create_workspace" | "create_alert";
export interface Usage {
  activeQueries: number;
  seats: number;
  workspaces: number;
  alerts: number;
}

export function can(
  tier: PlanTier,
  action: Action,
  usage: Usage,
): { ok: true } | { ok: false; reason: string; upgradeTo: PlanTier } {
  const p = PLANS[tier];
  const fail = (reason: string, key: "activeQueries" | "seats" | "workspaces" | "alerts") => ({
    ok: false as const,
    reason,
    upgradeTo:
      (["starter", "growth", "agency", "enterprise"] as PlanTier[]).find(
        (t) => PLANS[t][key] > p[key],
      ) ?? "enterprise",
  });
  switch (action) {
    case "create_query":
      return usage.activeQueries >= p.activeQueries
        ? fail(`Your ${p.label} plan includes ${p.activeQueries} active queries.`, "activeQueries")
        : { ok: true };
    case "invite_member":
      return usage.seats >= p.seats
        ? fail(`Your ${p.label} plan includes ${p.seats} seat${p.seats === 1 ? "" : "s"}.`, "seats")
        : { ok: true };
    case "create_workspace":
      return usage.workspaces >= p.workspaces
        ? fail(
            `Your ${p.label} plan includes ${p.workspaces} workspace${p.workspaces === 1 ? "" : "s"}.`,
            "workspaces",
          )
        : { ok: true };
    case "create_alert":
      return usage.alerts >= p.alerts
        ? fail(`Your ${p.label} plan includes ${p.alerts} alerts.`, "alerts")
        : { ok: true };
  }
}

const REFRESH_MS: Record<RefreshTier, number> = {
  realtime: 5 * 60_000,
  hourly: 3_600_000,
  "12h": 12 * 3_600_000,
};

/** The newest instant a plan can see: data refreshes in steps (12h / hourly / 5 min), not continuously. */
export function visibleUntil(tier: PlanTier, now: Date): Date {
  const g = REFRESH_MS[PLANS[tier].refresh];
  return new Date(Math.floor(now.getTime() / g) * g);
}
