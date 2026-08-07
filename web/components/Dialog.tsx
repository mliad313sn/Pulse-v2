"use client";

// Generic centered modal dialog — same backdrop/card language as RoadblockSheet.
// Used by the Admin Center and the New Project / Members dialogs.

import {
  useEffect,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn, INPUT_CLASS } from "@/lib/utils";
import { XIcon } from "./Icons";

export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          "sheet-enter relative max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl dark:bg-slate-800 sm:rounded-2xl",
          wide ? "max-w-2xl" : "max-w-lg",
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle != null && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Labelled field wrapper for dialog forms. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint != null && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input {...rest} className={cn(INPUT_CLASS, className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={cn(
        "w-full resize-none rounded-xl border border-slate-300 bg-white p-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-indigo-900",
        className,
      )}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = props;
  return (
    <select {...rest} className={cn(INPUT_CLASS, "appearance-none pr-8", className)}>
      {children}
    </select>
  );
}

/** Error line for dialog forms. */
export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
      {error}
    </p>
  );
}

/** Primary/secondary footer buttons for dialog forms. */
export function DialogActions({
  submitLabel,
  submitting,
  disabled,
  onCancel,
  danger = false,
}: {
  submitLabel: string;
  submitting?: boolean;
  disabled?: boolean;
  onCancel: () => void;
  danger?: boolean;
}) {
  return (
    <div className="mt-5 flex gap-2">
      <button
        type="submit"
        disabled={disabled || submitting}
        className={cn(
          "flex min-h-[44px] flex-1 items-center justify-center rounded-xl text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50",
          danger ? "bg-rose-600 hover:bg-rose-500" : "bg-indigo-600 hover:bg-indigo-500",
        )}
      >
        {submitting ? "Saving…" : submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/60"
      >
        Cancel
      </button>
    </div>
  );
}

/** Inline "needs a live connection" hint for online-only features. */
export function OfflineHint({ show, what = "This action" }: { show: boolean; what?: string }) {
  if (!show) return null;
  return (
    <p className="mt-2 text-xs text-slate-400">{what} needs a live connection — you are offline.</p>
  );
}
