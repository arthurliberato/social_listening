"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Entitlements } from "@/lib/entitlements/plans";
import { NewDashboardDialog } from "./NewDashboardDialog";

const Ctx = createContext<(() => void) | null>(null);

/** One template dialog for the whole page; any number of buttons can open it. */
export function NewDashboardProvider({
  ws,
  features,
  children,
}: {
  ws: string;
  features: Entitlements["features"];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Ctx.Provider value={() => setOpen(true)}>
      {children}
      <NewDashboardDialog ws={ws} features={features} open={open} onClose={() => setOpen(false)} />
    </Ctx.Provider>
  );
}

export function NewDashboardTrigger({
  label = "New dashboard",
  testId = "new-dashboard",
}: {
  label?: string;
  testId?: string;
}) {
  const open = useContext(Ctx);
  if (!open) throw new Error("NewDashboardTrigger must be used inside <NewDashboardProvider>");
  return (
    <Button onClick={open} data-testid={testId}>
      {label}
    </Button>
  );
}
