"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { acceptInviteAction } from "@/app/settings/team/actions";
import { Button } from "@/components/ui/button";

export function AcceptInvite({ token, workspace }: { token: string; workspace: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    setBusy(true);
    setError("");
    const r = await acceptInviteAction(token);
    if (!r.ok) {
      setBusy(false);
      return setError(
        r.error === "email_mismatch"
          ? "This invitation was sent to a different email address."
          : "This invitation is no longer valid. Ask for a new one.",
      );
    }
    router.push(`/w/${r.slug}/${r.role === "client_viewer" ? "dashboards" : "home"}`);
  };
  return (
    <div>
      <Button size="lg" onClick={go} loading={busy} data-testid="accept-invite">
        Join {workspace}
      </Button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
