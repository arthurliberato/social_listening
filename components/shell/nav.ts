export type NavItem = {
  key: string;
  label: string;
  href: string;
  shortcut?: string;
  /** Active only on this exact path, not on its sub-pages (Discover vs. Lists). */
  exact?: boolean;
};
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { key: "home", label: "Home", href: "home", shortcut: "g h" },
      { key: "mentions", label: "Mentions", href: "mentions", shortcut: "g m" },
      { key: "alerts", label: "Alerts", href: "alerts", shortcut: "g a" },
      { key: "crisis", label: "Crisis Rooms", href: "crisis" },
    ],
  },
  {
    label: "Analyze",
    items: [
      { key: "dashboards", label: "Dashboards", href: "dashboards", shortcut: "g d" },
      { key: "authors", label: "Authors", href: "authors" },
      { key: "topics", label: "Topics & Trends", href: "topics" },
      { key: "ask", label: "Ask AI", href: "ask" },
    ],
  },
  {
    label: "Deliver",
    items: [
      { key: "reports", label: "Reports", href: "reports", shortcut: "g r" },
      { key: "exports", label: "Exports", href: "exports" },
    ],
  },
  {
    label: "Configure",
    items: [
      { key: "queries", label: "Queries", href: "queries" },
      { key: "tags", label: "Tags & Categories", href: "tags" },
    ],
  },
];

export const CREATOR_NAV_GROUPS: NavGroup[] = [
  {
    label: "Find",
    items: [
      { key: "creators", label: "Discover", href: "creators", exact: true },
      { key: "creator-lists", label: "Lists", href: "creators/lists" },
    ],
  },
  {
    label: "Work",
    items: [{ key: "campaigns", label: "Campaigns", href: "creators/campaigns" }],
  },
];
