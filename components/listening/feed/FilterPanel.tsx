"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { COUNTRIES, LANGUAGES, SOURCE_TYPES } from "@/lib/query/constants";
import {
  CONTENT_TYPES,
  FOLLOWER_BANDS,
  SENTIMENTS,
  type FeedFilters,
} from "@/lib/mentions/filters";

type Draft = Pick<
  FeedFilters,
  | "source"
  | "sentiment"
  | "lang"
  | "country"
  | "type"
  | "tag"
  | "author"
  | "followers"
  | "media"
  | "flagged"
  | "spam"
>;

function Group({
  legend,
  options,
  value,
  onChange,
  testId,
}: {
  legend: string;
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
  testId: string;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {options.map((o) => (
          <label key={o} className="flex min-h-6 items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={value.includes(o)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))
              }
              data-testid={`${testId}-${o}`}
            />
            {o}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** "+ Filter" dialog: edit a draft, then Apply (one URL change, one result load). */
export function FilterPanel({
  open,
  filters,
  tags,
  onApply,
  onClose,
}: {
  open: boolean;
  filters: FeedFilters;
  tags: string[];
  onApply: (d: Draft) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pick = (f: FeedFilters): Draft => ({
    source: f.source,
    sentiment: f.sentiment,
    lang: f.lang,
    country: f.country,
    type: f.type,
    tag: f.tag,
    author: f.author,
    followers: f.followers,
    media: f.media,
    flagged: f.flagged,
    spam: f.spam,
  });
  const [d, setD] = useState<Draft>(pick(filters));
  useEffect(() => {
    if (open) setD(pick(filters));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="fp-title"
      onClose={onClose}
      data-testid="filter-panel"
      className="m-auto w-full max-w-2xl rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text)] backdrop:bg-black/40"
    >
      <h2 id="fp-title" className="text-xl font-semibold">
        Filters
      </h2>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(d);
        }}
        className="mt-4 flex flex-col gap-4"
      >
        <Group
          legend="Sources"
          options={SOURCE_TYPES}
          value={d.source}
          onChange={(source) => setD({ ...d, source })}
          testId="f-source"
        />
        <Group
          legend="Sentiment"
          options={SENTIMENTS}
          value={d.sentiment}
          onChange={(sentiment) => setD({ ...d, sentiment })}
          testId="f-sentiment"
        />
        <Group
          legend="Language"
          options={LANGUAGES}
          value={d.lang}
          onChange={(lang) => setD({ ...d, lang })}
          testId="f-lang"
        />
        <Group
          legend="Country"
          options={COUNTRIES}
          value={d.country}
          onChange={(country) => setD({ ...d, country })}
          testId="f-country"
        />
        <Group
          legend="Content type"
          options={CONTENT_TYPES}
          value={d.type}
          onChange={(type) => setD({ ...d, type })}
          testId="f-type"
        />
        {tags.length > 0 && (
          <Group
            legend="Tags"
            options={tags}
            value={d.tag}
            onChange={(tag) => setD({ ...d, tag })}
            testId="f-tag"
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Author
            <input
              value={d.author ?? ""}
              onChange={(e) => setD({ ...d, author: e.target.value || undefined })}
              placeholder="handle or name"
              data-testid="f-author"
              className="min-h-9 rounded border border-[var(--border)] bg-[var(--surface)] px-2 font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Author followers
            <select
              value={d.followers ?? ""}
              onChange={(e) => setD({ ...d, followers: e.target.value || undefined })}
              data-testid="f-followers"
              className="min-h-9 rounded border border-[var(--border)] bg-[var(--surface)] px-2 font-normal"
            >
              <option value="">Any</option>
              {FOLLOWER_BANDS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!d.media}
              onChange={(e) => setD({ ...d, media: e.target.checked || undefined })}
              data-testid="f-media"
            />{" "}
            Has media
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!d.flagged}
              onChange={(e) => setD({ ...d, flagged: e.target.checked || undefined })}
              data-testid="f-flagged"
            />{" "}
            Flagged only
          </label>
          <label className="flex items-center gap-2">
            Likely spam
            <select
              value={d.spam}
              onChange={(e) => setD({ ...d, spam: e.target.value as Draft["spam"] })}
              data-testid="f-spam"
              className="min-h-8 rounded border border-[var(--border)] bg-[var(--surface)] px-2"
            >
              <option value="hide">Hide</option>
              <option value="show">Show</option>
              <option value="only">Only</option>
            </select>
          </label>
        </div>
        <div className="mt-2 flex flex-wrap justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              setD({
                source: [],
                sentiment: [],
                lang: [],
                country: [],
                type: [],
                tag: [],
                author: undefined,
                followers: undefined,
                media: undefined,
                flagged: undefined,
                spam: "hide",
              })
            }
            data-testid="f-clear"
          >
            Clear all
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" data-testid="f-apply">
            Apply filters
          </Button>
        </div>
      </form>
    </dialog>
  );
}

export type { Draft as FilterDraft };
