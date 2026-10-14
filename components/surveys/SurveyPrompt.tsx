"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { SurveyView } from "@/lib/surveys/service";

/**
 * A short in-product question, shown bottom-right. It does not take focus or cover the page, can always be dismissed
 * with "Not now", and says nothing if it cannot load. It stays until answered or dismissed for the rest of the visit.
 */
const post = async (body: unknown): Promise<{ ok: boolean; error?: string }> => {
  const r = await fetch("/api/survey", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({ ok: false, error: "Something went wrong. Try again." }));
};

export function SurveyPrompt({ ws }: { ws: string }) {
  const [survey, setSurvey] = useState<SurveyView | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [thanks, setThanks] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    void fetch(`/api/survey?ws=${encodeURIComponent(ws)}`)
      .then((r) => (r.ok ? r.json() : { survey: null }))
      .then((d: { survey: SurveyView | null }) => alive && setSurvey(d.survey))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ws]);

  if (thanks)
    return (
      <p
        role="status"
        data-testid="survey-thanks"
        className="fixed bottom-4 right-4 z-40 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm shadow-lg"
      >
        Thanks, that helps.
      </p>
    );
  if (!survey) return null;

  const complete = survey.items.every((i) => answers[i.id] !== undefined);
  const { min, max, lowLabel, highLabel } = survey.scale;
  const points = Array.from({ length: max - min + 1 }, (_, k) => min + k);

  function submit() {
    start(async () => {
      const r = await post({ action: "answer", ws, survey_id: survey!.id, answers });
      if (!r.ok) return setError(r.error ?? "Something went wrong. Try again.");
      setThanks(true);
      setSurvey(null);
      setTimeout(() => setThanks(false), 4000);
    });
  }

  function dismiss() {
    start(async () => {
      await post({ action: "dismiss", ws, survey_id: survey!.id });
      setSurvey(null);
    });
  }

  return (
    <section
      aria-label={survey.title}
      data-testid="survey-prompt"
      data-survey-id={survey.id}
      className="fixed bottom-4 right-4 z-40 w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg"
    >
      <h2 className="text-base font-semibold">{survey.title}</h2>
      {survey.items.map((item) => (
        <fieldset key={item.id} className="mt-3">
          <legend className="text-sm">{item.text}</legend>
          <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label={item.text}>
            {points.map((p) => (
              <label
                key={p}
                className={`flex min-h-8 min-w-8 cursor-pointer items-center justify-center rounded-md border px-2 text-sm ${answers[item.id] === p ? "border-[var(--primary)] bg-[var(--surface-2)] font-semibold" : "border-[var(--border)]"}`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`${survey.id}-${item.id}`}
                  value={p}
                  checked={answers[item.id] === p}
                  onChange={() => setAnswers((a) => ({ ...a, [item.id]: p }))}
                  data-testid={`survey-${survey.id}-${item.id}-${p}`}
                />
                {p}
              </label>
            ))}
          </div>
          <p className="mt-1 flex justify-between text-xs text-[var(--text-muted)]">
            <span>{lowLabel}</span>
            <span>{highLabel}</span>
          </p>
        </fieldset>
      ))}
      {error && (
        <p role="alert" data-testid="survey-error" className="mt-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={dismiss} disabled={pending} data-testid="survey-dismiss">
          Not now
        </Button>
        <Button onClick={submit} disabled={!complete || pending} data-testid="survey-submit">
          Send
        </Button>
      </div>
    </section>
  );
}
