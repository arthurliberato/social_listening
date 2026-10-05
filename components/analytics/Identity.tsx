"use client";

import { useEffect } from "react";
import { identify, setClientWorkspace } from "@/lib/analytics/client";

/** Mount inside authenticated layouts so Amplitude gets the user id and account/workspace groups. */
export function Identity(props: {
  userId: string;
  accountId: string | null;
  workspaceId: string | null;
}) {
  useEffect(() => {
    setClientWorkspace(props.workspaceId);
    identify(props);
  }, [props.userId, props.accountId, props.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
