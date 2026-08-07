"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { baseRoleLabel, cn, divisionMeta, initials, safeLocalSet } from "@/lib/utils";
import {
  AlertIcon,
  CloudIcon,
  CloudOffIcon,
  CogIcon,
  EyeIcon,
  KeyIcon,
  LogoutIcon,
  MergeIcon,
  MoonIcon,
  ShieldIcon,
  SunIcon,
  SyncIcon,
} from "./Icons";

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
  const { online, syncing, outboxCount, blocked } = useApp();
  if (!online) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-slate-200 px-3 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
        <CloudOffIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Offline</span>
        {outboxCount + blocked.length > 0 && <span>· {outboxCount + blocked.length} queued</span>}
      </span>
    );
  }
  if (blocked.length > 0) {
    return (
      <Link
        href="/conflicts"
        title="A queued change was refused by the server — review the sync queue."
        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-rose-100 px-3 text-xs font-medium text-rose-700 transition hover:bg-rose-200 dark:bg-rose-900/50 dark:text-rose-300 dark:hover:bg-rose-900/70"
      >
        <AlertIcon className="h-3.5 w-3.5" />
        Sync blocked{outboxCount > 0 ? ` · ${outboxCount} waiting` : ""}
      </Link>
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

function UserMenu() {
  const { user, logout, openChangePassword } = useApp();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const div = divisionMeta(user?.division);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  if (!user) return null;

  const itemClass =
    "flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/60";

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${user.name} — ${div.label}`}
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

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="border-b border-slate-100 px-3 pb-2.5 pt-1.5 dark:border-slate-700">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            {user.email && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
            )}
            <p className="mt-0.5 text-xs text-slate-400">{baseRoleLabel(user.baseRole)}</p>
          </div>
          <div className="mt-1.5 space-y-0.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                openChangePassword();
              }}
              className={itemClass}
            >
              <KeyIcon className="h-4 w-4 text-slate-400" />
              Change password
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void logout();
              }}
              className={itemClass}
            >
              <LogoutIcon className="h-4 w-4 text-slate-400" />
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const { user, blocked, outboxCount, canDecide, canWrite } = useApp();

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
              <Link
                href="/my-work"
                className="rounded-xl px-3 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
              >
                My Work
              </Link>
              <Link
                href="/portfolio"
                className="rounded-xl px-3 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
              >
                Portfolio
              </Link>
              <Link
                href="/sites"
                className="rounded-xl px-3 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
              >
                Sites
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
              {user.baseRole === "ADMIN" && (
                <Link
                  href="/admin"
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                >
                  <CogIcon className="h-4 w-4" />
                  Admin
                </Link>
              )}
              {blocked.length > 0 && (
                <Link
                  href="/conflicts"
                  className="flex items-center gap-1.5 rounded-xl bg-rose-100 px-3 py-2 font-medium text-rose-800 transition hover:bg-rose-200 dark:bg-rose-900/50 dark:text-rose-300"
                >
                  <MergeIcon className="h-4 w-4" />
                  Sync queue
                </Link>
              )}
            </nav>
          )}

          <div className="ml-auto flex items-center gap-2">
            {user && !canWrite && (
              <span
                title="Viewer account — you can browse everything but not make changes."
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-500 dark:bg-slate-700/60 dark:text-slate-300"
              >
                <EyeIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Read-only</span>
              </span>
            )}
            <ConnectivityPill />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      {user && blocked.length > 0 && (
        <Link
          href="/conflicts"
          className="block border-b border-rose-300/60 bg-rose-50 px-4 py-2 text-center text-sm font-medium text-rose-900 dark:border-rose-700/60 dark:bg-rose-900/30 dark:text-rose-200"
        >
          Sync blocked — action needed. The server refused a queued change
          {outboxCount > 0
            ? `; ${outboxCount} more ${outboxCount > 1 ? "changes are" : "change is"} waiting behind it.`
            : "."}{" "}
          Tap to review.
        </Link>
      )}
    </>
  );
}
