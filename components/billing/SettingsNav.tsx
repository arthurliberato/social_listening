"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/settings/billing", label: "Billing", manage: true },
  { href: "/settings/usage", label: "Usage", manage: false },
  { href: "/settings/members", label: "Members", manage: true },
  { href: "/settings/workspaces", label: "Workspaces", manage: false },
  { href: "/settings/branding", label: "Branding", manage: true },
  { href: "/settings/audit", label: "Audit log", manage: true },
];

export function SettingsNav({ canManage }: { canManage: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="flex gap-1 sm:flex-col">
      {ITEMS.filter((i) => canManage || !i.manage).map((i) => {
        const here = path === i.href || path.startsWith(`${i.href}/`);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={here ? "page" : undefined}
            className={`min-h-9 rounded-md px-3 py-2 text-sm ${here ? "bg-[var(--surface-2)] font-medium" : "hover:bg-[var(--surface-2)]"}`}
            data-testid={`settings-nav-${i.label.toLowerCase().replace(" ", "-")}`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
