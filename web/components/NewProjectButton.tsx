"use client";

// "New project" affordance (ADMIN or DIVISION_LEAD — server enforces anyway).
// ONLINE-ONLY: creation is a direct POST /api/projects and never enters the
// outbox; the button disables with a hint while offline.

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { useToast } from "./Toast";
import { api } from "@/lib/api";
import { apiErrorMessage, asEntity, useOrgTree, usePortfolios, usePrograms } from "@/lib/orgData";
import { canCreateProject, cn, DIVISION_META, divisionMeta } from "@/lib/utils";
import type { Project, ProjectClassification } from "@/lib/types";
import { Dialog, DialogActions, Field, FormError, OfflineHint, Select, TextArea, TextInput } from "./Dialog";
import { PlusIcon } from "./Icons";

const CLASSIFICATIONS: ProjectClassification[] = ["internal", "restricted", "confidential"];

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { user, online, upsertProject } = useApp();
  const { push: toast } = useToast();
  const router = useRouter();
  const { tree } = useOrgTree();
  const { items: portfolios } = usePortfolios();
  const { items: programs } = usePrograms();

  const isAdmin = user?.baseRole === "ADMIN";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [division, setDivision] = useState(user?.division ?? "");
  const [site, setSite] = useState(user?.site ?? "");
  const [portfolioId, setPortfolioId] = useState("");
  const [programId, setProgramId] = useState("");
  const [classification, setClassification] = useState<ProjectClassification>("internal");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Divisions: org tree when the API delivered one, else the built-in registry.
  const divisionOptions = useMemo(() => {
    if (tree.divisions.length > 0) return tree.divisions.map((d) => ({ id: d.id, name: d.name }));
    return Object.keys(DIVISION_META).map((id) => ({ id, name: divisionMeta(id).label }));
  }, [tree.divisions]);

  const siteOptions = useMemo(() => {
    const names = tree.sites.map((s) => s.name);
    if (user?.site && !names.includes(user.site)) names.push(user.site);
    return names;
  }, [tree.sites, user?.site]);

  const portfolioPrograms = useMemo(
    () => programs.filter((p) => !portfolioId || p.portfolioId === portfolioId),
    [programs, portfolioId],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }
    if (!division) {
      setError("Pick a division.");
      return;
    }
    if (!online) {
      setError("Creating a project needs a live connection.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<unknown>("/api/projects", {
        method: "POST",
        body: {
          name: name.trim(),
          description: description.trim() || undefined,
          division,
          site: site || undefined,
          portfolioId: portfolioId || undefined,
          programId: programId || undefined,
          ...(isAdmin ? { classification } : {}),
        },
      });
      const project = asEntity<Project>(res, "project");
      if (project && typeof project.id === "string") {
        upsertProject(project);
        toast(
          project.code ? `Project ${project.code} created.` : "Project created.",
          "success",
        );
        onClose();
        router.push(`/projects/${project.id}`);
      } else {
        toast("Project created.", "success");
        onClose();
      }
    } catch (err) {
      setError(apiErrorMessage(err, "Cannot reach the server — check your connection and try again."));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title="New project"
      subtitle="The server assigns the PRJ code on creation."
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        <Field label="Name" htmlFor="np-name">
          <TextInput
            id="np-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
            placeholder="e.g. Data Center Network Refresh"
          />
        </Field>
        <Field label="Description" htmlFor="np-desc">
          <TextArea
            id="np-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project about? (optional)"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Division" htmlFor="np-division">
            <Select id="np-division" value={division} onChange={(e) => setDivision(e.target.value)} required>
              <option value="">Select division…</option>
              {divisionOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Site" htmlFor="np-site">
            {siteOptions.length > 0 ? (
              <Select id="np-site" value={site ?? ""} onChange={(e) => setSite(e.target.value)}>
                <option value="">No site</option>
                {siteOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            ) : (
              <TextInput
                id="np-site"
                value={site ?? ""}
                onChange={(e) => setSite(e.target.value)}
                placeholder="Site (optional)"
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Portfolio" htmlFor="np-portfolio">
            <Select
              id="np-portfolio"
              value={portfolioId}
              onChange={(e) => {
                setPortfolioId(e.target.value);
                setProgramId("");
              }}
            >
              <option value="">None</option>
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Program" htmlFor="np-program">
            <Select id="np-program" value={programId} onChange={(e) => setProgramId(e.target.value)}>
              <option value="">None</option>
              {portfolioPrograms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {isAdmin && (
          <Field
            label="Classification"
            htmlFor="np-classification"
            hint="Restricted/confidential projects are concealed from unauthorized users."
          >
            <Select
              id="np-classification"
              value={classification}
              onChange={(e) => setClassification(e.target.value as ProjectClassification)}
            >
              {CLASSIFICATIONS.map((c) => (
                <option key={c} value={c} className="capitalize">
                  {c[0]!.toUpperCase() + c.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <FormError error={error} />
        <DialogActions
          submitLabel="Create project"
          submitting={submitting}
          disabled={!online || !name.trim() || !division}
          onCancel={onClose}
        />
        <OfflineHint show={!online} what="Creating a project" />
      </form>
    </Dialog>
  );
}

export default function NewProjectButton({ className }: { className?: string }) {
  const { user, online } = useApp();
  const [open, setOpen] = useState(false);

  if (!canCreateProject(user)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!online}
        title={online ? "Create a new project" : "Creating a project needs a live connection"}
        className={cn(
          "flex min-h-[44px] items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <PlusIcon className="h-4 w-4" />
        New project
      </button>
      {open && <NewProjectDialog onClose={() => setOpen(false)} />}
    </>
  );
}
