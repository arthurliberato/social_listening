"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics/client";

export function AuthorViewed({ authorType }: { authorType: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    track("Author Profile Viewed", { author_type: authorType });
  }, [authorType]);
  return null;
}

export function TopicLink({
  href,
  growthPct,
  children,
}: {
  href: string;
  growthPct: number | null;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={() => track("Topic Opened", { topic_growth_pct: growthPct ?? 0 })}
      className="text-[var(--primary)] underline underline-offset-2"
      data-testid="topic-link"
    >
      {children}
    </Link>
  );
}
