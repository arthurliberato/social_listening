"use client";

import { HelpCircle } from "lucide-react";
import { NotificationsMenu, type NotificationItem } from "./NotificationsMenu";
import { ThemeToggle } from "./ThemeToggle";
import { QuotaMeter } from "./QuotaMeter";
import { UserMenu } from "./UserMenu";

const iconButton =
  "inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-[var(--surface-2)]";

export function Topbar({
  ws,
  slug,
  userName,
  usage,
  unreadAlerts,
  recentAlerts,
  now,
}: {
  ws: string;
  slug: string;
  unreadAlerts: number;
  recentAlerts: NotificationItem[];
  now: number;
  userName: string;
  usage: { used: number; limit: number; pct: number };
}) {
  return (
    <header
      role="banner"
      className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4"
    >
      <span className="font-semibold">Ripplewise</span>
      <span className="text-[var(--text-muted)]" data-testid="workspace-name">
        {ws}
      </span>
      <div className="ml-auto flex items-center gap-3">
        <QuotaMeter {...usage} />
        {/* Help stays in the same spot on every screen (WCAG 3.2.6). */}
        <button
          type="button"
          aria-label="Help and keyboard shortcuts"
          data-testid="help"
          className={iconButton}
          onClick={() => window.dispatchEvent(new Event("rw-open-shortcuts"))}
        >
          <HelpCircle size={16} aria-hidden />
        </button>
        <NotificationsMenu ws={slug} unread={unreadAlerts} items={recentAlerts} now={now} />
        <ThemeToggle />
        <UserMenu name={userName} />
      </div>
    </header>
  );
}
