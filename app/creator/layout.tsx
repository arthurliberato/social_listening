import { ThemeToggle } from "@/components/shell/ThemeToggle";

export const metadata = { robots: { index: false, follow: false } };

/** The creator's side: no account, no navigation, just the page they were sent. */
export default function CreatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-[var(--primary)] focus:px-3 focus:py-2 focus:text-[var(--primary-contrast)]"
      >
        Skip to main content
      </a>
      <header
        role="banner"
        className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4"
      >
        <span className="font-semibold">Ripplewise</span>
        <ThemeToggle />
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-2xl p-6">
        {children}
      </main>
    </div>
  );
}
