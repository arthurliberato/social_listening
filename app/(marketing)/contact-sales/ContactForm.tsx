"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { track } from "@/lib/analytics/client";
import { submitSalesRequest } from "./actions";

export function ContactForm({
  entryPoint,
  slots,
  defaults,
}: {
  entryPoint: string;
  slots: { iso: string; label: string }[];
  defaults: { name: string; email: string; company: string };
}) {
  const [kind, setKind] = useState<"contact" | "demo">("contact");
  const [f, setF] = useState({ ...defaults, seats: "", message: "" });
  const [slot, setSlot] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ kind: "contact" | "demo"; slotLabel?: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const seats = Number(f.seats);
    start(async () => {
      const r = await submitSalesRequest({
        kind,
        name: f.name,
        email: f.email,
        company: f.company,
        seats: Number.isFinite(seats) && seats > 0 ? Math.floor(seats) : 0,
        message: f.message,
        entryPoint,
        demoAt: kind === "demo" ? slot || undefined : undefined,
      });
      if (!r.ok) return setError(r.error);
      if (kind === "contact")
        track("Sales Contact Requested", { entry_point: entryPoint, seats_requested: seats });
      setDone({ kind, slotLabel: slots.find((s) => s.iso === slot)?.label });
    });
  }

  if (done)
    return (
      <div
        role="status"
        className="rounded-lg border border-[var(--success)] p-5"
        data-testid="sales-done"
      >
        <h2 className="text-lg font-semibold">
          {done.kind === "demo" ? "Your demo is booked" : "Thanks, we've got your message"}
        </h2>
        <p className="mt-2 text-sm">
          {done.kind === "demo"
            ? `We'll see you on ${done.slotLabel}. A confirmation is on its way to ${f.email}.`
            : `A member of our team will email ${f.email} with a tailored quote shortly.`}
        </p>
      </div>
    );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div role="radiogroup" aria-label="What would you like?" className="flex gap-2">
        {(
          [
            ["contact", "Get a quote"],
            ["demo", "Book a demo"],
          ] as const
        ).map(([k, label]) => (
          <label
            key={k}
            className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${kind === k ? "border-[var(--primary)] bg-[var(--surface-2)]" : "border-[var(--border)]"}`}
          >
            <input
              type="radio"
              name="kind"
              checked={kind === k}
              onChange={() => setKind(k)}
              data-testid={`kind-${k}`}
            />
            {label}
          </label>
        ))}
      </div>
      <Field
        label="Your name"
        value={f.name}
        onChange={set("name")}
        autoComplete="name"
        data-testid="sales-name"
      />
      <Field
        label="Work email"
        type="email"
        value={f.email}
        onChange={set("email")}
        autoComplete="email"
        data-testid="sales-email"
      />
      <Field
        label="Company"
        value={f.company}
        onChange={set("company")}
        autoComplete="organization"
        data-testid="sales-company"
      />
      <Field
        label="How many people will use Ripplewise?"
        inputMode="numeric"
        value={f.seats}
        onChange={set("seats")}
        data-testid="sales-seats"
      />
      {kind === "demo" && (
        <fieldset className="flex flex-col gap-2" data-testid="demo-slots">
          <legend className="text-sm font-medium">Pick a time (UTC)</legend>
          {slots.map((s) => (
            <label key={s.iso} className="inline-flex min-h-9 items-center gap-2 text-sm">
              <input
                type="radio"
                name="slot"
                value={s.iso}
                checked={slot === s.iso}
                onChange={() => setSlot(s.iso)}
              />
              {s.label}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="sales-msg" className="text-sm font-medium">
          Anything we should know? <span className="text-[var(--text-muted)]">(optional)</span>
        </label>
        <textarea
          id="sales-msg"
          rows={3}
          value={f.message}
          onChange={set("message")}
          className="rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]" data-testid="sales-error">
          {error}
        </p>
      )}
      <Button type="submit" loading={pending} data-testid="sales-submit" className="self-start">
        {kind === "demo" ? "Book demo" : "Request a quote"}
      </Button>
    </form>
  );
}
