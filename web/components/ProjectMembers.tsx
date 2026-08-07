"use client";

// Project members — grouped by role, with add/remove and a guarded
// "Replace PM" flow (a project has at most one PM).
// ONLINE-ONLY mutations (like approvals) — never queued to the outbox.

import { useMemo, useState, type FormEvent } from "react";
import { useApp } from "@/lib/store";
import { useToast } from "./Toast";
import { apiErrorMessage, useProjectMembers } from "@/lib/orgData";
import {
  canManageProject,
  cn,
  divisionMeta,
  initials,
  PROJECT_ROLES,
  projectRoleLabel,
} from "@/lib/utils";
import type { Project, ProjectMember, ProjectRole, User } from "@/lib/types";
import { Dialog, DialogActions, Field, FormError, OfflineHint, Select } from "./Dialog";
import EmptyState from "./EmptyState";
import { Pill } from "./Badges";
import { SkeletonList } from "./Skeleton";
import { PlusIcon, XIcon } from "./Icons";

function AddMemberDialog({
  project,
  members,
  users,
  currentPm,
  onAdd,
  onReplacePm,
  onClose,
}: {
  project: Project;
  members: ProjectMember[];
  users: User[];
  currentPm: ProjectMember | null;
  onAdd: (userId: string, role: ProjectRole) => Promise<void>;
  onReplacePm: (userId: string) => Promise<void>;
  onClose: () => void;
}) {
  const { online } = useApp();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ProjectRole>(currentPm ? "CONTRIBUTOR" : "PM");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Hide the PM option when a PM already exists — "Replace PM" is the separate,
  // confirmed path for that.
  const roleOptions = PROJECT_ROLES.filter((r) => r !== "PM" || !currentPm);

  const candidates = useMemo(
    () =>
      [...users]
        .filter((u) => u.isActive !== false)
        .filter((u) => !members.some((m) => m.userId === u.id && m.role === role))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users, members, role],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!userId) {
      setError("Pick a person.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(userId, role);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, "Cannot reach the server — member not added."));
      setSubmitting(false);
    }
  };

  const replace = async () => {
    if (submitting || !userId) return;
    setSubmitting(true);
    setError(null);
    try {
      await onReplacePm(userId);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, "Cannot reach the server — PM not replaced."));
      setSubmitting(false);
      setConfirmReplace(false);
    }
  };

  const pmUser = currentPm ? users.find((u) => u.id === currentPm.userId) : null;

  if (confirmReplace) {
    const nextUser = users.find((u) => u.id === userId);
    return (
      <Dialog title="Replace project manager?" onClose={onClose}>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {pmUser?.name ?? "The current PM"} will be removed as Project Manager and{" "}
          <span className="font-semibold">{nextUser?.name ?? "the selected person"}</span> will take over. A
          project has a single PM.
        </p>
        <FormError error={error} />
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={submitting || !online}
            onClick={() => void replace()}
            className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Replacing…" : "Replace PM"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmReplace(false)}
            className="flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/60"
          >
            Back
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Add member"
      subtitle={project.name}
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        <Field label="Person" htmlFor="am-user">
          <Select id="am-user" value={userId} onChange={(e) => setUserId(e.target.value)} required autoFocus>
            <option value="">Select person…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {divisionMeta(u.division).label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Role"
          htmlFor="am-role"
          hint={currentPm ? `This project already has a PM (${pmUser?.name ?? "assigned"}) — use “Replace PM” below to change it.` : undefined}
        >
          <Select id="am-role" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {projectRoleLabel(r)}
              </option>
            ))}
          </Select>
        </Field>
        <FormError error={error} />
        <DialogActions
          submitLabel="Add member"
          submitting={submitting}
          disabled={!online || !userId}
          onCancel={onClose}
        />
        {currentPm && (
          <button
            type="button"
            disabled={!online || !userId}
            onClick={() => {
              setError(null);
              setConfirmReplace(true);
            }}
            className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-indigo-300 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
          >
            Replace PM with selected person…
          </button>
        )}
        <OfflineHint show={!online} what="Managing members" />
      </form>
    </Dialog>
  );
}

export default function ProjectMembers({ project }: { project: Project }) {
  const { user, users, online } = useApp();
  const { push: toast } = useToast();
  const { members, loading, addMember, removeMember } = useProjectMembers(project.id);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const canManage = canManageProject(user, project, members);
  const currentPm = members.find((m) => m.role === "PM") ?? null;

  const grouped = useMemo(() => {
    const byRole = new Map<ProjectRole, ProjectMember[]>();
    for (const role of PROJECT_ROLES) {
      const list = members.filter((m) => m.role === role);
      if (list.length > 0) byRole.set(role, list);
    }
    return byRole;
  }, [members]);

  const handleAdd = async (userId: string, role: ProjectRole) => {
    await addMember(userId, role);
    toast("Member added.", "success");
  };

  const handleReplacePm = async (userId: string) => {
    if (currentPm) await removeMember(currentPm.userId, "PM");
    await addMember(userId, "PM");
    toast("Project manager replaced.", "success");
  };

  const handleRemove = async (m: ProjectMember) => {
    const key = `${m.userId}:${m.role}`;
    setBusy(key);
    try {
      await removeMember(m.userId, m.role);
      toast("Member removed.", "success");
    } catch (err) {
      toast(apiErrorMessage(err, "Cannot reach the server — member not removed."), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Members</h2>
        {canManage && (
          <button
            type="button"
            disabled={!online}
            onClick={() => setAddOpen(true)}
            title={online ? "Add a project member" : "Managing members needs a live connection"}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            <PlusIcon className="h-4 w-4" />
            Add member
          </button>
        )}
      </div>

      {loading && members.length === 0 ? (
        <SkeletonList count={2} />
      ) : members.length === 0 ? (
        <EmptyState size="sm">
          No members assigned yet.
          {!online && " Membership loads and changes need a live connection."}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([role, list]) => (
            <div key={role}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {projectRoleLabel(role)}
                {list.length > 1 ? ` (${list.length})` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {list.map((m) => {
                  const u = users.find((x) => x.id === m.userId);
                  const div = divisionMeta(u?.division);
                  const key = `${m.userId}:${m.role}`;
                  return (
                    <span
                      key={key}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white py-1.5 pl-1.5 pr-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white",
                          div.accent,
                        )}
                      >
                        {initials(u?.name ?? "?")}
                      </span>
                      <span className="font-medium">{u?.name ?? m.userId}</span>
                      {u?.isActive === false && (
                        <Pill className="bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                          inactive
                        </Pill>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          aria-label={`Remove ${u?.name ?? m.userId} (${projectRoleLabel(m.role)})`}
                          disabled={!online || busy === key}
                          onClick={() => void handleRemove(m)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-rose-900/30 dark:hover:text-rose-400"
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <AddMemberDialog
          project={project}
          members={members}
          users={users}
          currentPm={currentPm}
          onAdd={handleAdd}
          onReplacePm={handleReplacePm}
          onClose={() => setAddOpen(false)}
        />
      )}
    </section>
  );
}
