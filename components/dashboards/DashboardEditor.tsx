"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteDashboard,
  duplicateDashboard,
  getWidgetData,
  recordDashboardView,
  saveDashboard,
} from "@/app/w/[ws]/dashboards/actions";
import { DateRangePicker } from "@/components/listening/feed/DateRangePicker";
import { PaywallModal, type PaywallProps } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { track } from "@/lib/analytics/client";
import {
  SIZES,
  WIDGETS,
  widgetAllowed,
  type WidgetConfig,
  type WidgetType,
} from "@/lib/dashboards/catalog";
import { firstFree, type Box } from "@/lib/dashboards/layout";
import { PLANS, planUnlocking, type Entitlements } from "@/lib/entitlements/plans";
import {
  DashboardGrid,
  type DraftWidget,
  type GridHandlers,
  type MoveMethod,
} from "./DashboardGrid";
import { ShareDialog } from "./ShareDialog";
import { WidgetConfigDialog } from "./WidgetConfigDialog";
import { WidgetPicker } from "./WidgetPicker";

let tmp = 0;
const newId = () => `tmp-${Date.now().toString(36)}-${tmp++}`;
const snapshot = (name: string, description: string, ws: DraftWidget[]) =>
  JSON.stringify([
    name,
    description,
    ws.map(({ id, type, title, config, x, y, w, h }) => ({ id, type, title, config, x, y, w, h })),
  ]);

export function DashboardEditor({
  ws,
  id,
  initial,
  canEdit,
  isCreator,
  features,
  historyDays,
  planLabel,
  queries,
  range,
  startEditing,
  publicToken,
}: {
  ws: string;
  id: string;
  initial: { name: string; description: string; widgets: DraftWidget[] };
  canEdit: boolean;
  isCreator: boolean;
  features: Entitlements["features"];
  historyDays: number;
  planLabel: string;
  queries: { id: string; name: string }[];
  range: { range: string; from?: string; to?: string };
  startEditing: boolean;
  publicToken: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [widgets, setWidgets] = useState(initial.widgets);
  const [saved, setSaved] = useState(() =>
    snapshot(initial.name, initial.description, initial.widgets),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [paywall, setPaywall] = useState<PaywallProps | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = useMemo(
    () => snapshot(name, description, widgets) !== saved,
    [name, description, widgets, saved],
  );
  const rangeQs = useMemo(() => {
    const p = new URLSearchParams();
    if (range.range !== "30d") p.set("range", range.range);
    if (range.from) p.set("from", range.from);
    if (range.to) p.set("to", range.to);
    return p.toString();
  }, [range]);

  useEffect(() => {
    track("Dashboard Viewed", {
      dashboard_type: "custom",
      viewer_is_creator: isCreator,
      widgets_count: initial.widgets.length,
    });
    void recordDashboardView(ws, id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dirty || !editing) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, editing]);

  const boxes = useCallback(
    (): Box[] => widgets.map(({ id: i, x, y, w, h }) => ({ id: i, x, y, w, h })),
    [widgets],
  );

  const upgradeFor = useCallback(
    (type: WidgetType, trigger: string) => {
      const def = WIDGETS[type];
      const p = PLANS[planUnlocking(def.requires!)];
      setPaywall({
        trigger,
        title: `${def.label} is on the ${p.label} plan`,
        reason: `${def.description} Your ${planLabel} plan doesn't include it.`,
        planLabel: p.label,
        priceLine: p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined,
        bullets: [
          `${def.label} and the other ${p.label} widgets`,
          `${p.activeQueries} active queries`,
          `${p.mentionsPerMonth.toLocaleString()} mentions per month`,
        ],
        onClose: () => setPaywall(null),
      });
    },
    [planLabel],
  );

  const handlers: GridHandlers = {
    onLayout: (next, method: MoveMethod, moved) => {
      const by = new Map(next.map((b) => [b.id, b]));
      setWidgets((ws_) => ws_.map((w) => ({ ...w, ...by.get(w.id)! })));
      setSelected(moved);
      const w = widgets.find((x) => x.id === moved);
      if (w) track("Widget Moved", { widget_type: w.type, move_method: method });
    },
    onEdit: (wid) => setConfigId(wid),
    onDuplicate: (wid) => {
      const src = widgets.find((w) => w.id === wid);
      if (!src) return;
      const pos = firstFree(boxes(), src.w, src.h);
      const copy = { ...src, id: newId(), title: `${src.title} (copy)`.slice(0, 80), ...pos };
      setWidgets((ws_) => [...ws_, copy]);
      setSelected(copy.id);
      track("Widget Added", { widget_type: src.type, is_gated: false });
    },
    onRemove: (wid) => {
      const gone = widgets.find((w) => w.id === wid);
      if (!gone) return;
      setWidgets((ws_) => ws_.filter((w) => w.id !== wid));
      toast.success(`Removed “${gone.title}”.`, {
        label: "Undo",
        onClick: () => setWidgets((ws_) => [...ws_, gone]),
      });
    },
    onUpgrade: (w) => upgradeFor(w.type, "gated_widget"),
  };

  const addWidget = (type: WidgetType) => {
    const def = WIDGETS[type];
    const size = SIZES[def.size];
    const pos = firstFree(boxes(), size.w, size.h);
    const w: DraftWidget = {
      id: newId(),
      type,
      title: def.label,
      config: type === "kpi" ? { metric: "mentions" } : {},
      ...pos,
      w: size.w,
      h: size.h,
    };
    setWidgets((ws_) => [...ws_, w]);
    setSelected(w.id);
    setPickerOpen(false);
    track("Widget Added", { widget_type: type, is_gated: false });
    toast.success(`Added ${def.label}.`);
  };

  const applyConfig = (wid: string, patch: { title: string; config: WidgetConfig }) => {
    const w = widgets.find((x) => x.id === wid);
    setWidgets((ws_) => ws_.map((x) => (x.id === wid ? { ...x, ...patch } : x)));
    setConfigId(null);
    if (w) track("Widget Configured", { widget_type: w.type, chart_type: patch.config.style });
  };

  const leaveEdit = () => {
    setEditing(false);
    setConfirmDiscard(false);
    router.replace(pathname + (rangeQs ? `?${rangeQs}` : ""));
  };

  const save = useCallback(async () => {
    if (saving || !editing) return;
    setSaving(true);
    setSaveError("");
    const res = await saveDashboard(ws, id, {
      name,
      description,
      widgets: widgets.map(({ id: wid, type, title, config, x, y, w, h }) => ({
        id: wid.startsWith("tmp-") ? undefined : wid,
        type,
        title,
        config,
        x,
        y,
        w,
        h,
      })),
    });
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.error);
      if (res.upgradeTo) {
        const t = widgets.find((w) => !widgetAllowed(w.type, features))?.type;
        if (t) upgradeFor(t, "gated_widget");
      }
      return;
    }
    const next = widgets.map((w, i) => ({ ...w, ...res.widgets[i]! }));
    setWidgets(next);
    setSaved(snapshot(name, description, next));
    toast.success("Dashboard saved.");
    leaveEdit();
  }, [saving, editing, ws, id, name, description, widgets, features]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && editing) {
        e.preventDefault();
        track("Keyboard Shortcut Used", { shortcut: "mod+s", context: "dashboard" });
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [editing]);

  const setRange = (r: string, from?: string, to?: string) => {
    const p = new URLSearchParams();
    if (r !== "30d") p.set("range", r);
    if (r === "custom" && from) {
      p.set("from", from);
      if (to) p.set("to", to);
    }
    if (editing) p.set("edit", "1");
    router.push(`${pathname}${p.toString() ? `?${p}` : ""}`);
  };

  const fetchWidget = useCallback(
    (w: DraftWidget, qs: string) => getWidgetData(ws, w.type, w.config, qs),
    [ws],
  );
  const configWidget = widgets.find((w) => w.id === configId) ?? null;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      {paywall && <PaywallModal {...paywall} />}
      <header className="flex flex-col gap-2">
        <Link
          href={`/w/${ws}/dashboards`}
          className="text-sm text-[var(--text-muted)] underline-offset-2 hover:underline"
        >
          ← Dashboards
        </Link>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-64 flex-1">
            {editing ? (
              <>
                <input
                  aria-label="Dashboard name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  data-testid="dash-name"
                  className="min-h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-[24px] font-semibold leading-8"
                />
                <input
                  aria-label="Description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={300}
                  placeholder="Add a short description"
                  data-testid="dash-description"
                  className="mt-1 min-h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                />
              </>
            ) : (
              <>
                <h1 className="text-[30px] font-semibold leading-[38px]" data-testid="dash-title">
                  {name}
                </h1>
                {description && (
                  <p className="max-w-[72ch] text-[var(--text-muted)]">{description}</p>
                )}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              value={range}
              historyDays={historyDays}
              onChange={setRange}
              onLocked={(r) => {
                const need = r === "12m" ? 365 : 90;
                const t =
                  (["starter", "growth", "agency", "enterprise"] as const).find(
                    (p) => PLANS[p].historyDays >= need,
                  ) ?? "enterprise";
                setPaywall({
                  trigger: "history_window",
                  title: "Longer history is on a higher plan",
                  reason: `Your ${planLabel} plan includes ${historyDays} days of history.`,
                  planLabel: PLANS[t].label,
                  bullets: [
                    `${PLANS[t].historyDays} days of history`,
                    `${PLANS[t].activeQueries} active queries`,
                  ],
                  onClose: () => setPaywall(null),
                });
              }}
            />
            {!editing && canEdit && (
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(true);
                  router.replace(
                    `${pathname}?${new URLSearchParams([...new URLSearchParams(rangeQs), ["edit", "1"]])}`,
                  );
                }}
                data-testid="edit-dashboard"
              >
                Edit
              </Button>
            )}
            {!editing && (
              <Button
                variant="secondary"
                onClick={() => setShareOpen(true)}
                data-testid="share-dashboard"
              >
                Share
              </Button>
            )}
            {editing && (
              <Button
                variant="secondary"
                onClick={() => setPickerOpen(true)}
                data-testid="add-widget"
              >
                Add widget
              </Button>
            )}
            {editing && (
              <Button onClick={save} loading={saving} data-testid="save-dashboard">
                Save{" "}
                <kbd className="ml-1 rounded border border-current px-1 text-xs opacity-80">⌘S</kbd>
              </Button>
            )}
            {editing && (
              <Button
                variant="secondary"
                onClick={() => (dirty ? setConfirmDiscard(true) : leaveEdit())}
                data-testid="cancel-edit"
              >
                Cancel
              </Button>
            )}
            {!editing && canEdit && (
              <Menu
                label="More"
                testId="dash-more"
                align="right"
                items={[
                  {
                    key: "dup",
                    label: "Duplicate dashboard",
                    testId: "dash-duplicate",
                    onSelect: async () => {
                      const r = await duplicateDashboard(ws, id);
                      if (r.ok) router.push(`/w/${ws}/dashboards/${r.id}`);
                      else toast.error(r.error);
                    },
                  },
                  {
                    key: "del",
                    label: "Delete dashboard",
                    testId: "dash-delete",
                    onSelect: () => setConfirmDelete(true),
                  },
                ]}
              />
            )}
          </div>
        </div>
        {editing && (
          <p className="text-sm text-[var(--text-muted)]" data-testid="edit-hint">
            Drag a widget by its handle, or focus the handle and use the arrow keys, or use the ⋯
            menu to move and resize.{dirty ? " You have unsaved changes." : ""}
          </p>
        )}
        {saveError && (
          <p role="alert" className="text-sm text-[var(--danger)]" data-testid="save-dash-error">
            {saveError}
          </p>
        )}
        {confirmDiscard && (
          <div
            role="alertdialog"
            aria-labelledby="dc-h"
            className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--warning)] p-3 text-sm"
            data-testid="discard-confirm"
          >
            <p id="dc-h" className="font-medium">
              Discard your changes?
            </p>
            <Button size="sm" variant="secondary" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setName(initial.name);
                setDescription(initial.description);
                setWidgets(JSON.parse(saved)[2] as DraftWidget[]);
                leaveEdit();
              }}
              data-testid="discard"
            >
              Discard
            </Button>
          </div>
        )}
        {confirmDelete && (
          <div
            role="alertdialog"
            aria-labelledby="dd-h"
            className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--danger)] p-3 text-sm"
          >
            <p id="dd-h" className="font-medium">
              Delete “{name}”? This can&apos;t be undone.
            </p>
            <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              data-testid="confirm-delete-dash"
              onClick={async () => {
                const r = await deleteDashboard(ws, id);
                if (r.ok) router.push(`/w/${ws}/dashboards`);
                else toast.error(r.error ?? "Couldn't delete.");
              }}
            >
              Delete
            </Button>
          </div>
        )}
      </header>

      {widgets.length === 0 ? (
        <section
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-10 text-center"
          data-testid="dash-empty"
        >
          <h2 className="text-xl font-semibold">This dashboard is empty</h2>
          <p className="mt-2 text-[var(--text-muted)]">
            {canEdit ? "Add a widget to start building it." : "Nothing has been added yet."}
          </p>
          {canEdit && (
            <Button
              className="mt-4"
              onClick={() => {
                setEditing(true);
                setPickerOpen(true);
              }}
              data-testid="empty-add"
            >
              Add your first widget
            </Button>
          )}
        </section>
      ) : (
        <DashboardGrid
          ws={ws}
          widgets={widgets}
          editing={editing}
          selectedId={selected}
          rangeQs={rangeQs}
          fetchWidget={fetchWidget}
          handlers={handlers}
        />
      )}

      <WidgetPicker
        open={pickerOpen}
        features={features}
        onAdd={addWidget}
        onClose={() => setPickerOpen(false)}
        onLocked={(t) => {
          setPickerOpen(false);
          upgradeFor(t, "gated_widget");
        }}
      />
      <WidgetConfigDialog
        widget={configWidget}
        queries={queries}
        features={features}
        onApply={applyConfig}
        onClose={() => setConfigId(null)}
      />
      <ShareDialog
        open={shareOpen}
        ws={ws}
        id={id}
        token={publicToken}
        canPublic={features.publicShareLinks}
        canEdit={canEdit}
        onClose={() => setShareOpen(false)}
        onUpgrade={() => {
          setShareOpen(false);
          const p = PLANS[planUnlocking("publicShareLinks")];
          setPaywall({
            trigger: "public_share",
            title: "Public links are on the " + p.label + " plan",
            reason: `Your ${planLabel} plan shares dashboards with teammates only.`,
            planLabel: p.label,
            priceLine: p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined,
            bullets: [
              "Public read-only dashboard links",
              `${p.activeQueries} active queries`,
              `${p.seats} seats`,
            ],
            onClose: () => setPaywall(null),
          });
        }}
      />
    </div>
  );
}
