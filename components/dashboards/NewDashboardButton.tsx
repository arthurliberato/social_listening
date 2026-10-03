"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Entitlements } from "@/lib/entitlements/plans";
import { NewDashboardDialog } from "./NewDashboardDialog";

export function NewDashboardButton({
  ws,
  features,
  label = "New dashboard",
}: {
  ws: string;
  features: Entitlements["features"];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="new-dashboard">
        {label}
      </Button>
      <NewDashboardDialog ws={ws} features={features} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
