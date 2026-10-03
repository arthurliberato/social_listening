"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "./nav";

export function Sidebar({ ws }: { ws: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      data-testid="sidebar"
      className="hidden w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] p-3 md:flex"
    >
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <h2 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {group.label}
          </h2>
          <ul>
            {group.items.map((item) => {
              const href = `/w/${ws}/${item.href}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={item.key}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    data-testid={`nav-${item.key}`}
                    className={`flex min-h-9 items-center rounded-md px-2 text-sm ${
                      active
                        ? "bg-[var(--surface-2)] font-medium text-[var(--text)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
