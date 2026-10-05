"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { Menu } from "@/components/ui/menu";
import { relativeTime } from "@/lib/format";

export interface NotificationItem {
  id: string;
  title: string;
  summary: string;
  firedAt: string;
  status: string;
}

/** Bell in the top bar: unread alert count and the latest few firings. */
export function NotificationsMenu({
  ws,
  unread,
  items,
  now,
}: {
  ws: string;
  unread: number;
  items: NotificationItem[];
  now: number;
}) {
  const router = useRouter();
  return (
    <Menu
      testId="notifications"
      caret={false}
      align="right"
      buttonClassName="!h-9 !w-9 !justify-center !border-transparent !px-0"
      label={
        <span className="relative inline-flex">
          <Bell size={16} aria-hidden />
          <span className="sr-only">
            Notifications{unread ? `, ${unread} unread alert${unread === 1 ? "" : "s"}` : ""}
          </span>
          {unread > 0 && (
            <span
              aria-hidden
              data-testid="notification-count"
              className="absolute -right-2 -top-2 min-w-4 rounded-full bg-[var(--danger)] px-1 text-center text-[10px] font-semibold leading-4 text-[var(--primary-contrast)]"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      }
      items={[
        ...(items.length
          ? items.map((n) => ({
              key: n.id,
              testId: "notification",
              label: (
                <span className="block max-w-72 whitespace-normal text-left">
                  <span className="block text-sm font-medium">
                    {n.status === "new" ? "● " : ""}
                    {n.title}
                  </span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {n.summary} · {relativeTime(n.firedAt, now)}
                  </span>
                </span>
              ),
              onSelect: () => router.push(`/w/${ws}/alerts/events/${n.id}`),
            }))
          : [
              {
                key: "none",
                label: "No alerts yet",
                disabled: true,
                onSelect: () => {},
              },
            ]),
        {
          key: "all",
          testId: "notifications-all",
          label: "See all alerts",
          onSelect: () => router.push(`/w/${ws}/alerts`),
        },
      ]}
    />
  );
}
