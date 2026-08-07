"use client";

// Admin Center — Organization tab: sites + divisions from GET /api/org/tree,
// with add/edit dialogs (POST/PATCH /api/sites and /api/divisions).
// ONLINE-ONLY mutations.

import { useState, type FormEvent } from "react";
import { useApp } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { apiErrorMessage, useOrgTree } from "@/lib/orgData";
import { cn, divisionMeta } from "@/lib/utils";
import type { OrgDivision, OrgSite } from "@/lib/types";
import { Dialog, DialogActions, Field, FormError, OfflineHint, TextInput } from "@/components/Dialog";
import EmptyState from "@/components/EmptyState";
import { SectionHeader } from "@/components/Headings";
import { SkeletonList } from "@/components/Skeleton";
import { PlusIcon } from "@/components/Icons";

type DialogState =
  | { kind: "add-division" }
  | { kind: "edit-division"; unit: OrgDivision }
  | { kind: "add-site" }
  | { kind: "edit-site"; unit: OrgSite }
  | null;

export default function OrgTab() {
  const { online } = useApp();
  const { push: toast } = useToast();
  const { tree, loading, reload } = useOrgTree();

  const [dialog, setDialog] = useState<DialogState>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const open = (next: Exclude<DialogState, null>) => {
    setError(null);
    setSubmitting(false);
    if (next.kind === "edit-division" || next.kind === "edit-site") {
      setCode(next.unit.id);
      setName(next.unit.name);
    } else {
      setCode("");
      setName("");
    }
    setDialog(next);
  };

  // Server contract: POST needs {code (a-z0-9-_ slug), name}; PATCH /:code takes {name}.
  const CODE_RE = /^[a-z0-9][a-z0-9_-]*$/;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !dialog) return;
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    const isAdd = dialog.kind === "add-division" || dialog.kind === "add-site";
    if (isAdd && !CODE_RE.test(code.trim())) {
      setError("Code is required: short lowercase slug (letters, digits, -, _).");
      return;
    }
    setSubmitting(true);
    setError(null);
    const base = dialog.kind.endsWith("division") ? "/api/divisions" : "/api/sites";
    const label = dialog.kind.endsWith("division") ? "Division" : "Site";
    try {
      if (isAdd) {
        await api(base, { method: "POST", body: { code: code.trim(), name: name.trim() } });
        toast(`${label} added.`, "success");
      } else {
        await api(`${base}/${dialog.unit.id}`, { method: "PATCH", body: { name: name.trim() } });
        toast(`${label} updated.`, "success");
      }
      setDialog(null);
      await reload();
    } catch (err) {
      setError(apiErrorMessage(err, "Cannot reach the server — change not saved."));
      setSubmitting(false);
    }
  };

  const addBtn =
    "flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40";
  const editBtn =
    "min-h-[36px] rounded-lg border border-slate-300 px-2.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300";

  const dialogTitle =
    dialog?.kind === "add-division"
      ? "Add division"
      : dialog?.kind === "edit-division"
        ? "Edit division"
        : dialog?.kind === "add-site"
          ? "Add site"
          : "Edit site";

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section>
        <div className="flex items-center justify-between">
          <SectionHeader className="!mb-0">Divisions</SectionHeader>
          <button type="button" disabled={!online} onClick={() => open({ kind: "add-division" })} className={addBtn}>
            <PlusIcon className="h-4 w-4" />
            Add division
          </button>
        </div>
        <div className="mt-3">
          {loading && tree.divisions.length === 0 ? (
            <SkeletonList count={3} />
          ) : tree.divisions.length === 0 ? (
            <EmptyState size="sm">
              No org tree loaded yet{online ? " — the server has not delivered one." : " — needs a live connection."}
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {tree.divisions.map((d) => {
                const meta = divisionMeta(d.id);
                return (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", meta.accent)} />
                      <span className="truncate font-medium">{d.name}</span>
                      <span className="font-mono text-xs text-slate-400">{d.id}</span>
                      {(d.sites?.length ?? 0) > 0 && (
                        <span className="text-xs text-slate-400">· {d.sites!.length} sites</span>
                      )}
                    </span>
                    <button type="button" disabled={!online} onClick={() => open({ kind: "edit-division", unit: d })} className={editBtn}>
                      Edit
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <SectionHeader className="!mb-0">Sites</SectionHeader>
          <button type="button" disabled={!online} onClick={() => open({ kind: "add-site" })} className={addBtn}>
            <PlusIcon className="h-4 w-4" />
            Add site
          </button>
        </div>
        <div className="mt-3">
          {loading && tree.sites.length === 0 ? (
            <SkeletonList count={3} />
          ) : tree.sites.length === 0 ? (
            <EmptyState size="sm">
              No sites yet{online ? "." : " — needs a live connection."}
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {tree.sites.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="truncate font-medium">{s.name}</span>
                    {s.divisionId && (
                      <span className="text-xs text-slate-400">{divisionMeta(s.divisionId).label}</span>
                    )}
                  </span>
                  <button type="button" disabled={!online} onClick={() => open({ kind: "edit-site", unit: s })} className={editBtn}>
                    Edit
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <OfflineHint show={!online} what="Organization management" />

      {dialog && (
        <Dialog title={dialogTitle} onClose={() => setDialog(null)}>
          <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
            {(dialog.kind === "add-division" || dialog.kind === "add-site") && (
              <Field
                label="Code"
                htmlFor="org-code"
                hint="Short lowercase identifier, e.g. ops or dakar-hub. Immutable once in use."
              >
                <TextInput
                  id="org-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toLowerCase())}
                  placeholder={dialog.kind === "add-division" ? "e.g. ops" : "e.g. dakar-hub"}
                  autoFocus
                  required
                />
              </Field>
            )}
            <Field label="Name" htmlFor="org-name">
              <TextInput
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus={dialog.kind.startsWith("edit")}
                required
              />
            </Field>
            <FormError error={error} />
            <DialogActions
              submitLabel={dialog.kind.startsWith("add") ? "Add" : "Save changes"}
              submitting={submitting}
              disabled={!online || !name.trim()}
              onCancel={() => setDialog(null)}
            />
            <OfflineHint show={!online} what="This change" />
          </form>
        </Dialog>
      )}
    </div>
  );
}
