"use client";

import { cn } from "@/lib/utils";
import { AlertIcon } from "./Icons";

type Variant = "solid" | "outline";
type Size = "sm" | "lg";

// SC3 touch targets: the Ops Zen solid button stays min-h-[56px]; everything else min-h-[44px].
const BUTTON_STYLES: Record<`${Variant}-${Size}`, { button: string; icon: string }> = {
  "solid-lg": {
    button:
      "flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl bg-rose-600 text-base font-semibold text-white shadow-lg shadow-rose-600/20 transition hover:bg-rose-500 disabled:opacity-50",
    icon: "h-5 w-5",
  },
  "solid-sm": {
    button:
      "flex min-h-[44px] items-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-500",
    icon: "h-4 w-4",
  },
  "outline-sm": {
    button:
      "flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50",
    icon: "h-4 w-4",
  },
  "outline-lg": {
    button:
      "flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl border border-rose-300 bg-rose-50 text-base font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50",
    icon: "h-5 w-5",
  },
};

/** The one "Log Roadblock" button — replaces the four hand-rolled copies. */
export default function LogRoadblockButton({
  onClick,
  variant = "outline",
  size = "sm",
  disabled,
  className,
}: {
  onClick: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  className?: string;
}) {
  const styles = BUTTON_STYLES[`${variant}-${size}`];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(styles.button, className)}
    >
      <AlertIcon className={styles.icon} />
      Log Roadblock
    </button>
  );
}
