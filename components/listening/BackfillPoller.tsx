"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While any query is still collecting history, refresh the list every few seconds. */
export function BackfillPoller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
