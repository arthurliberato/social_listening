"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { resendVerification } from "./actions";

export function ResendButton() {
  const [msg, setMsg] = useState<string>("");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        loading={pending}
        data-testid="resend-verification"
        onClick={() =>
          start(async () => {
            const r = await resendVerification();
            setMsg(
              r.ok
                ? "Sent. Check your inbox."
                : `Please wait ${r.waitSeconds}s before requesting another email.`,
            );
          })
        }
      >
        Resend verification email
      </Button>
      <p role="status" className="text-sm text-[var(--text-muted)]">
        {msg}
      </p>
    </div>
  );
}
