"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics/client";
import { PRODUCTS, PRODUCT_COOKIE, productOfPath } from "@/lib/products";

/** Switch between products without going back to the hub. The current product is marked for assistive tech. */
export function ProductSwitcher({ slug }: { slug: string }) {
  const current = productOfPath(usePathname());
  return (
    <nav aria-label="Products" data-testid="product-switcher" className="flex items-center gap-1">
      {PRODUCTS.map((p) => (
        <Link
          key={p.key}
          href={`/w/${slug}/${p.landing}`}
          aria-current={p.key === current ? "page" : undefined}
          data-testid={`switch-${p.key}`}
          onClick={() => {
            try {
              document.cookie = `${PRODUCT_COOKIE}=${p.key}; path=/; max-age=31536000; samesite=lax`;
            } catch {
              /* ignore */
            }
            if (p.key !== current) track("Product Opened", { product: p.key, source: "switcher" });
          }}
          className={`inline-flex min-h-8 items-center rounded-md px-3 text-sm ${p.key === current ? "bg-[var(--surface-2)] font-medium text-[var(--text)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"}`}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
