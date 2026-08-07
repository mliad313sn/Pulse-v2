"use client";

// War Room data hooks — stage gates + approval ledger.
//
// Gate state and the ledger are LIVE, ONLINE-ONLY reads (never cached to
// IndexedDB): governance decisions must always reflect the server's canonical
// view, exactly like approval decisions. Pages render an EmptyState while
// offline instead of a possibly-stale checklist.

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { useApp } from "./store";
import { asArray, asEntity } from "./orgData";
import type { GateRequest, GateStatus, LedgerEntry } from "./types";

/** Human-friendly message for gate request/decision failures. */
export function gateErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.code === "STEERING_APPROVAL_REQUIRED") {
      return "Steering approval required — only a Steering Committee member can decide this gate.";
    }
    if (e.code === "GATE_REQUIREMENTS_NOT_MET") {
      const missing = missingRequirementLabels(e.detail);
      return missing.length > 0
        ? `Gate requirements not met: ${missing.join(", ")}.`
        : "Gate requirements are not met yet.";
    }
    if (e.status === 409) return "A gate request is already pending for this project.";
    if (e.code === "FORBIDDEN") return "Your role is not allowed to do that.";
    return e.message || `Request failed (${e.code}).`;
  }
  return fallback;
}

/** Tolerantly extract labels from a 422 GATE_REQUIREMENTS_NOT_MET detail.missing. */
export function missingRequirementLabels(detail: unknown): string[] {
  if (!detail || typeof detail !== "object") return [];
  const missing = (detail as Record<string, unknown>).missing;
  if (!Array.isArray(missing)) return [];
  return missing
    .map((m) => {
      if (typeof m === "string") return m;
      if (m && typeof m === "object") {
        const o = m as Record<string, unknown>;
        return (o.label as string) || (o.key as string) || "";
      }
      return "";
    })
    .filter(Boolean);
}

export interface GatesApi {
  gates: GateStatus | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Live gate state for a project — GET /api/projects/:id/gates (online-only). */
export function useGates(projectId: string): GatesApi {
  const { user, online } = useApp();
  const [gates, setGates] = useState<GateStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user || !online) {
      setLoading(false);
      return;
    }
    try {
      const res = await api<unknown>(`/api/projects/${projectId}/gates`);
      const parsed = asEntity<GateStatus>(res, "gates");
      setGates(parsed && typeof parsed.stage === "string" ? parsed : (res as GateStatus));
    } catch {
      // keep whatever we had — page shows the offline/unavailable notice
    } finally {
      setLoading(false);
    }
  }, [user, online, projectId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  return { gates, loading, reload };
}

export interface LedgerApi {
  entries: LedgerEntry[];
  loading: boolean;
  reload: () => Promise<void>;
}

/** Immutable approval ledger — GET /api/projects/:id/ledger (online-only). */
export function useLedger(projectId: string): LedgerApi {
  const { user, online } = useApp();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user || !online) {
      setLoading(false);
      return;
    }
    try {
      const res = await api<unknown>(`/api/projects/${projectId}/ledger`);
      const list = asArray<LedgerEntry>(res, "ledger").filter((e) => e && typeof e.id === "string");
      // Chronological: oldest decision first (immutable record reads top-down).
      list.sort((a, b) =>
        (a.decidedAt || a.requestedAt || "").localeCompare(b.decidedAt || b.requestedAt || ""),
      );
      setEntries(list);
    } catch {
      // keep cache-of-nothing — page shows the offline/unavailable notice
    } finally {
      setLoading(false);
    }
  }, [user, online, projectId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  return { entries, loading, reload };
}

/** POST /api/projects/:id/gates/request — throws ApiError on failure. */
export async function requestGateApproval(
  projectId: string,
  input: { note?: string; dispositionNote?: string },
): Promise<GateRequest> {
  const res = await api<unknown>(`/api/projects/${projectId}/gates/request`, {
    method: "POST",
    body: {
      note: input.note || undefined,
      dispositionNote: input.dispositionNote || undefined,
    },
  });
  return (asEntity<GateRequest>(res, "gateRequest") ?? (res as GateRequest)) as GateRequest;
}

/** POST /api/gate-requests/:id/decision — throws ApiError on failure. */
export async function decideGateRequest(
  requestId: string,
  decision: "APPROVED" | "REJECTED",
  note?: string,
): Promise<void> {
  await api(`/api/gate-requests/${requestId}/decision`, {
    method: "POST",
    body: { decision, note: note || undefined },
  });
}
