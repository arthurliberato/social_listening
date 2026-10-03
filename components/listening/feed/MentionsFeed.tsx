"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addTags,
  countNewMentions,
  deleteView,
  getMentionDetail,
  removeTag,
  restoreOverrides,
  saveView,
  setFlag,
  setSentiment,
  type EditResult,
  type MentionDetail,
} from "@/app/w/[ws]/mentions/actions";
import { PaywallModal, type PaywallProps } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { track } from "@/lib/analytics/client";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import type { FeedResult, FeedRow } from "@/lib/mentions/feed";
import {
  PAGE_SIZES,
  clearedFilters,
  RANGE_DAYS,
  removeChip,
  toSearchParams,
  type Chip,
  type FeedFilters,
} from "@/lib/mentions/filters";
import type { OverrideState } from "@/lib/mentions/overrides";
import { isTyping, shortcutsEnabled } from "@/lib/shortcuts";
import { FilterBar } from "./FilterBar";
import { FilterPanel, type FilterDraft } from "./FilterPanel";
import { MentionCard, sentimentItems } from "./MentionCard";
import { MentionDrawer } from "./MentionDrawer";
import { MentionListRow } from "./MentionListRow";
import { MentionTable } from "./MentionTable";
import { SaveViewDialog } from "./SaveViewDialog";
import { TagDialog } from "./TagDialog";
import { bodyOf } from "./parts";

type Patch = {
  sentiment?: string | null;
  addTags?: string[];
  removeTag?: string;
  flagged?: boolean;
};

const applyPatch = (rows: FeedRow[], ids: Set<number>, p: Patch): FeedRow[] =>
  rows.map((r) => {
    if (!ids.has(r.id)) return r;
    const n = { ...r };
    if (p.sentiment !== undefined) {
      n.sentiment = p.sentiment ?? r.predicted;
      n.overridden = p.sentiment !== null;
    }
    if (p.addTags) n.tags = [...new Set([...r.tags, ...p.addTags])];
    if (p.removeTag) n.tags = r.tags.filter((t) => t !== p.removeTag);
    if (p.flagged !== undefined) n.flagged = p.flagged;
    return n;
  });

const restoreRows = (rows: FeedRow[], snap: OverrideState[]): FeedRow[] => {
  const by = new Map(snap.map((s) => [s.id, s]));
  return rows.map((r) => {
    const s = by.get(r.id);
    return s
      ? {
          ...r,
          sentiment: s.sentiment ?? r.predicted,
          overridden: s.sentiment !== null,
          tags: s.tags,
          flagged: s.flagged,
        }
      : r;
  });
};

const csvCell = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export function MentionsFeed({
  ws,
  canEdit,
  tier,
  historyDays,
  feed,
  filters,
  savedViews,
  tags,
  entryPoint,
}: {
  ws: string;
  canEdit: boolean;
  tier: PlanTier;
  historyDays: number;
  feed: FeedResult;
  filters: FeedFilters;
  savedViews: { id: string; name: string; params: string }[];
  tags: string[];
  entryPoint: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [pending, startNav] = useTransition();
  const [rows, setRows] = useState(feed.rows);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cursor, setCursor] = useState<number | null>(null);
  const [view, setView] = useState(filters.view);
  const [drawerId, setDrawerId] = useState<number | null>(filters.m ? Number(filters.m) : null);
  const [detail, setDetail] = useState<MentionDetail | null | "loading">(null);
  const [tagTarget, setTagTarget] = useState<number[] | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [paywall, setPaywall] = useState<PaywallProps | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastClicked = useRef<number | null>(null);
  const sChord = useRef(0);
  const now = useMemo(() => Date.now(), [feed.loadedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const pendingFilterEvents = useRef<{ filter_type: string; filter_value_count: number }[]>([]);

  // New data from the server replaces local state.
  useEffect(() => {
    setRows(feed.rows);
    setSelected(new Set());
    setCursor(null);
    setNewCount(0);
  }, [feed.loadedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    track("Mentions Feed Viewed", {
      entry_point: entryPoint,
      result_count: feed.total,
      view_mode: view,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const e of pendingFilterEvents.current)
      track("Mention Filter Applied", { ...e, result_count: feed.total });
    pendingFilterEvents.current = [];
  }, [feed.loadedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const rowEls = useRef(new Map<number, HTMLElement>());

  // ---- URL helpers -----------------------------------------------------------------------
  const go = useCallback(
    (next: FeedFilters, extra?: { filter_type: string; filter_value_count: number }[]) => {
      if (extra) pendingFilterEvents.current = extra;
      const qs = toSearchParams({ ...next, view }).toString();
      startNav(() => router.push(`${pathname}${qs ? `?${qs}` : ""}`));
    },
    [router, pathname, view],
  );

  const replaceParam = useCallback((key: string, value: string | null) => {
    const u = new URL(window.location.href);
    if (value === null) u.searchParams.delete(key);
    else u.searchParams.set(key, value);
    window.history.replaceState(null, "", u);
  }, []);

  // ---- drawer ----------------------------------------------------------------------------
  const openDrawer = useCallback(
    (id: number) => {
      setDrawerId(id);
      setDetail("loading");
      replaceParam("m", String(id));
      const r = byId.get(id);
      track("Mention Opened", { source_type: r?.sourceType, entry_point: entryPoint });
      void getMentionDetail(ws, id)
        .then((d) => setDetail(d))
        .catch(() => setDetail(null));
    },
    [byId, entryPoint, replaceParam, ws],
  );
  const closeDrawer = useCallback(() => {
    const id = drawerId;
    setDrawerId(null);
    setDetail(null);
    replaceParam("m", null);
    if (id) rowEls.current.get(id)?.focus({ preventScroll: true });
  }, [drawerId, replaceParam]);
  useEffect(() => {
    if (filters.m && drawerId === Number(filters.m) && detail === null) {
      setDetail("loading");
      void getMentionDetail(ws, drawerId)
        .then(setDetail)
        .catch(() => setDetail(null));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- edits (optimistic + Undo) ---------------------------------------------------------
  const edit = useCallback(
    async (ids: number[], patch: Patch, call: () => Promise<EditResult>, message: string) => {
      const prev = rows;
      setRows((rs) => applyPatch(rs, new Set(ids), patch));
      let res: EditResult;
      try {
        res = await call();
      } catch {
        res = { ok: false, error: "Something went wrong. Your change wasn't saved." };
      }
      if (!res.ok) {
        setRows(prev);
        toast.error(res.error);
        return;
      }
      toast.success(message, {
        label: "Undo",
        onClick: () => {
          setRows((rs) => restoreRows(rs, res.snapshot));
          void restoreOverrides(ws, res.snapshot);
        },
      });
    },
    [rows, toast, ws],
  );

  const doSentiment = useCallback(
    (ids: number[], s: string | null) => {
      if (!ids.length) return;
      const first = byId.get(ids[0]!);
      void edit(
        ids,
        { sentiment: s },
        () =>
          setSentiment(ws, ids, s, {
            source_type: first?.sourceType,
            lang: first?.lang,
            from: first?.sentiment,
          }),
        s
          ? `Sentiment set to ${s} for ${ids.length} mention${ids.length === 1 ? "" : "s"}.`
          : "Sentiment reset to the classifier's value.",
      );
    },
    [byId, edit, ws],
  );
  const doFlag = useCallback(
    (ids: number[], flagged?: boolean) => {
      if (!ids.length) return;
      const want = flagged ?? !ids.every((id) => byId.get(id)?.flagged);
      void edit(
        ids,
        { flagged: want },
        () => setFlag(ws, ids, want),
        want ? `Flagged ${ids.length} mention${ids.length === 1 ? "" : "s"}.` : "Flag removed.",
      );
    },
    [byId, edit, ws],
  );
  const doTag = useCallback(
    (ids: number[], newTags: string[]) => {
      void edit(
        ids,
        { addTags: newTags },
        () => addTags(ws, ids, newTags),
        `Tagged ${ids.length} mention${ids.length === 1 ? "" : "s"} #${newTags.join(", #")}.`,
      );
    },
    [edit, ws],
  );
  const doRemoveTag = useCallback(
    (id: number, t: string) => {
      void edit([id], { removeTag: t }, () => removeTag(ws, [id], t), `Removed #${t}.`);
    },
    [edit, ws],
  );

  const copyLink = useCallback(
    async (id: number) => {
      const u = new URL(window.location.href);
      u.searchParams.set("m", String(id));
      try {
        await navigator.clipboard.writeText(u.toString());
        toast.success("Link copied.");
      } catch {
        toast.error("Couldn't copy automatically. Copy the address bar link instead.");
      }
    },
    [toast],
  );

  const exportRows = useCallback(
    (ids: number[]) => {
      if (ids.length) {
        const picked = rows.filter((r) => ids.includes(r.id));
        const header = [
          "id",
          "published_at",
          "source",
          "author",
          "sentiment",
          "tags",
          "flagged",
          "reach",
          "text",
          "url",
        ];
        const csv = [
          header.join(","),
          ...picked.map((r) =>
            [
              r.id,
              r.publishedAt,
              r.sourceType,
              `@${r.author.handle}`,
              r.sentiment,
              r.tags.join("|"),
              r.flagged,
              r.reach,
              bodyOf(r),
              r.url,
            ]
              .map(csvCell)
              .join(","),
          ),
        ].join("\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        a.download = `mentions-selection-${ws}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        track("Export Downloaded", { format: "csv", row_count: picked.length });
        toast.success(`Exported ${picked.length} mention${picked.length === 1 ? "" : "s"}.`);
      } else {
        const qs = toSearchParams(filters).toString();
        window.location.href = `/api/w/${ws}/mentions/export${qs ? `?${qs}` : ""}`;
      }
    },
    [rows, filters, toast, ws],
  );

  // ---- selection -------------------------------------------------------------------------
  const toggleSelect = useCallback(
    (id: number, shift: boolean) => {
      // Capture the anchor now: state updaters run later, after lastClicked has been overwritten.
      const anchor = lastClicked.current;
      const idx = rows.findIndex((r) => r.id === id);
      lastClicked.current = idx;
      setSelected((cur) => {
        const next = new Set(cur);
        if (shift && anchor !== null) {
          const [a, b] = [Math.min(anchor, idx), Math.max(anchor, idx)];
          for (let i = a; i <= b; i++) next.add(rows[i]!.id);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [rows],
  );

  // ---- new-mention polling ---------------------------------------------------------------
  useEffect(() => {
    const t = setInterval(() => {
      void countNewMentions(ws, feed.loadedAt)
        .then(setNewCount)
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, [ws, feed.loadedAt]);
  const loadNew = useCallback(() => {
    setNewCount(0);
    startNav(() => router.refresh());
  }, [router]);

  // ---- keyboard --------------------------------------------------------------------------
  const kb = useRef({ rows, cursor, selected, drawerId, newCount });
  kb.current = { rows, cursor, selected, drawerId, newCount };
  useEffect(() => {
    const used = (shortcut: string) =>
      track("Keyboard Shortcut Used", { shortcut, context: "mentions" });
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (document.querySelector("dialog[open]")) return;
        if (kb.current.drawerId) {
          closeDrawer();
          return;
        }
        if (kb.current.selected.size) setSelected(new Set());
        return;
      }
      if (isTyping(e) || !shortcutsEnabled() || document.querySelector("dialog[open]")) return;
      const { rows: rs, cursor: cur, selected: sel } = kb.current;
      const curRow = cur !== null ? rs[cur] : undefined;
      const move = (to: number) => {
        const i = Math.max(0, Math.min(rs.length - 1, to));
        setCursor(i);
        const el = rowEls.current.get(rs[i]!.id) ?? document.getElementById(`mention-${rs[i]!.id}`);
        el?.focus();
        if (kb.current.drawerId) openDrawer(rs[i]!.id);
      };
      const ids = () => (sel.size ? [...sel] : curRow ? [curRow.id] : []);
      if (Date.now() - sChord.current < 1200) {
        const map: Record<string, string> = {
          p: "positive",
          n: "negative",
          u: "neutral",
          m: "mixed",
        };
        if (map[e.key] && canEdit) {
          e.preventDefault();
          sChord.current = 0;
          used(`s ${e.key}`);
          doSentiment(ids(), map[e.key]!);
          return;
        }
        sChord.current = 0;
      }
      switch (e.key) {
        case "j":
          if (rs.length) {
            e.preventDefault();
            used("j");
            move(cur === null ? 0 : cur + 1);
          }
          break;
        case "k":
          if (rs.length) {
            e.preventDefault();
            used("k");
            move(cur === null ? 0 : cur - 1);
          }
          break;
        case "Enter":
        case "o":
          if (
            e.key === "Enter" &&
            (e.target as HTMLElement).closest("button, a, input, select, summary")
          )
            break;
          if (curRow) {
            e.preventDefault();
            used(e.key);
            openDrawer(curRow.id);
          }
          break;
        case "x":
          if (curRow) {
            e.preventDefault();
            used("x");
            toggleSelect(curRow.id, false);
          }
          break;
        case "t":
          if (canEdit && ids().length) {
            e.preventDefault();
            used("t");
            setTagTarget(ids());
          }
          break;
        case "s":
          if (canEdit) {
            e.preventDefault();
            sChord.current = Date.now();
          }
          break;
        case "f":
          if (canEdit && ids().length) {
            e.preventDefault();
            used("f");
            doFlag(ids());
          }
          break;
        case "e":
          e.preventDefault();
          used("e");
          exportRows([...sel]);
          break;
        case "N":
          if (kb.current.newCount > 0) {
            e.preventDefault();
            used("N");
            loadNew();
          }
          break;
        case "/":
          e.preventDefault();
          used("/");
          searchRef.current?.focus();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, closeDrawer, doFlag, doSentiment, exportRows, loadNew, openDrawer, toggleSelect]);

  // ---- filter plumbing -------------------------------------------------------------------
  const applyDraft = (d: FilterDraft) => {
    const next: FeedFilters = { ...filters, ...d, page: 1 };
    const events: { filter_type: string; filter_value_count: number }[] = [];
    for (const k of ["source", "sentiment", "lang", "country", "type", "tag"] as const)
      if (d[k].join() !== filters[k].join() && d[k].length)
        events.push({ filter_type: k, filter_value_count: d[k].length });
    if (d.author !== filters.author && d.author)
      events.push({ filter_type: "author", filter_value_count: 1 });
    if (d.followers !== filters.followers && d.followers)
      events.push({ filter_type: "followers", filter_value_count: 1 });
    if (d.media !== filters.media && d.media)
      events.push({ filter_type: "media", filter_value_count: 1 });
    if (d.flagged !== filters.flagged && d.flagged)
      events.push({ filter_type: "flagged", filter_value_count: 1 });
    if (d.spam !== filters.spam) events.push({ filter_type: "spam", filter_value_count: 1 });
    setFiltersOpen(false);
    go(next, events);
  };

  const lockedRange = (r: string) => {
    const need = RANGE_DAYS[r as keyof typeof RANGE_DAYS];
    const t =
      (["starter", "growth", "agency", "enterprise"] as PlanTier[]).find(
        (p) => PLANS[p].historyDays >= need,
      ) ?? "enterprise";
    const p = PLANS[t];
    setPaywall({
      trigger: "history_window",
      title: "Longer history is on a higher plan",
      planLabel: p.label,
      reason: `Your ${PLANS[tier].label} plan includes ${historyDays} days of history. ${p.label} includes ${p.historyDays >= 365 ? `${Math.round(p.historyDays / 365)} year(s)` : `${p.historyDays} days`}.`,
      priceLine: p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined,
      bullets: [
        `${p.historyDays >= 365 ? Math.round(p.historyDays / 365) + " year(s)" : p.historyDays + " days"} of mention history`,
        `${p.activeQueries} active queries`,
        `${p.mentionsPerMonth.toLocaleString()} mentions per month`,
      ],
      onClose: () => setPaywall(null),
    });
  };

  const drawerRow = drawerId ? byId.get(drawerId) : undefined;
  const pages = Math.max(1, Math.ceil(feed.total / filters.size));
  const first = feed.total === 0 ? 0 : (filters.page - 1) * filters.size + 1;
  const last = Math.min(feed.total, filters.page * filters.size);
  const hasFilters =
    filters.q ||
    filters.search ||
    filters.source.length ||
    filters.sentiment.length ||
    filters.lang.length ||
    filters.country.length ||
    filters.tag.length ||
    filters.type.length ||
    filters.author ||
    filters.followers ||
    filters.media ||
    filters.flagged ||
    filters.since;
  const commonRow = {
    terms: feed.terms,
    canEdit,
    now,
    onSelect: toggleSelect,
    onOpen: openDrawer,
    onSentiment: (id: number, s: string | null) => doSentiment([id], s),
    onFlag: (id: number) => doFlag([id]),
    onTag: (id: number) => setTagTarget([id]),
    onCopyLink: copyLink,
  };

  return (
    <div
      className="mx-auto flex max-w-[1600px] flex-col gap-3"
      aria-busy={pending}
      data-testid="mentions-feed"
      data-loaded-at={feed.loadedAt}
      data-hydrated={hydrated}
    >
      {paywall && <PaywallModal {...paywall} />}
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[30px] font-semibold leading-[38px]">Mentions</h1>
        <p
          className="text-sm text-[var(--text-muted)]"
          data-testid="result-count"
          aria-live="polite"
        >
          {pending
            ? "Updating…"
            : `${feed.total.toLocaleString()}${feed.capped ? "+" : ""} mention${feed.total === 1 ? "" : "s"}`}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => exportRows([])}
            data-testid="export-view"
          >
            Export CSV
          </Button>
        </div>
      </header>
      {!canEdit && (
        <p role="status" className="rounded-md border border-[var(--info)] p-2 text-sm">
          You have view-only access: you can read and export mentions but not tag, flag or change
          sentiment.
        </p>
      )}

      <div className="sticky top-[-24px] z-20 -mx-6 bg-[var(--bg)] px-6 pb-2 pt-2">
        <FilterBar
          ref={searchRef}
          filters={filters}
          view={view}
          queries={feed.queries}
          historyDays={historyDays}
          searchError={feed.searchError}
          savedViews={savedViews}
          canEdit={canEdit}
          onSearch={(s) =>
            go(
              { ...filters, search: s || undefined, page: 1 },
              s ? [{ filter_type: "search", filter_value_count: 1 }] : [],
            )
          }
          onQuery={(id) =>
            go(
              { ...filters, q: id, page: 1 },
              id ? [{ filter_type: "query", filter_value_count: 1 }] : [],
            )
          }
          onRange={(r, from, to) =>
            go({ ...filters, range: r, from, to, page: 1 }, [
              { filter_type: "date_range", filter_value_count: 1 },
            ])
          }
          onRangeLocked={lockedRange}
          onView={(v) => {
            setView(v);
            replaceParam("view", v === "card" ? null : v);
          }}
          onSort={(s) => go({ ...filters, sort: s, page: 1 })}
          onOpenFilters={() => setFiltersOpen(true)}
          onRemoveChip={(c: Chip) => go(removeChip(filters, c))}
          onClearAll={() => go(clearedFilters(filters))}
          onSaveView={() => setSaveOpen(true)}
          onOpenView={(params) => startNav(() => router.push(`${pathname}?${params}`))}
          onDeleteView={(id) => void deleteView(ws, id).then(() => router.refresh())}
        />
        {selected.size > 0 && (
          <div
            role="region"
            aria-label="Bulk actions"
            className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--primary)] bg-[var(--surface)] p-2"
            data-testid="bulk-bar"
          >
            <span className="px-2 text-sm font-medium" data-testid="selected-count">
              {selected.size} selected
            </span>
            {canEdit && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setTagTarget([...selected])}
                  data-testid="bulk-tag"
                >
                  Tag
                </Button>
                <Menu
                  label="Sentiment"
                  testId="bulk-sentiment"
                  items={sentimentItems((s) => doSentiment([...selected], s), "", true)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => doFlag([...selected], true)}
                  data-testid="bulk-flag"
                >
                  Flag
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => doFlag([...selected], false)}
                  data-testid="bulk-unflag"
                >
                  Unflag
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => exportRows([...selected])}
              data-testid="bulk-export"
            >
              Export selection
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
              data-testid="bulk-clear"
            >
              Clear selection
            </Button>
          </div>
        )}
      </div>

      {newCount > 0 && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-md border border-[var(--info)] p-2 text-sm"
          data-testid="new-mentions"
        >
          <span>
            {newCount} new mention{newCount === 1 ? "" : "s"} — press{" "}
            <kbd className="rounded border border-[var(--border)] px-1">N</kbd> to load
          </span>
          <Button size="sm" variant="secondary" onClick={loadNew} data-testid="load-new">
            Load
          </Button>
        </div>
      )}
      {feed.hiddenSpam > 0 && filters.spam === "hide" && (
        <p className="text-sm text-[var(--text-muted)]" data-testid="spam-notice">
          {feed.hiddenSpam.toLocaleString()}
          {feed.hiddenSpam >= 100_000 ? "+" : ""} likely-spam mention
          {feed.hiddenSpam === 1 ? "" : "s"} hidden —{" "}
          <button
            type="button"
            className="underline"
            onClick={() => go({ ...filters, spam: "show", page: 1 })}
            data-testid="show-spam"
          >
            Show
          </button>
        </p>
      )}

      {feed.queries.length === 0 ? (
        <section
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center"
          data-testid="feed-no-queries"
        >
          <h2 className="text-xl font-semibold">No queries yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[var(--text-muted)]">
            Mentions appear here once you have a query. Create your first one — we&apos;ll pre-fill
            it with your brand.
          </p>
          <Link
            href={`/w/${ws}/queries/new?entry=mentions`}
            className="mt-4 inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
          >
            Create a query
          </Link>
        </section>
      ) : rows.length === 0 ? (
        feed.collecting && !hasFilters ? (
          <section
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center"
            role="status"
            data-testid="feed-collecting"
          >
            <h2 className="text-xl font-semibold">Collecting your first mentions…</h2>
            <p className="mt-2 text-[var(--text-muted)]">
              Your query is gathering history now. This usually takes under a minute.
            </p>
            <Button className="mt-4" variant="secondary" onClick={() => router.refresh()}>
              Refresh
            </Button>
          </section>
        ) : (
          <section
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center"
            data-testid="feed-empty"
          >
            <h2 className="text-xl font-semibold">No mentions match these filters</h2>
            <p className="mt-2 text-[var(--text-muted)]">
              Try a wider date range, fewer filters, or broader search terms.
            </p>
            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => go(clearedFilters(filters))}
              data-testid="empty-clear"
            >
              Clear filters
            </Button>
          </section>
        )
      ) : (
        <>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.size === rows.length && rows.length > 0}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                }
                data-testid="select-all"
              />{" "}
              Select all on this page
            </label>
            <span className="text-[var(--text-muted)]">
              Showing {first.toLocaleString()}–{last.toLocaleString()}
            </span>
          </div>
          {view === "table" ? (
            <MentionTable
              rows={rows}
              selected={selected}
              activeId={cursor !== null ? (rows[cursor]?.id ?? null) : null}
              sort={filters.sort}
              onSort={(s) => go({ ...filters, sort: s, page: 1 })}
              onSelect={toggleSelect}
              onOpen={openDrawer}
              now={now}
            />
          ) : (
            <ul
              className={
                view === "card"
                  ? "flex flex-col gap-3"
                  : "overflow-hidden rounded-lg border border-[var(--border)]"
              }
              aria-label="Mentions"
              data-testid="mention-list"
            >
              {rows.map((r, i) => {
                const props = {
                  ...commonRow,
                  row: r,
                  selected: selected.has(r.id),
                  active: cursor === i,
                };
                const setRef = (el: HTMLLIElement | null) => {
                  if (el) rowEls.current.set(r.id, el);
                  else rowEls.current.delete(r.id);
                };
                return view === "card" ? (
                  <MentionCard key={r.id} ref={setRef} {...props} />
                ) : (
                  <MentionListRow key={r.id} ref={setRef} {...props} />
                );
              })}
            </ul>
          )}
          <nav
            aria-label="Pagination"
            className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
            data-testid="pagination"
          >
            <span className="text-[var(--text-muted)]">
              Page {filters.page} of {pages.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={filters.page <= 1 || pending}
                onClick={() => go({ ...filters, page: filters.page - 1 })}
                data-testid="prev-page"
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={filters.page >= pages || pending}
                onClick={() => go({ ...filters, page: filters.page + 1 })}
                data-testid="next-page"
              >
                Next
              </Button>
              <label className="flex items-center gap-2">
                Per page
                <select
                  value={filters.size}
                  onChange={(e) =>
                    go({ ...filters, size: Number(e.target.value) as FeedFilters["size"], page: 1 })
                  }
                  data-testid="page-size"
                  className="min-h-8 rounded border border-[var(--border)] bg-[var(--surface)] px-2"
                >
                  {PAGE_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </nav>
        </>
      )}

      {drawerRow && (
        <MentionDrawer
          row={drawerRow}
          detail={detail}
          terms={feed.terms}
          canEdit={canEdit}
          onClose={closeDrawer}
          onSentiment={(s) => doSentiment([drawerRow.id], s)}
          onFlag={() => doFlag([drawerRow.id])}
          onTag={() => setTagTarget([drawerRow.id])}
          onRemoveTag={(t) => doRemoveTag(drawerRow.id, t)}
          onCopyLink={() => void copyLink(drawerRow.id)}
        />
      )}
      <FilterPanel
        open={filtersOpen}
        filters={filters}
        tags={tags}
        onApply={applyDraft}
        onClose={() => setFiltersOpen(false)}
      />
      <TagDialog
        open={tagTarget !== null}
        count={tagTarget?.length ?? 0}
        suggestions={tags}
        onClose={() => setTagTarget(null)}
        onSubmit={(t) => {
          const ids = tagTarget ?? [];
          setTagTarget(null);
          doTag(ids, t);
        }}
      />
      <SaveViewDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSave={async (name) => {
          setSaveOpen(false);
          const r = await saveView(ws, name, toSearchParams(filters).toString());
          if (r.ok) {
            toast.success(`Saved view “${name}”.`);
            router.refresh();
          } else toast.error(r.error);
        }}
      />
    </div>
  );
}
