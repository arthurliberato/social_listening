"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";
import { getSharedWidgetData } from "@/app/share/[token]/actions";
import { DateRangePicker } from "@/components/listening/feed/DateRangePicker";
import type { DraftWidget } from "./DashboardGrid";
import { DashboardGrid, type GridHandlers } from "./DashboardGrid";

const noop: GridHandlers = {
  onLayout: () => {},
  onEdit: () => {},
  onDuplicate: () => {},
  onRemove: () => {},
  onUpgrade: () => {},
};

/** Read-only dashboard for people without an account. Same widgets, same numbers, no editing. */
export function SharedDashboard({
  token,
  widgets,
  range,
  historyDays,
}: {
  token: string;
  widgets: DraftWidget[];
  range: { range: string; from?: string; to?: string };
  historyDays: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const rangeQs = useMemo(() => {
    const p = new URLSearchParams();
    if (range.range !== "30d") p.set("range", range.range);
    if (range.from) p.set("from", range.from);
    if (range.to) p.set("to", range.to);
    return p.toString();
  }, [range]);
  const fetchWidget = useCallback(
    (w: DraftWidget, qs: string) => getSharedWidgetData(token, w.id, qs),
    [token],
  );
  return (
    <>
      <div className="mb-4 flex justify-end">
        <DateRangePicker
          value={range}
          historyDays={historyDays}
          onLocked={() => {}}
          onChange={(r, from, to) => {
            const p = new URLSearchParams();
            if (r !== "30d") p.set("range", r);
            if (r === "custom" && from) {
              p.set("from", from);
              if (to) p.set("to", to);
            }
            router.push(`${pathname}${p.toString() ? `?${p}` : ""}`);
          }}
        />
      </div>
      <DashboardGrid
        ws=""
        widgets={widgets}
        editing={false}
        selectedId={null}
        rangeQs={rangeQs}
        fetchWidget={fetchWidget}
        handlers={noop}
        readOnly
      />
    </>
  );
}
