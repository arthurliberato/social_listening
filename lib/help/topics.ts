// Help center content. Plain data so it can be searched, tested and read without JavaScript.
export interface HelpTopic {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  link?: { label: string; href: (ws: string) => string };
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "first-query",
    title: "Create your first query",
    summary: "A query is the search that decides which mentions you collect.",
    steps: [
      "Open Queries and choose New query. Guided mode asks for your brand and a few related words; Advanced mode takes Boolean text.",
      "Watch the live preview: it shows how many mentions the query would match and how noisy they look.",
      "Add words to leave out with NOT, then save. History is collected for the length your plan allows.",
    ],
    link: { label: "Open Queries", href: (ws) => `/w/${ws}/queries` },
  },
  {
    id: "boolean",
    title: "Boolean operators and filters",
    summary: "The same language works in queries, the Mentions search box and categories.",
    steps: [
      'AND, OR, NOT and parentheses combine terms; quotes match an exact phrase ("juniper roast"). Operators are uppercase.',
      "run* matches words that start with run. a NEAR/5 b matches a within five words of b; NEAR/5f also requires that order.",
      "Fields narrow a search: author:handle, site:domain, source:reddit, lang:en, country:US, hashtag:brand, logo:brandslug.",
      'replyto:"https://…/@jane/12" finds replies to one post; replyto:@jane finds replies to anything that handle posted.',
    ],
  },
  {
    id: "triage",
    title: "Reading and triaging mentions",
    summary: "Filters live in the address bar, so you can share or bookmark any view.",
    steps: [
      "Use Filters for source, sentiment, language, country, tag, author reach and period. Remove a filter from its chip.",
      "Press j and k to move, x to select, t to tag, s then p, n or u to set sentiment, f to flag. Undo appears after each change.",
      "Your edits are kept separately from the collected data, so they never change what other workspaces see.",
    ],
    link: { label: "Open Mentions", href: (ws) => `/w/${ws}/mentions` },
  },
  {
    id: "categories",
    title: "Group mentions into categories",
    summary: "A category is a named search, such as pricing complaints or delivery delays.",
    steps: [
      "Open Tags & Categories, name the theme and write its search. Check matches shows the size before you save.",
      "Each category shows its mentions over 30 days and its negative share; View mentions opens the feed filtered the same way.",
    ],
    link: { label: "Open Tags & Categories", href: (ws) => `/w/${ws}/tags` },
  },
  {
    id: "dashboards",
    title: "Dashboards and sharing",
    summary: "Twelve widget types, templates, and a table view for every chart.",
    steps: [
      "Start from a template or a blank board, add widgets, then Save. Move a widget with the keyboard using the move controls.",
      "Click a bar, slice or point to open the Mentions behind it. Every widget has a table alternative.",
      "On plans with public links, Share creates a read-only link you can turn off at any time.",
    ],
    link: { label: "Open Dashboards", href: (ws) => `/w/${ws}/dashboards` },
  },
  {
    id: "alerts",
    title: "Alerts and crisis rooms",
    summary: "Be told when volume spikes, sentiment turns, or a high-reach author joins in.",
    steps: [
      "Create an alert from a query. The backtest shows how often it would have fired over your history, so you can tune the threshold.",
      "When an alert fires it appears in the bell. Opening it shows the hourly volume; acknowledge it so the team knows it is handled.",
      "Crisis rooms (Growth and above) track tasks, send stakeholder updates and record when it was resolved.",
    ],
    link: { label: "Open Alerts", href: (ws) => `/w/${ws}/alerts` },
  },
  {
    id: "reports",
    title: "Reports, exports and schedules",
    summary: "Build a report from sections, download it, or send it on a schedule.",
    steps: [
      "Add sections from any dashboard widget or from Authors and Topics with Add to report.",
      "Export a report as PDF or CSV; the mentions export respects the filters on screen and neutralises spreadsheet formulas.",
      "Scheduling (Growth and above) emails the report to the people you choose; opens and clicks are tracked.",
    ],
    link: { label: "Open Reports", href: (ws) => `/w/${ws}/reports` },
  },
  {
    id: "plans",
    title: "Plans, limits and billing",
    summary: "Limits are shown as meters, and a locked feature says which plan unlocks it.",
    steps: [
      "Usage shows queries, mentions, seats, alerts and AI questions against your plan. A warning appears at 80% and 100%.",
      "Change plan, update the card or cancel from Billing. Cancelling takes no more than three steps and a retention offer is shown at most once.",
      "Enterprise is arranged with our team: use Contact sales for a quote.",
    ],
  },
  {
    id: "team",
    title: "People, roles and workspaces",
    summary: "Owners and admins manage people; editors change content; viewers read.",
    steps: [
      "Invite people from Members. Owner and Admin manage people and billing; Editor creates and edits; Viewer reads and exports; Client viewer sees only dashboards and reports with your branding.",
      "Workspaces separate clients or brands. Switch from the menu in the top bar.",
    ],
  },
  {
    id: "ai",
    title: "Ask AI and AI summaries",
    summary: "Answers cite the mentions they came from, and use a monthly allowance.",
    steps: [
      "Ask a question about your mentions. Every answer lists at least three mentions you can open; if it can't, it says so and the question is not counted.",
      "Crisis rooms can summarise the situation and explain a peak in volume.",
    ],
    link: { label: "Open Ask AI", href: (ws) => `/w/${ws}/ask` },
  },
];

export const SUPPORT_CATEGORIES = [
  { id: "how_to", label: "How do I…?" },
  { id: "query", label: "A query isn't finding the right mentions" },
  { id: "billing", label: "Billing or plan" },
  { id: "bug", label: "Something isn't working" },
  { id: "other", label: "Something else" },
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]["id"];
