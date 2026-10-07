"use client";

import { HelpCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProductSwitcher } from "./ProductSwitcher";
import { productOfPath } from "@/lib/products";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
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
  canManageBilling,
  isClient,
  brandName,
  workspaces,
  currentId,
}: {
  ws: string;
  slug: string;
  unreadAlerts: number;
  recentAlerts: NotificationItem[];
  now: number;
  canManageBilling: boolean;
  isClient: boolean;
  brandName: string;
  workspaces: { id: string; slug: string; name: string }[];
  currentId: string;
  userName: string;
  usage: { used: number; limit: number; pct: number };
}) {
  const product = productOfPath(usePathname());
  return (
    <header
      role="banner"
      className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4"
    >
      <span className="font-semibold" data-testid="brand-name">
        {brandName || "Ripplewise"}
      </span>
      {!isClient && (
        <>
          <ProductSwitcher slug={slug} />
          <Link
            href="/hub"
            className="text-sm text-[var(--text-muted)] underline"
            data-testid="all-products"
          >
            All products
          </Link>
        </>
      )}
      <WorkspaceSwitcher
        current={{ id: currentId, name: ws }}
        workspaces={workspaces}
        canManage={canManageBilling}
        landing={isClient ? "dashboards" : product === "influencers" ? "creators" : "home"}
      />
      <div className="ml-auto flex items-center gap-3">
        {!isClient && product === "listening" && <QuotaMeter {...usage} />}
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
        {!isClient && (
          <NotificationsMenu ws={slug} unread={unreadAlerts} items={recentAlerts} now={now} />
        )}
        <ThemeToggle />
        <UserMenu name={userName} canManageBilling={canManageBilling} isClient={isClient} />
      </div>
    </header>
  );
}
