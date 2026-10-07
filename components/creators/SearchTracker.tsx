"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/client";

/** Fires "Creator Search Run" once for each distinct search the person runs (new filters, sort or page). */
export function SearchTracker({
  resultCount,
  filterCount,
  sort,
  hasQuery,
  page,
}: {
  resultCount: number;
  filterCount: number;
  sort: string;
  hasQuery: boolean;
  page: number;
}) {
  useEffect(() => {
    track("Creator Search Run", {
      result_count: resultCount,
      filter_count: filterCount,
      sort,
      has_query: hasQuery,
      page,
    });
  }, [resultCount, filterCount, sort, hasQuery, page]);
  return null;
}
