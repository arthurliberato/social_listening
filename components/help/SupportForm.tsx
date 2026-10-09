"use client";

import { useState } from "react";
import { sendSupport } from "@/app/w/[ws]/help/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SUPPORT_CATEGORIES } from "@/lib/help/topics";
import { useBusy } from "@/lib/use-busy";

export function SupportForm({ ws }: { ws: string }) {
  const [category, setCategory] = useState("how_to");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ subject?: string; message?: string; form?: string }>({});
  const [sent, setSent] = useState<string | null>(null);
  const [busy, run] = useBusy();

  if (sent)
    return (
      <div
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
        role="status"
        data-testid="support-sent"
      >
        <h3 className="font-semibold">Thanks, we have your question</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Your reference is <strong data-testid="support-ref">{sent}</strong>. We sent a copy to
          your inbox and a person will reply by email, usually within one working day.
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          onClick={() => {
            setSent(null);
            setSubject("");
            setMessage("");
          }}
        >
          Ask another question
        </Button>
      </div>
    );

  return (
    <form
      noValidate
      className="grid max-w-2xl gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid="support-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          setErrors({});
          const r = await sendSupport(ws, { category, subject, message });
          if (!r.ok)
            return setErrors(
              r.field === "subject" || r.field === "message"
                ? { [r.field]: r.error }
                : { form: r.error },
            );
          setSent(r.reference);
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="support-category" className="text-sm font-medium">
          What is it about?
        </label>
        <select
          id="support-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
          data-testid="support-category"
        >
          {SUPPORT_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <Field
        label="Title"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        error={errors.subject}
        maxLength={120}
        data-testid="support-subject"
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="support-message" className="text-sm font-medium">
          Your question
        </label>
        <textarea
          id="support-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          maxLength={3000}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? "support-message-err" : undefined}
          className="rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          data-testid="support-message"
        />
        {errors.message && (
          <p id="support-message-err" role="alert" className="text-xs text-[var(--danger)]">
            {errors.message}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy} data-testid="support-submit">
          Send question
        </Button>
        {errors.form && (
          <span role="alert" className="text-sm text-[var(--danger)]">
            {errors.form}
          </span>
        )}
      </div>
    </form>
  );
}
