"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ToastItem {
  id: number;
  message: string;
  kind: "success" | "error";
  action?: { label: string; onClick: () => void };
}
interface ToastApi {
  success: (message: string, action?: ToastItem["action"]) => void;
  error: (message: string, action?: ToastItem["action"]) => void;
}

const Ctx = createContext<ToastApi | null>(null);
export const useToast = (): ToastApi => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
};

/**
 * Toasts sit bottom-left so they never cover the top bar or focused controls (WCAG 2.4.11).
 * Success toasts dismiss after 5s; errors persist until dismissed. The region is a polite live region.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: ToastItem["kind"], message: string, action?: ToastItem["action"]) => {
      const id = next.current++;
      setItems((xs) => [...xs.slice(-3), { id, kind, message, action }]);
      if (kind === "success") setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({ success: (m, a) => push("success", m, a), error: (m, a) => push("error", m, a) }),
    [push],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-4 z-50 flex max-w-sm flex-col gap-2"
        data-testid="toasts"
      >
        {items.map((t) => (
          <div
            key={t.id}
            data-testid="toast"
            data-kind={t.kind}
            className={`pointer-events-auto flex items-center gap-3 rounded-lg border bg-[var(--surface)] px-4 py-3 text-sm shadow-lg ${t.kind === "error" ? "border-[var(--danger)]" : "border-[var(--border)]"}`}
          >
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="min-h-8 rounded px-2 font-medium text-[var(--primary)] underline"
                data-testid="toast-action"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss notification"
              className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-[var(--surface-2)]"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
