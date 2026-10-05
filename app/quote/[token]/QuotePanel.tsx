"use client";

import { useBusy } from "@/lib/use-busy";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { track } from "@/lib/analytics/client";
import { acceptAction, signAction } from "./actions";

export function QuotePanel({
  token,
  valueUsd,
  status,
  user,
  canAct,
}: {
  token: string;
  valueUsd: number;
  status: "sent" | "viewed" | "accepted" | "signed";
  user: string | null;
  canAct: boolean;
}) {
  const [stage, setStage] = useState(status);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useBusy();

  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track("Quote Viewed", { quote_value: valueUsd });
  }, [valueUsd]);

  if (stage === "signed")
    return (
      <div
        role="status"
        className="rounded-lg border border-[var(--success)] p-5"
        data-testid="quote-signed"
      >
        <h2 className="text-lg font-semibold">Signed. Enterprise is active.</h2>
        <p className="mt-2 text-sm">
          Your account now has Enterprise limits and features.{" "}
          <Link href="/settings/billing" className="underline">
            See your plan
          </Link>
        </p>
      </div>
    );

  if (!user)
    return (
      <div className="rounded-lg border border-[var(--border)] p-5" data-testid="quote-login">
        <p className="text-sm">
          Log in as an owner or admin of your Ripplewise account to accept and sign.
        </p>
        <div className="mt-3 flex gap-3">
          <Link
            href={`/login?next=${encodeURIComponent(`/quote/${token}`)}`}
            className="inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
          >
            Log in
          </Link>
          <Link href="/signup" className="inline-flex min-h-9 items-center text-sm underline">
            Create an account
          </Link>
        </div>
      </div>
    );

  if (!canAct)
    return (
      <p
        role="status"
        className="rounded-lg border border-[var(--warning)] p-4 text-sm"
        data-testid="quote-cant-act"
      >
        You&apos;re signed in as {user}, who isn&apos;t an owner or admin of the account this quote
        is for. Ask one of them to open this link.
      </p>
    );

  if (stage !== "accepted")
    return (
      <div>
        <Button
          loading={pending}
          data-testid="quote-accept"
          onClick={() =>
            start(async () => {
              setError("");
              const r = await acceptAction(token);
              if (!r.ok) return setError(r.error);
              track("Quote Accepted", { quote_value: valueUsd });
              setStage("accepted");
            })
          }
        >
          Accept this quote
        </Button>
        {error && (
          <p role="alert" className="mt-2 text-sm text-[var(--danger)]" data-testid="quote-error">
            {error}
          </p>
        )}
      </div>
    );

  return (
    <form
      className="flex max-w-md flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError("");
          const r = await signAction(token, name, agree);
          if (!r.ok) return setError(r.error);
          setStage("signed");
        });
      }}
    >
      <p role="status" className="text-sm">
        Accepted. One last step: sign to activate Enterprise.
      </p>
      <Field
        label="Type your full name to sign"
        value={name}
        onChange={(e) => setName(e.target.value)}
        data-testid="sign-name"
      />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          className="mt-1"
          data-testid="sign-agree"
        />
        I agree to the Ripplewise Enterprise terms and to be invoiced for this quote.
      </label>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]" data-testid="quote-error">
          {error}
        </p>
      )}
      <Button type="submit" loading={pending} data-testid="sign-submit" className="self-start">
        Sign and activate
      </Button>
    </form>
  );
}
