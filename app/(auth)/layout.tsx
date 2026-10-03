export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <main id="main" className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <aside
        aria-label="About Ripplewise"
        className="hidden flex-col justify-center gap-6 bg-[var(--surface-2)] p-12 md:flex"
      >
        <p className="text-2xl font-semibold leading-8">
          Hear the conversation before it becomes the headline.
        </p>
        <ul className="flex max-w-md flex-col gap-3 text-[var(--text-muted)]">
          <li>Boolean-grade queries with a guided builder and live preview.</li>
          <li>Spikes explained: see what drove the peak, not just that it happened.</li>
          <li>Reports and alerts that reach the people who decide.</li>
        </ul>
        <p className="text-xs text-[var(--text-muted)]">
          Trusted by the (fictional) teams at Northwind Co-op, Harbor &amp; Pine and Lumenfield.
        </p>
      </aside>
    </div>
  );
}
