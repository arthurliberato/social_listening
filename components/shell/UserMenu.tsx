"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { resetIdentity } from "@/lib/analytics/client";
import { logOut } from "./actions";

export function UserMenu({ name }: { name: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-[var(--text-muted)] sm:inline" data-testid="user-name">
        {name}
      </span>
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
