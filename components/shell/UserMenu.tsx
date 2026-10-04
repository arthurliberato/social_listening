"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { resetIdentity } from "@/lib/analytics/client";
import { logOut } from "./actions";

export function UserMenu({
  name,
  canManageBilling,
  isClient,
}: {
  name: string;
  canManageBilling: boolean;
  isClient: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-[var(--text-muted)] sm:inline" data-testid="user-name">
        {name}
      </span>
      {!isClient && (
        <Link
          href="/settings/usage"
          className="hidden min-h-8 items-center rounded-md px-2 text-sm hover:bg-[var(--surface-2)] sm:inline-flex"
          data-testid="nav-usage"
        >
          Usage
        </Link>
      )}
      {canManageBilling && (
        <Link
          href="/settings/billing"
          className="hidden min-h-8 items-center rounded-md px-2 text-sm hover:bg-[var(--surface-2)] sm:inline-flex"
          data-testid="nav-billing"
        >
          Billing
        </Link>
      )}
      <Button
        variant="ghost"
        size="sm"
        loading={pending}
        data-testid="logout"
        onClick={() =>
          start(async () => {
            resetIdentity();
            await logOut();
          })
        }
      >
        Log out
      </Button>
    </div>
  );
}
