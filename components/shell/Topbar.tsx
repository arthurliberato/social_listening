import { Bell, HelpCircle } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";

const iconButton =
  "inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-[var(--surface-2)]";

export function Topbar({ ws, userName }: { ws: string; userName: string }) {
  return (
    <header
      role="banner"
      className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4"
    >
      <span className="font-semibold">Ripplewise</span>
      <span className="text-[var(--text-muted)]" data-testid="workspace-name">
        {ws}
      </span>
      <div className="ml-auto flex items-center gap-1">
        {/* Help stays in the same spot on every screen (WCAG 3.2.6). */}
        <button type="button" aria-label="Help" data-testid="help" className={iconButton}>
          <HelpCircle size={16} aria-hidden />
        </button>
        <button type="button" aria-label="Notifications" className={iconButton}>
          <Bell size={16} aria-hidden />
        </button>
        <ThemeToggle />
        <UserMenu name={userName} />
      </div>
    </header>
  );
}
