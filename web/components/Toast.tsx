"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ToastKind = "info" | "success" | "warning" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (message: string, kind?: ToastKind) => void;
}

const ToastCtx = createContext<ToastContextValue>({ push: () => undefined });

export function useToast(): ToastContextValue {
  return useContext(ToastCtx);
}

const KIND_STYLES: Record<ToastKind, string> = {
  info: "border-slate-300 dark:border-slate-600",
  success: "border-emerald-400 dark:border-emerald-600",
  warning: "border-amber-400 dark:border-amber-600",
  error: "border-rose-400 dark:border-rose-600",
};

const KIND_DOT: Record<ToastKind, string> = {
  info: "bg-slate-400",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-rose-500",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-2xl border-l-4 bg-white px-4 py-3 text-sm shadow-lg dark:bg-slate-800 dark:text-slate-100",
              KIND_STYLES[t.kind],
            )}
          >
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", KIND_DOT[t.kind])} />
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              className="-m-1 rounded-lg p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
