"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/client";

export function TrackHomeView() {
  useEffect(() => {
    track("Dashboard Viewed", { dashboard_type: "home", viewer_is_creator: true });
  }, []);
  return null;
}
