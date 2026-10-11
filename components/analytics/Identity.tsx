"use client";

import { useEffect } from "react";
import { setClientWorkspace } from "@/lib/analytics/client";

/**
 * Mount inside authenticated layouts so browser events say which workspace they happened in. (The server introduces the
 * user, account and workspace to RudderStack itself; see lib/analytics/server.ts.)
 */
export function Identity(props: {
  userId: string;
  accountId: string | null;
  workspaceId: string | null;
}) {
  useEffect(() => {
    setClientWorkspace(props.workspaceId);
  }, [props.workspaceId]);
  return null;
}
