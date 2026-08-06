"use client";

import { useApp } from "@/lib/store";
import { cn, divisionMeta, initials } from "@/lib/utils";
import { SkeletonCard } from "./Skeleton";
import { CloudOffIcon } from "./Icons";
import type { User } from "@/lib/types";

export default function PersonaPicker() {
  const { users, usersLoading, online, login, loadUsers } = useApp();

  const grouped = users.reduce<Record<string, User[]>>((acc, u) => {
    (acc[u.division] = acc[u.division] || []).push(u);
    return acc;
  }, {});
  const divisions = Object.keys(grouped).sort();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-10 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-xl font-bold text-white">
          O3
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Who is working?</h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
          Pick your profile — your dashboard adapts to your division and site.
        </p>
      </div>

      {usersLoading && users.length === 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {!usersLoading && users.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-600">
          <CloudOffIcon className="mx-auto mb-3 h-8 w-8 text-slate-400" />
          <p className="font-medium">
            {online ? "The API server is not reachable yet." : "You are offline and no user directory is cached."}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {online
              ? "Start the OpsPM360 server on port 4000, then retry."
              : "Reconnect once to load the demo users, after that everything works offline."}
          </p>
          <button
            type="button"
            onClick={() => void loadUsers()}
            className="mt-5 h-11 rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            Retry
          </button>
        </div>
      )}

      <div className="space-y-8">
        {divisions.map((division) => {
          const meta = divisionMeta(division);
          return (
            <section key={division}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <span className={cn("h-2 w-2 rounded-full", meta.accent)} />
                {meta.label}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {grouped[division].map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => void login(u)}
                    className="flex min-h-[64px] items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-indigo-500"
                  >
                    <span
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white",
                        meta.accent,
                      )}
                    >
                      {initials(u.name)}
                    </span>
                    <span>
                      <span className="block font-medium">{u.name}</span>
                      <span className="block text-sm text-slate-500 dark:text-slate-400">
                        {u.role.replace(/_/g, " ")}
                        {u.site ? ` · ${u.site}` : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
