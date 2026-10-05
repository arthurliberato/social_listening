"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { resetIdentity } from "@/lib/analytics/client";
import { logOut } from "@/components/shell/actions";

export function LogoutButton({ next }: { next?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      loading={pending}
      data-testid="invite-logout"
      onClick={() =>
        start(async () => {
          resetIdentity();
          await logOut(next);
        })
      }
    >
      Log out
    </Button>
  );
}
