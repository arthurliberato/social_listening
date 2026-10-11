"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCategory, previewCategory } from "@/app/w/[ws]/tags/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useBusy } from "@/lib/use-busy";

export function CategoryForm({ ws }: { ws: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<{ name?: string; booleanText?: string; form?: string }>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, run] = useBusy();

  const check = () =>
    run(async () => {
      setErrors({});
      const r = await previewCategory(ws, text);
      if (!r.ok) return setErrors({ booleanText: r.error });
      setPreview(
        `${r.total.toLocaleString()} mentions in the last 30 days, ${r.negative.toLocaleString()} negative.`,
      );
    });
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      setErrors({});
      const r = await createCategory(ws, { name, booleanText: text });
      if (!r.ok) return setErrors(r.field ? { [r.field]: r.error } : { form: r.error });
      setName("");
      setText("");
      setPreview(null);
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={save}
      className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2"
      data-testid="category-form"
      noValidate
    >
      <Field
        label="Category name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        data-testid="category-name"
        placeholder="Pricing complaints"
      />
      <Field
        label="Search"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        error={errors.booleanText}
        hint='Same language as queries, for example (price OR cost) NOT "free trial"'
        data-testid="category-text"
        placeholder="price OR expensive"
      />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button
          type="button"
          variant="secondary"
          onClick={check}
          loading={busy}
          data-testid="category-check"
        >
          Check matches
        </Button>
        <Button type="submit" loading={busy} data-testid="category-save">
          Save category
        </Button>
        {preview && (
          <span
            className="text-sm text-[var(--text-muted)]"
            role="status"
            data-testid="category-preview"
          >
            {preview}
          </span>
        )}
        {errors.form && (
          <span role="alert" className="text-sm text-[var(--danger)]">
            {errors.form}
          </span>
        )}
      </div>
    </form>
  );
}
