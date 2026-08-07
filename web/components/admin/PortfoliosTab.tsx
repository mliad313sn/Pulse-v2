"use client";

// Admin Center — Portfolios tab: strategic pillars, portfolios and programs
// with simple create/edit forms (GET/POST/PATCH /api/pillars|portfolios|programs).
// ONLINE-ONLY mutations.

import { useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { apiErrorMessage, usePillars, usePortfolios, usePrograms } from "@/lib/orgData";
import { fmtDate } from "@/lib/utils";
import type { Portfolio, Program, StrategicPillar } from "@/lib/types";
import { Dialog, DialogActions, Field, FormError, OfflineHint, Select, TextArea, TextInput } from "@/components/Dialog";
import EmptyState from "@/components/EmptyState";
import { SectionHeader } from "@/components/Headings";
import { Pill } from "@/components/Badges";
import { SkeletonList } from "@/components/Skeleton";
import { PlusIcon } from "@/components/Icons";

type Kind = "pillar" | "portfolio" | "program";

interface FormState {
  title: string;
  description: string;
  pillarId: string;
  portfolioId: string;
  ownerId: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY: FormState = {
  title: "",
  description: "",
  pillarId: "",
  portfolioId: "",
  ownerId: "",
  dateFrom: "",
  dateTo: "",
};

type DialogState = { kind: Kind; editingId: string | null } | null;

const KIND_LABEL: Record<Kind, string> = {
  pillar: "strategic pillar",
  portfolio: "portfolio",
  program: "program",
};

export default function PortfoliosTab() {
  const { users, online } = useApp();
  const { push: toast } = useToast();
  const pillars = usePillars();
  const portfolios = usePortfolios();
  const programs = usePrograms();

  const [dialog, setDialog] = useState<DialogState>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const openAdd = (kind: Kind) => {
    setForm(EMPTY);
    setError(null);
    setDialog({ kind, editingId: null });
  };

  const openEdit = (kind: Kind, entity: StrategicPillar | Portfolio | Program) => {
    if (kind === "pillar") {
      const p = entity as StrategicPillar;
      setForm({ ...EMPTY, title: p.name, description: p.description ?? "" });
    } else if (kind === "portfolio") {
      const p = entity as Portfolio;
      setForm({
        ...EMPTY,
        title: p.title,
        description: p.description ?? "",
        pillarId: p.pillarId ?? "",
        ownerId: p.ownerId ?? "",
        dateFrom: (p.dateFrom ?? "").slice(0, 10),
        dateTo: (p.dateTo ?? "").slice(0, 10),
      });
    } else {
      const p = entity as Program;
      setForm({
        ...EMPTY,
        title: p.title,
        description: p.objective ?? "",
        portfolioId: p.portfolioId,
        ownerId: p.ownerId ?? "",
      });
    }
    setError(null);
    setDialog({ kind, editingId: entity.id });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !dialog) return;
    if (!form.title.trim()) {
      setError(dialog.kind === "pillar" ? "Name is required." : "Title is required.");
      return;
    }
    if (dialog.kind === "program" && !form.portfolioId) {
      setError("A program must belong to a portfolio.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const body: Record<string, unknown> =
      dialog.kind === "pillar"
        ? { name: form.title.trim(), description: form.description.trim() || undefined }
        : dialog.kind === "portfolio"
          ? {
              title: form.title.trim(),
              description: form.description.trim() || undefined,
              pillarId: form.pillarId || undefined,
              ownerId: form.ownerId || undefined,
              dateFrom: form.dateFrom || undefined,
              dateTo: form.dateTo || undefined,
            }
          : {
              title: form.title.trim(),
              objective: form.description.trim() || undefined,
              portfolioId: form.portfolioId,
              ownerId: form.ownerId || undefined,
            };
    const base = dialog.kind === "pillar" ? "/api/pillars" : dialog.kind === "portfolio" ? "/api/portfolios" : "/api/programs";
    try {
      if (dialog.editingId) {
        await api(`${base}/${dialog.editingId}`, { method: "PATCH", body });
      } else {
        await api(base, { method: "POST", body });
      }
      toast(
        `${KIND_LABEL[dialog.kind][0]!.toUpperCase()}${KIND_LABEL[dialog.kind].slice(1)} ${dialog.editingId ? "updated" : "created"}.`,
        "success",
      );
      setDialog(null);
      setSubmitting(false);
      await (dialog.kind === "pillar" ? pillars : dialog.kind === "portfolio" ? portfolios : programs).reload();
    } catch (err) {
      setError(apiErrorMessage(err, "Cannot reach the server — change not saved."));
      setSubmitting(false);
    }
  };

  const userName = (id: string | null | undefined) => users.find((u) => u.id === id)?.name;

  const addBtn =
    "flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40";
  const editBtn =
    "min-h-[36px] shrink-0 rounded-lg border border-slate-300 px-2.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300";
  const card =
    "flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800";

  const sectionFor = <T extends { id: string }>(
    kind: Kind,
    header: string,
    list: { items: T[]; loading: boolean },
    renderRow: (item: T) => ReactNode,
    emptyText: string,
  ) => (
    <section>
      <div className="flex items-center justify-between">
        <SectionHeader className="!mb-0">{header}</SectionHeader>
        <button type="button" disabled={!online} onClick={() => openAdd(kind)} className={addBtn}>
          <PlusIcon className="h-4 w-4" />
          Add
        </button>
      </div>
      <div className="mt-3">
        {list.loading && list.items.length === 0 ? (
          <SkeletonList count={2} />
        ) : list.items.length === 0 ? (
          <EmptyState size="sm">{emptyText}</EmptyState>
        ) : (
          <ul className="space-y-2">{list.items.map((item) => renderRow(item))}</ul>
        )}
      </div>
    </section>
  );

  return (
    <div className="space-y-8">
      {sectionFor(
        "pillar",
        "Strategic pillars",
        pillars,
        (p: StrategicPillar) => (
          <li key={p.id} className={card}>
            <div className="min-w-0">
              <p className="font-medium">{p.name}</p>
              {p.description && (
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{p.description}</p>
              )}
            </div>
            <button type="button" disabled={!online} onClick={() => openEdit("pillar", p)} className={editBtn}>
              Edit
            </button>
          </li>
        ),
        online ? "No strategic pillars defined yet." : "No pillars cached — loading needs a live connection.",
      )}

      {sectionFor(
        "portfolio",
        "Portfolios",
        portfolios,
        (p: Portfolio) => {
          const pillar = pillars.items.find((x) => x.id === p.pillarId);
          const owner = userName(p.ownerId);
          return (
            <li key={p.id} className={card}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {p.title}
                  {pillar && (
                    <Pill className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
                      {pillar.name}
                    </Pill>
                  )}
                </p>
                {p.description && (
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{p.description}</p>
                )}
                <p className="mt-0.5 text-xs text-slate-400">
                  {owner ? `Owner: ${owner}` : "No owner"}
                  {(p.dateFrom || p.dateTo) && ` · ${fmtDate(p.dateFrom)} → ${fmtDate(p.dateTo)}`}
                </p>
              </div>
              <button type="button" disabled={!online} onClick={() => openEdit("portfolio", p)} className={editBtn}>
                Edit
              </button>
            </li>
          );
        },
        online ? "No portfolios yet — add the first one." : "No portfolios cached — loading needs a live connection.",
      )}

      {sectionFor(
        "program",
        "Programs",
        programs,
        (p: Program) => {
          const portfolio = portfolios.items.find((x) => x.id === p.portfolioId);
          const owner = userName(p.ownerId);
          return (
            <li key={p.id} className={card}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {p.title}
                  <Pill className="bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300">
                    {portfolio?.title ?? "Unknown portfolio"}
                  </Pill>
                </p>
                {p.objective && (
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{p.objective}</p>
                )}
                {owner && <p className="mt-0.5 text-xs text-slate-400">Owner: {owner}</p>}
              </div>
              <button type="button" disabled={!online} onClick={() => openEdit("program", p)} className={editBtn}>
                Edit
              </button>
            </li>
          );
        },
        online ? "No programs yet." : "No programs cached — loading needs a live connection.",
      )}

      <OfflineHint show={!online} what="Portfolio management" />

      {dialog && (
        <Dialog
          title={`${dialog.editingId ? "Edit" : "Add"} ${KIND_LABEL[dialog.kind]}`}
          onClose={() => setDialog(null)}
        >
          <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
            <Field label={dialog.kind === "pillar" ? "Name" : "Title"} htmlFor="pf-title">
              <TextInput
                id="pf-title"
                value={form.title}
                onChange={(e) => set({ title: e.target.value })}
                autoFocus
                required
              />
            </Field>
            <Field label={dialog.kind === "program" ? "Objective" : "Description"} htmlFor="pf-desc">
              <TextArea
                id="pf-desc"
                rows={2}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="Optional"
              />
            </Field>
            {dialog.kind === "portfolio" && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Strategic pillar" htmlFor="pf-pillar">
                    <Select id="pf-pillar" value={form.pillarId} onChange={(e) => set({ pillarId: e.target.value })}>
                      <option value="">None</option>
                      {pillars.items.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Owner" htmlFor="pf-owner">
                    <Select id="pf-owner" value={form.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
                      <option value="">No owner</option>
                      {[...users]
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                    </Select>
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="From" htmlFor="pf-from">
                    <TextInput
                      id="pf-from"
                      type="date"
                      value={form.dateFrom}
                      onChange={(e) => set({ dateFrom: e.target.value })}
                    />
                  </Field>
                  <Field label="To" htmlFor="pf-to">
                    <TextInput
                      id="pf-to"
                      type="date"
                      value={form.dateTo}
                      onChange={(e) => set({ dateTo: e.target.value })}
                    />
                  </Field>
                </div>
              </>
            )}
            {dialog.kind === "program" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Portfolio" htmlFor="pf-portfolio">
                  <Select
                    id="pf-portfolio"
                    value={form.portfolioId}
                    onChange={(e) => set({ portfolioId: e.target.value })}
                    required
                  >
                    <option value="">Select portfolio…</option>
                    {portfolios.items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Owner" htmlFor="pf-powner">
                  <Select id="pf-powner" value={form.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
                    <option value="">No owner</option>
                    {[...users]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              </div>
            )}
            <FormError error={error} />
            <DialogActions
              submitLabel={dialog.editingId ? "Save changes" : "Create"}
              submitting={submitting}
              disabled={!online || !form.title.trim() || (dialog.kind === "program" && !form.portfolioId)}
              onCancel={() => setDialog(null)}
            />
            <OfflineHint show={!online} what="This change" />
          </form>
        </Dialog>
      )}
    </div>
  );
}
