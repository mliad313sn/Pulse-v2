"use client";

// Full-screen change-password view.
// - Forced mode (mustChangePassword / any PASSWORD_CHANGE_REQUIRED response):
//   blocks the whole app until the password is changed.
// - Voluntary mode (user menu): same screen with a Cancel affordance.

import { useState, type FormEvent } from "react";
import { useApp } from "@/lib/store";
import { ApiError } from "@/lib/api";
import { EyeIcon, EyeOffIcon, KeyIcon } from "./Icons";

const MIN_LENGTH = 10;

export default function ChangePasswordScreen() {
  const { user, mustChangePassword, changePassword, closeChangePassword, logout } = useApp();
  const forced = mustChangePassword;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showNext, setShowNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!current || !next || !confirm) {
      setError("Fill in all three fields.");
      return;
    }
    if (next.length < MIN_LENGTH) {
      setError(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (next === current) {
      setError("New password must be different from the current one.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await changePassword(current, next);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Password change rejected — check your current password and policy requirements."
          : "Cannot reach the server — check your connection and try again.",
      );
      setSubmitting(false);
    }
  };

  const inputClass =
    "h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-[15px] outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-indigo-900";

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-white">
          <KeyIcon className="h-7 w-7" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {forced ? "Set a new password" : "Change password"}
        </h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
          {forced
            ? `${user?.name ? `${user.name}, y` : "Y"}our password must be changed before you can continue.`
            : "Choose a new password for your account."}
        </p>
      </div>

      <form
        onSubmit={(e) => void submit(e)}
        noValidate
        className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="pw-current" className="mb-1.5 block text-sm font-medium">
              Current password
            </label>
            <input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="pw-new" className="mb-1.5 block text-sm font-medium">
              New password
            </label>
            <div className="relative">
              <input
                id="pw-new"
                type={showNext ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={MIN_LENGTH}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                aria-describedby="pw-new-hint"
                className={`${inputClass} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowNext((v) => !v)}
                aria-label={showNext ? "Hide new password" : "Show new password"}
                aria-pressed={showNext}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showNext ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
              </button>
            </div>
            <p id="pw-new-hint" className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              At least {MIN_LENGTH} characters.
            </p>
          </div>

          <div>
            <label htmlFor="pw-confirm" className="mb-1.5 block text-sm font-medium">
              Confirm new password
            </label>
            <input
              id="pw-confirm"
              type={showNext ? "text" : "password"}
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Updating…" : "Update password"}
          </button>

          {forced ? (
            <button
              type="button"
              onClick={() => void logout()}
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/60"
            >
              Sign out instead
            </button>
          ) : (
            <button
              type="button"
              onClick={closeChangePassword}
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/60"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
