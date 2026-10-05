"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatCardNumber, parseExpiry, TEST_CARDS } from "@/lib/billing/cards";

export interface CardValues {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  name: string;
}
type Field = "number" | "expiry" | "cvc" | "name";
export type CardSubmit = (
  c: CardValues,
) => Promise<{ ok: true } | { ok: false; error: string; field?: string }>;

const input =
  "min-h-10 w-full rounded-[var(--radius-input)] border bg-[var(--surface)] px-3 text-sm";

/** Card entry with an error under the field it belongs to. The card number never leaves this form except to be checked. */
export function CardForm({
  submitLabel,
  onSubmit,
  note,
}: {
  submitLabel: string;
  onSubmit: CardSubmit;
  note?: string;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field | "form", string>>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ex = parseExpiry(expiry);
    const local: typeof errors = {};
    if (!name.trim()) local.name = "Enter the name on the card.";
    if (!number.trim()) local.number = "Enter the card number.";
    if (!ex) local.expiry = "Enter the expiry as MM/YY.";
    if (!cvc.trim()) local.cvc = "Enter the security code.";
    if (Object.keys(local).length) return setErrors(local);
    setErrors({});
    setBusy(true);
    const r = await onSubmit({
      number,
      expMonth: ex!.expMonth,
      expYear: ex!.expYear,
      cvc,
      name,
    });
    setBusy(false);
    if (!r.ok) {
      const f = (["number", "expiry", "cvc", "name"] as const).find((x) => x === r.field);
      setErrors(f ? { [f]: r.error } : { form: r.error });
    }
  };

  const field = (
    f: Field,
    label: string,
    el: (p: { id: string; invalid: boolean; describedBy?: string }) => React.ReactNode,
  ) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-${f}`} className="text-sm font-medium">
        {label}
      </label>
      {el({
        id: `${id}-${f}`,
        invalid: !!errors[f],
        describedBy: errors[f] ? `${id}-${f}-err` : undefined,
      })}
      {errors[f] && (
        <p
          id={`${id}-${f}-err`}
          className="text-sm text-[var(--danger)]"
          data-testid={`card-error-${f}`}
        >
          {errors[f]}
        </p>
      )}
    </div>
  );
  const cls = (bad: boolean) =>
    `${input} ${bad ? "border-[var(--danger)]" : "border-[var(--border)]"}`;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate data-testid="card-form">
      {field("name", "Name on card", (p) => (
        <input
          id={p.id}
          autoComplete="cc-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={p.invalid || undefined}
          aria-describedby={p.describedBy}
          className={cls(p.invalid)}
          data-testid="card-name"
        />
      ))}
      {field("number", "Card number", (p) => (
        <input
          id={p.id}
          inputMode="numeric"
          autoComplete="cc-number"
          value={number}
          onChange={(e) => setNumber(formatCardNumber(e.target.value))}
          aria-invalid={p.invalid || undefined}
          aria-describedby={p.describedBy}
          className={cls(p.invalid)}
          data-testid="card-number"
        />
      ))}
      <div className="grid grid-cols-2 gap-4">
        {field("expiry", "Expiry (MM/YY)", (p) => (
          <input
            id={p.id}
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/YY"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            aria-invalid={p.invalid || undefined}
            aria-describedby={p.describedBy}
            className={cls(p.invalid)}
            data-testid="card-expiry"
          />
        ))}
        {field("cvc", "Security code", (p) => (
          <input
            id={p.id}
            inputMode="numeric"
            autoComplete="cc-csc"
            value={cvc}
            onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
            aria-invalid={p.invalid || undefined}
            aria-describedby={p.describedBy}
            className={cls(p.invalid)}
            data-testid="card-cvc"
          />
        ))}
      </div>
      {errors.form && (
        <p role="alert" className="text-sm text-[var(--danger)]" data-testid="card-error-form">
          {errors.form}
        </p>
      )}
      <details
        className="rounded-md border border-[var(--border)] p-3 text-sm"
        data-testid="test-cards"
      >
        <summary className="cursor-pointer font-medium">Test mode: no real card is charged</summary>
        <p className="mt-2 text-[var(--text-muted)]">
          Use any future expiry, any 3-digit code and any name with one of these numbers:
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {TEST_CARDS.map((c) => (
            <li key={c.number}>
              <code className="rounded bg-[var(--surface-2)] px-1">{c.number}</code>{" "}
              <span className="text-[var(--text-muted)]">{c.what}</span>
            </li>
          ))}
        </ul>
      </details>
      {note && <p className="text-xs text-[var(--text-muted)]">{note}</p>}
      <Button type="submit" loading={busy} data-testid="card-submit">
        {submitLabel}
      </Button>
    </form>
  );
}
