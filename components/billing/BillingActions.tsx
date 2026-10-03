"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  keepCurrentPlanAction,
  resumeAction,
  updateCardAction,
} from "@/app/settings/billing/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CardForm } from "./CardForm";

/** Resume a cancelled plan, or drop a scheduled downgrade. One click, no confirmation maze. */
export function ResumeButton({ kind }: { kind: "resume" | "keep" }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = kind === "resume" ? await resumeAction() : await keepCurrentPlanAction();
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(
      kind === "resume" ? "Your plan will keep renewing." : "Your plan stays as it is.",
    );
    router.refresh();
  };
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      onClick={run}
      data-testid={kind === "resume" ? "resume-plan" : "keep-plan"}
    >
      {kind === "resume" ? "Resume my plan" : "Keep my current plan"}
    </Button>
  );
}

export function UpdateCard({ pastDue }: { pastDue: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(pastDue);
  if (!open)
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="update-card-open"
      >
        Update card
      </Button>
    );
  return (
    <div
      className="mt-3 max-w-md rounded-lg border border-[var(--border)] p-4"
      data-testid="update-card"
    >
      <h3 className="mb-3 font-medium">{pastDue ? "Add a working card" : "New card"}</h3>
      <CardForm
        submitLabel={pastDue ? "Save card and retry payment" : "Save card"}
        note="Your card number is checked and never stored; we keep the brand, last four digits and expiry."
        onSubmit={async (c) => {
          const r = await updateCardAction(c);
          if (!r.ok) return r;
          toast.success(r.recovered ? "Card saved and the payment went through." : "Card saved.");
          setOpen(false);
          router.refresh();
          return { ok: true as const };
        }}
      />
    </div>
  );
}
