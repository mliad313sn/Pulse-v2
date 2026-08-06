"use client";

// Read-only audit trail peek — fetched live (audit rows are server-side immutable ledger).

import { useState } from "react";
import { api } from "@/lib/api";
import { useApp } from "@/lib/store";
import { fmtDateTime } from "@/lib/utils";
import type { AuditRow } from "@/lib/types";
import { ChevronDownIcon } from "./Icons";
import { Skeleton } from "./Skeleton";

export default function AuditPeek({ entityId }: { entityId: string }) {
  const { online, users } = useApp();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && rows === null && online) {
      setLoading(true);
      setFailed(false);
      try {
        const data = await api<AuditRow[] | { rows: AuditRow[] }>(`/api/audit?entityId=${entityId}`);
        setRows(Array.isArray(data) ? data : (data.rows ?? []));
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex min-h-[48px] w-full items-center justify-between px-5 text-left font-semibold"
      >
        Audit trail
        <ChevronDownIcon className={open ? "h-4 w-4 rotate-180 transition" : "h-4 w-4 transition"} />
      </button>
      {open && (
        <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-700">
          {!online && rows === null && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Audit trail needs a connection — it is served from the immutable server ledger.
            </p>
          )}
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}
          {failed && <p className="text-sm text-slate-500 dark:text-slate-400">Could not load the audit trail.</p>}
          {rows && rows.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">No audit entries yet.</p>
          )}
          {rows && rows.length > 0 && (
            <ol className="space-y-2 text-sm">
              {rows.slice(0, 20).map((row, i) => {
                const actor = users.find((u) => u.id === row.actorId);
                const when = (row.at || row.createdAt) as string | undefined;
                return (
                  <li key={row.id ?? i} className="flex flex-wrap justify-between gap-2">
                    <span className="text-slate-700 dark:text-slate-200">
                      {String(row.action ?? row.entity ?? "change")}
                      {actor ? ` · ${actor.name}` : ""}
                    </span>
                    <span className="text-xs text-slate-400">{fmtDateTime(when)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
