"use client";

// Admin Center — Users / Organization / Portfolios. The nav link is only shown
// to ADMINs and this page hides itself from everyone else, but the SERVER is
// the real enforcement point on every endpoint used here.

import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { PageHeader } from "@/components/Headings";
import EmptyState from "@/components/EmptyState";
import UsersTab from "@/components/admin/UsersTab";
import OrgTab from "@/components/admin/OrgTab";
import PortfoliosTab from "@/components/admin/PortfoliosTab";
import { cn } from "@/lib/utils";

type AdminTab = "users" | "org" | "portfolios";

const TABS: { id: AdminTab; label: string }[] = [
  { id: "users", label: "Users" },
  { id: "org", label: "Organization" },
  { id: "portfolios", label: "Portfolios" },
];

export default function AdminPage() {
  const { user, online, users, usersLoading, loadUsers } = useApp();
  const [tab, setTab] = useState<AdminTab>("users");

  // The directory backs every tab (owner selects, member names).
  useEffect(() => {
    if (user?.baseRole === "ADMIN" && users.length === 0 && !usersLoading) void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.baseRole]);

  if (!user) return null;

  if (user.baseRole !== "ADMIN") {
    return (
      <div className="py-10">
        <EmptyState size="bare">
          <p className="font-medium">Admin Center is for administrators only.</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Your account ({user.name}) does not have the ADMIN role.
          </p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Admin Center"
        subtitle={
          <>
            Users, organization and portfolio structure.
            {!online && " You are offline — admin changes need a live connection."}
          </>
        }
      />

      <div
        role="tablist"
        aria-label="Admin sections"
        className="mb-6 flex gap-1 rounded-2xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800 sm:w-fit"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "min-h-[44px] flex-1 rounded-xl px-4 text-sm font-medium transition sm:flex-none",
              tab === t.id
                ? "bg-indigo-600 text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/60",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "org" && <OrgTab />}
      {tab === "portfolios" && <PortfoliosTab />}
    </div>
  );
}
