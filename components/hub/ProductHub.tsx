"use client";

import { ArrowRight, MessageSquare, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { track } from "@/lib/analytics/client";
import { PRODUCTS, PRODUCT_COOKIE, type ProductKey } from "@/lib/products";

const ICON = { listening: MessageSquare, influencers: Users } as const;
const POINTS: Record<ProductKey, string[]> = {
  listening: ["Mentions, alerts and crisis rooms", "Dashboards, reports and Ask AI"],
  influencers: [
    "Creator discovery with audience and authenticity checks",
    "Shortlists you can export",
  ],
};

/**
 * The post-login screen: the window splits in two, one half per product. Both halves are ordinary links, so it
 * works with the keyboard, without scripting, and on a phone (where the halves stack).
 */
export function ProductHub({
  workspaces,
  last,
}: {
  workspaces: { slug: string; name: string }[];
  last: ProductKey | null;
}) {
  const [slug, setSlug] = useState(workspaces[0]!.slug);
  useEffect(() => {
    track("Product Hub Viewed", {
      products_available: PRODUCTS.length,
      last_product: last ?? "none",
    });
  }, [last]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="product-hub">
      {workspaces.length > 1 && (
        <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
          <label htmlFor="hub-ws" className="text-sm font-medium">
            Workspace
          </label>
          <select
            id="hub-ws"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
            data-testid="hub-workspace"
          >
            {workspaces.map((w) => (
              <option key={w.slug} value={w.slug}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <ul className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
        {PRODUCTS.map((p, i) => {
          const Icon = ICON[p.key];
          return (
            <li key={p.key} className="flex">
              <Link
                href={`/w/${slug}/${p.landing}`}
                data-testid={`hub-${p.key}`}
                onClick={() => {
                  try {
                    document.cookie = `${PRODUCT_COOKIE}=${p.key}; path=/; max-age=31536000; samesite=lax`;
                  } catch {
                    /* ignore */
                  }
                  track("Product Opened", { target_product: p.key, source: "hub" });
                }}
                className={`group flex flex-1 flex-col justify-center gap-4 p-8 transition-colors hover:bg-[var(--surface-2)] md:p-16 ${i === 0 ? "bg-[var(--bg)] md:border-r md:border-[var(--border)]" : "bg-[var(--surface)]"} max-md:border-b max-md:border-[var(--border)]`}
              >
                <Icon size={40} strokeWidth={1.5} aria-hidden className="text-[var(--primary)]" />
                <span className="flex items-center gap-3">
                  <span className="text-[30px] font-semibold leading-[38px]">{p.label}</span>
                  {last === p.key && (
                    <span
                      className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-muted)]"
                      data-testid="hub-last"
                    >
                      Last used
                    </span>
                  )}
                </span>
                <span className="max-w-md text-[var(--text-muted)]">{p.blurb}</span>
                <ul className="max-w-md list-disc pl-5 text-sm text-[var(--text-muted)]">
                  {POINTS[p.key].map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                <span className="mt-2 inline-flex items-center gap-2 font-medium text-[var(--primary)]">
                  {p.cta}{" "}
                  <ArrowRight
                    size={18}
                    aria-hidden
                    className="transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
                  />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
