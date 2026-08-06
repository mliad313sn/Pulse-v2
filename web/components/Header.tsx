"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { canDecideApprovals, cn, divisionMeta, initials, safeLocalSet } from "@/lib/utils";
import { CloudIcon, CloudOffIcon, MergeIcon, MoonIcon, ShieldIcon, SunIcon, SyncIcon } from "./Icons";

const THEME_KEY = "opspm360:theme";

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    safeLocalSet(THEME_KEY, next ? "dark" : "light");
    setDark(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-200"
    >
      {dark === null ? <span className="h-4 w-4" /> : dark ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
    </button>
  );
}

function ConnectivityPill() {
  const { online, syncing, outboxCount } = useApp();
  if (!online) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-slate-200 px-3 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
        <CloudOffIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Offline</span>
        {outboxCount > 0 && <span>· {outboxCount} queued</span>}
      </span>
    );
  }
  if (syncing || outboxCount > 0) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-amber-100 px-3 text-xs font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
        <SyncIcon className="h-3.5 w-3.5 animate-[spin_1.6s_linear_infinite]" />
        Syncing{outboxCount > 0 ? ` ${outboxCount}` : ""}…
      </span>
    );
  }
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-100 px-3 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
      <CloudIcon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Online · synced</span>
      <span className="sm:hidden">Synced</span>
    </span>
  );
}

export default function Header() {
  const { user, logout, conflicts } = useApp();
  const div = divisionMeta(user?.division);
  const canDecide = canDecideApprovals(user);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">
              O3
            </span>
            <span className="hidden text-lg sm:inline">OpsPM360</span>
          </Link>

          {user && (
            <nav className="ml-2 hidden items-center gap-1 text-sm md:flex">
              <Link
                href="/"
                className="rounded-xl px-3 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
              >
                Dashboard
              </Link>
              {(canDecide || user.division === "infosec" || user.division === "management") && (
                <Link
                  href="/approvals"
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                >
                  <ShieldIcon className="h-4 w-4" />
                  Approvals
                </Link>
              )}
              {conflicts.length > 0 && (
                <Link
                  href="/conflicts"
                  className="flex items-center gap-1.5 rounded-xl bg-amber-100 px-3 py-2 font-medium text-amber-800 transition hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-300"
                >
                  <MergeIcon className="h-4 w-4" />
                  Merge ({conflicts.length})
                </Link>
              )}
            </nav>
          )}

          <div className="ml-auto flex items-center gap-2">
            <ConnectivityPill />
            <ThemeToggle />
            {user && (
              <button
                type="button"
                onClick={logout}
                title={`${user.name} — ${div.label}. Click to switch user.`}
                className="flex h-11 items-center gap-2 rounded-xl px-2 transition hover:bg-slate-100 dark:hover:bg-slate-700/60"
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white",
                    div.accent,
                  )}
                >
                  {initials(user.name)}
                </span>
                <span className="hidden text-left lg:block">
                  <span className="block text-sm font-medium leading-tight">{user.name}</span>
                  <span className="block text-xs leading-tight text-slate-500 dark:text-slate-400">
                    {div.label}
                    {user.site ? ` · ${user.site}` : ""}
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>
      </header>

      {user && conflicts.length > 0 && (
        <Link
          href="/conflicts"
          className="block border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200"
        >
          Merge needed — {conflicts.length} change{conflicts.length > 1 ? "s" : ""} conflict with newer server
          versions. Tap to review.
        </Link>
      )}
    </>
  );
}
