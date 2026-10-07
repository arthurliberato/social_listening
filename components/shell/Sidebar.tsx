"use client";

import {
  AlertTriangle,
  BarChart3,
  Bell,
  Download,
  FileText,
  Home,
  ListChecks,
  LayoutDashboard,
  MessageSquare,
  PanelLeftClose,
  Search,
  Sparkles,
  Tags,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CREATOR_NAV_GROUPS, NAV_GROUPS } from "./nav";
import { productOfPath } from "@/lib/products";

const ICONS: Record<string, typeof Home> = {
  home: Home,
  mentions: MessageSquare,
  alerts: Bell,
  crisis: AlertTriangle,
  dashboards: LayoutDashboard,
  authors: Users,
  topics: TrendingUp,
  ask: Sparkles,
  reports: FileText,
  exports: Download,
  queries: Search,
  tags: Tags,
  creators: Search,
  "creator-lists": ListChecks,
};

export function toggleSidebar(force?: boolean) {
  const el = document.documentElement;
  const collapsed = force ?? el.dataset.sidebar !== "collapsed";
  if (collapsed) el.dataset.sidebar = "collapsed";
  else delete el.dataset.sidebar;
  try {
    localStorage.setItem("rw-sidebar", collapsed ? "collapsed" : "expanded");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("rw-sidebar"));
}

export function Sidebar({ ws, clientOnly = false }: { ws: string; clientOnly?: boolean }) {
  const pathname = usePathname();
  const influencers = !clientOnly && productOfPath(pathname) === "influencers";
  const groups = influencers
    ? CREATOR_NAV_GROUPS
    : clientOnly
      ? NAV_GROUPS.map((g) => ({
          ...g,
          items: g.items.filter((i) => i.key === "dashboards" || i.key === "reports"),
        })).filter((g) => g.items.length)
      : NAV_GROUPS;
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const sync = () => setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
    sync();
    window.addEventListener("rw-sidebar", sync);
    return () => window.removeEventListener("rw-sidebar", sync);
  }, []);

  return (
    <nav
      aria-label="Primary"
      data-testid="sidebar"
      className="hidden w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] p-3 md:flex [[data-sidebar=collapsed]_&]:w-16"
    >
      {groups.map((group) => (
        <div key={group.label}>
          <h2 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] [[data-sidebar=collapsed]_&]:sr-only">
            {group.label}
          </h2>
          <ul>
            {group.items.map((item) => {
              const href = `/w/${ws}/${item.href}`;
              const active = item.exact
                ? pathname === href
                : pathname === href || pathname.startsWith(`${href}/`);
              const Icon = ICONS[item.key] ?? BarChart3;
              return (
                <li key={item.key}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    data-testid={`nav-${item.key}`}
                    title={collapsed ? item.label : undefined}
                    className={`flex min-h-9 items-center gap-3 rounded-md px-2 text-sm ${active ? "bg-[var(--surface-2)] font-medium text-[var(--text)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"}`}
                  >
                    <Icon size={20} strokeWidth={1.5} aria-hidden className="shrink-0" />
                    <span className="[[data-sidebar=collapsed]_&]:sr-only">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <button
        type="button"
        onClick={() => toggleSidebar()}
        aria-pressed={collapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        data-testid="sidebar-toggle"
        className="mt-auto flex min-h-9 items-center gap-3 rounded-md px-2 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
      >
        <PanelLeftClose
          size={20}
          strokeWidth={1.5}
          aria-hidden
          className={collapsed ? "rotate-180" : ""}
        />
        <span className="[[data-sidebar=collapsed]_&]:sr-only">Collapse</span>
      </button>
    </nav>
  );
}
