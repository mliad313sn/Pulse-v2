"use client";

// Admin Center — Users tab. ADMIN-only (server enforces on every endpoint).
// ONLINE-ONLY: user management never touches the offline outbox.

import { useMemo, useState, type FormEvent } from "react";
import { useApp } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/orgData";
import { baseRoleLabel, cn, divisionMeta, DIVISION_META, titleCaseTag } from "@/lib/utils";
import type { BaseRole, CreateUserResponse, User } from "@/lib/types";
import { Dialog, DialogActions, Field, FormError, OfflineHint, Select, TextInput } from "@/components/Dialog";
import EmptyState from "@/components/EmptyState";
import { Pill } from "@/components/Badges";
import { SkeletonList } from "@/components/Skeleton";
import { CheckIcon, KeyIcon, PlusIcon } from "@/components/Icons";

const BASE_ROLES: BaseRole[] = ["ADMIN", "DIVISION_LEAD", "CONTRIBUTOR", "VIEWER"];
const PRIVILEGES = ["security_reviewer", "steering"];

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — user can select the text manually */
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-400 dark:border-slate-600 dark:text-slate-300"
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5 text-emerald-500" /> : null}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** One-time reveal of a server-generated temporary password. */
function TempPasswordDialog({
  title,
  userName,
  password,
  onClose,
}: {
  title: string;
  userName: string;
  password: string;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} subtitle={userName} onClose={onClose}>
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/30">
        <div className="flex items-center justify-between gap-3">
          <code className="select-all break-all font-mono text-base font-semibold text-slate-800 dark:text-slate-100">
            {password}
          </code>
          <CopyButton value={password} />
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          <KeyIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This temporary password is shown ONCE and cannot be retrieved later. Share it securely — the user
          must change it at first sign-in.
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-5 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-500"
      >
        Done — I saved it
      </button>
    </Dialog>
  );
}

interface UserFormState {
  name: string;
  email: string;
  division: string;
  site: string;
  baseRole: BaseRole;
  privileges: string[];
  enterpriseAccess: boolean;
}

function UserFormFields({
  form,
  setForm,
  showEnterpriseAccess,
  showIdentity,
}: {
  form: UserFormState;
  setForm: (f: UserFormState) => void;
  showEnterpriseAccess: boolean;
  showIdentity: boolean;
}) {
  const togglePrivilege = (p: string) =>
    setForm({
      ...form,
      privileges: form.privileges.includes(p)
        ? form.privileges.filter((x) => x !== p)
        : [...form.privileges, p],
    });

  return (
    <>
      {showIdentity && (
        <>
          <Field label="Name" htmlFor="uf-name">
            <TextInput
              id="uf-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
              required
            />
          </Field>
          <Field label="Email" htmlFor="uf-email">
            <TextInput
              id="uf-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </Field>
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Division" htmlFor="uf-division">
          <Select
            id="uf-division"
            value={form.division}
            onChange={(e) => setForm({ ...form, division: e.target.value })}
            required
          >
            <option value="">Select division…</option>
            {Object.keys(DIVISION_META).map((d) => (
              <option key={d} value={d}>
                {divisionMeta(d).label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Site" htmlFor="uf-site">
          <TextInput
            id="uf-site"
            value={form.site}
            onChange={(e) => setForm({ ...form, site: e.target.value })}
            placeholder="Optional"
          />
        </Field>
      </div>
      <Field label="Base role" htmlFor="uf-role">
        <Select
          id="uf-role"
          value={form.baseRole}
          onChange={(e) => setForm({ ...form, baseRole: e.target.value as BaseRole })}
        >
          {BASE_ROLES.map((r) => (
            <option key={r} value={r}>
              {baseRoleLabel(r)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Privileges">
        <div className="flex flex-wrap gap-2">
          {PRIVILEGES.map((p) => {
            const active = form.privileges.includes(p);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                onClick={() => togglePrivilege(p)}
                className={cn(
                  "min-h-[40px] rounded-xl border px-3 text-sm font-medium transition",
                  active
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-600 dark:text-slate-300",
                )}
              >
                {titleCaseTag(p)}
              </button>
            );
          })}
        </div>
      </Field>
      {showEnterpriseAccess && (
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.enterpriseAccess}
            onChange={(e) => setForm({ ...form, enterpriseAccess: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
          />
          Enterprise access (cross-division visibility)
        </label>
      )}
    </>
  );
}

const EMPTY_FORM: UserFormState = {
  name: "",
  email: "",
  division: "",
  site: "",
  baseRole: "CONTRIBUTOR",
  privileges: [],
  enterpriseAccess: false,
};

export default function UsersTab() {
  const { user: me, users, usersLoading, loadUsers, online } = useApp();
  const { push: toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reveal, setReveal] = useState<{ title: string; userName: string; password: string } | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const sorted = useMemo(() => [...users].sort((a, b) => a.name.localeCompare(b.name)), [users]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setError(null);
    setCreateOpen(true);
  };

  const openEdit = (u: User) => {
    setForm({
      name: u.name,
      email: u.email ?? "",
      division: u.division,
      site: u.site ?? "",
      baseRole: u.baseRole,
      privileges: [...(u.privileges ?? [])],
      enterpriseAccess: Boolean(u.enterpriseAccess),
    });
    setError(null);
    setEditing(u);
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!form.name.trim() || !form.email.trim() || !form.division) {
      setError("Name, email and division are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<CreateUserResponse>("/api/users", {
        method: "POST",
        body: {
          name: form.name.trim(),
          email: form.email.trim(),
          division: form.division,
          site: form.site.trim() || undefined,
          baseRole: form.baseRole,
          privileges: form.privileges,
        },
      });
      setCreateOpen(false);
      setSubmitting(false);
      if (res?.temporaryPassword) {
        setReveal({
          title: "User created",
          userName: res.user?.name ?? form.name.trim(),
          password: res.temporaryPassword,
        });
      } else {
        toast("User created.", "success");
      }
      void loadUsers();
    } catch (err) {
      setError(apiErrorMessage(err, "Cannot reach the server — user not created."));
      setSubmitting(false);
    }
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !editing) return;
    setSubmitting(true);
    setError(null);
    try {
      await api(`/api/users/${editing.id}`, {
        method: "PATCH",
        body: {
          baseRole: form.baseRole,
          privileges: form.privileges,
          division: form.division || undefined,
          site: form.site.trim() || null,
          enterpriseAccess: form.enterpriseAccess,
        },
      });
      setEditing(null);
      setSubmitting(false);
      toast("User updated.", "success");
      void loadUsers();
    } catch (err) {
      setError(apiErrorMessage(err, "Cannot reach the server — user not updated."));
      setSubmitting(false);
    }
  };

  const rowAction = async (u: User, label: string, fn: () => Promise<void>) => {
    setBusyRow(u.id);
    try {
      await fn();
    } catch (err) {
      toast(apiErrorMessage(err, `Cannot reach the server — ${label} failed.`), "error");
    } finally {
      setBusyRow(null);
    }
  };

  const toggleActive = (u: User) =>
    rowAction(u, u.isActive ? "deactivation" : "reactivation", async () => {
      await api(`/api/users/${u.id}`, { method: "PATCH", body: { isActive: !u.isActive } });
      toast(
        u.isActive
          ? `${u.name} deactivated — all their sessions are revoked.`
          : `${u.name} reactivated.`,
        "success",
      );
      void loadUsers();
    });

  const resetPassword = (u: User) =>
    rowAction(u, "password reset", async () => {
      const res = await api<{ temporaryPassword: string }>(`/api/users/${u.id}/reset-password`, {
        method: "POST",
      });
      if (res?.temporaryPassword) {
        setReveal({ title: "Password reset", userName: u.name, password: res.temporaryPassword });
      } else {
        toast("Password reset.", "success");
      }
      void loadUsers();
    });

  const unlock = (u: User) =>
    rowAction(u, "unlock", async () => {
      await api(`/api/users/${u.id}/unlock`, { method: "POST" });
      toast(`${u.name} unlocked.`, "success");
    });

  const rowBtn =
    "min-h-[36px] rounded-lg border border-slate-300 px-2.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {users.length} account{users.length === 1 ? "" : "s"} · temporary passwords are shown once, never
          stored.
        </p>
        <button
          type="button"
          disabled={!online}
          onClick={openCreate}
          title={online ? "Create a user" : "User management needs a live connection"}
          className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          Create user
        </button>
      </div>

      {usersLoading && users.length === 0 ? (
        <SkeletonList count={4} />
      ) : users.length === 0 ? (
        <EmptyState size="md">
          No users loaded yet{online ? "." : " — the directory needs a live connection."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[56rem] border-collapse bg-white text-sm dark:bg-slate-800">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Division / site</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Privileges</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Enterprise</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => {
                const div = divisionMeta(u.division);
                const busy = busyRow === u.id || !online;
                return (
                  <tr
                    key={u.id}
                    className={cn(
                      "border-b border-slate-100 last:border-0 dark:border-slate-700/60",
                      u.isActive === false && "opacity-60",
                    )}
                  >
                    <td className="px-4 py-3 font-medium">
                      {u.name}
                      {u.id === me?.id && <span className="ml-1.5 text-xs text-slate-400">(you)</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{u.email ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 rounded-full", div.accent)} />
                        {div.label}
                        {u.site ? <span className="text-slate-400">· {u.site}</span> : null}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Pill
                        className={
                          u.baseRole === "ADMIN"
                            ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300"
                        }
                      >
                        {baseRoleLabel(u.baseRole)}
                      </Pill>
                    </td>
                    <td className="px-4 py-3">
                      {(u.privileges ?? []).length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {(u.privileges ?? []).map((p) => (
                            <Pill
                              key={p}
                              className="bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"
                            >
                              {titleCaseTag(p)}
                            </Pill>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.isActive !== false ? (
                        <Pill className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                          Active
                        </Pill>
                      ) : (
                        <Pill className="bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                          Inactive
                        </Pill>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.enterpriseAccess ? (
                        <Pill className="bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300">
                          Enterprise
                        </Pill>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button type="button" disabled={busy} onClick={() => openEdit(u)} className={rowBtn}>
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void resetPassword(u)}
                          className={rowBtn}
                        >
                          Reset password
                        </button>
                        <button type="button" disabled={busy} onClick={() => void unlock(u)} className={rowBtn}>
                          Unlock
                        </button>
                        <button
                          type="button"
                          disabled={busy || u.id === me?.id}
                          onClick={() => void toggleActive(u)}
                          title={u.id === me?.id ? "You cannot deactivate your own account" : undefined}
                          className={cn(
                            rowBtn,
                            u.isActive !== false &&
                              "border-rose-300 text-rose-600 hover:border-rose-400 dark:border-rose-800 dark:text-rose-400",
                          )}
                        >
                          {u.isActive !== false ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <OfflineHint show={!online} what="User management" />

      {createOpen && (
        <Dialog
          title="Create user"
          subtitle="A temporary password is generated server-side and shown once."
          onClose={() => setCreateOpen(false)}
        >
          <form onSubmit={(e) => void submitCreate(e)} noValidate className="space-y-4">
            <UserFormFields form={form} setForm={setForm} showEnterpriseAccess={false} showIdentity />
            <FormError error={error} />
            <DialogActions
              submitLabel="Create user"
              submitting={submitting}
              disabled={!online}
              onCancel={() => setCreateOpen(false)}
            />
            <OfflineHint show={!online} what="Creating a user" />
          </form>
        </Dialog>
      )}

      {editing && (
        <Dialog title={`Edit ${editing.name}`} subtitle={editing.email} onClose={() => setEditing(null)}>
          <form onSubmit={(e) => void submitEdit(e)} noValidate className="space-y-4">
            <UserFormFields form={form} setForm={setForm} showEnterpriseAccess showIdentity={false} />
            <FormError error={error} />
            <DialogActions
              submitLabel="Save changes"
              submitting={submitting}
              disabled={!online}
              onCancel={() => setEditing(null)}
            />
            <OfflineHint show={!online} what="Editing a user" />
          </form>
        </Dialog>
      )}

      {reveal && (
        <TempPasswordDialog
          title={reveal.title}
          userName={reveal.userName}
          password={reveal.password}
          onClose={() => setReveal(null)}
        />
      )}
    </div>
  );
}
