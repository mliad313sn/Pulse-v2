"use client";

// Real login screen (email + password) against POST /api/auth/login.
// Session cookie is set HttpOnly by the server — nothing is stored client-side.

import { useState, type FormEvent } from "react";
import { useApp } from "@/lib/store";
import { ApiError } from "@/lib/api";
import { CloudOffIcon, EyeIcon, EyeOffIcon } from "./Icons";

// Dev-only seed accounts (non-production seed; password pattern Dev!<Firstname>2026).
const SEED_ACCOUNTS: Array<{ email: string; hint: string }> = [
  { email: "awa.ndiaye@opspm360.local", hint: "Dev!Awa2026" },
  { email: "moussa.diallo@opspm360.local", hint: "Dev!Moussa2026" },
  { email: "hamady.soumare@opspm360.local", hint: "Dev!Hamady2026" },
  { email: "troy@opspm360.local", hint: "Dev!Troy2026" },
  { email: "fatou.sarr@opspm360.local", hint: "Dev!Fatou2026" },
  { email: "ibrahima.ba@opspm360.local", hint: "Dev!Ibrahima2026" },
  { email: "aminata.fall@opspm360.local", hint: "Dev!Aminata2026" },
];

function loginErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 423) {
      const retry = (e.detail as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
      const minutes = typeof retry === "number" && retry > 0 ? Math.max(1, Math.ceil(retry / 60)) : null;
      return minutes
        ? `Account temporarily locked after too many failed attempts — try again in ${minutes} minute${minutes > 1 ? "s" : ""}.`
        : "Account temporarily locked after too many failed attempts — try again shortly.";
    }
    if (e.status === 403 && e.code === "ACCOUNT_DISABLED") {
      return "This account has been disabled. Contact your administrator.";
    }
    if (e.status === 429) {
      return "Too many login attempts — please wait a moment and try again.";
    }
    if (e.status === 401) {
      // Generic on purpose — never reveal whether the email exists.
      return "Incorrect email or password.";
    }
    return e.message || "Sign-in failed — please try again.";
  }
  return "Cannot reach the server — check your connection and try again.";
}

export default function LoginScreen() {
  const { login, online } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(loginErrorMessage(err));
      setSubmitting(false);
    }
  };

  const inputClass =
    "h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-[15px] outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-indigo-900";

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-xl font-bold text-white">
          O3
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
          Enterprise PPM — your dashboard adapts to your role and division.
        </p>
      </div>

      {!online && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <CloudOffIcon className="h-4 w-4 shrink-0" />
          You are offline — signing in requires a connection.
        </div>
      )}

      <form
        onSubmit={(e) => void submit(e)}
        noValidate
        className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              aria-invalid={Boolean(error) || undefined}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium">
              Password
            </label>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                aria-invalid={Boolean(error) || undefined}
                className={`${inputClass} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showPassword ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
              </button>
            </div>
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
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>

      <details className="mt-6 rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm dark:border-slate-600">
        <summary className="cursor-pointer select-none font-medium text-slate-500 dark:text-slate-400">
          Development credentials
        </summary>
        <div className="mt-3 space-y-1.5 text-slate-500 dark:text-slate-400">
          <p className="text-xs">
            Local seed accounts (dev only). Password pattern: <code className="font-mono">Dev!&lt;Firstname&gt;2026</code>
          </p>
          <ul className="space-y-1 font-mono text-xs">
            {SEED_ACCOUNTS.map((a) => (
              <li key={a.email} className="flex flex-wrap justify-between gap-x-3">
                <button
                  type="button"
                  onClick={() => setEmail(a.email)}
                  className="text-left text-indigo-600 hover:underline dark:text-indigo-400"
                  title="Fill email field"
                >
                  {a.email}
                </button>
                <span>{a.hint}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
