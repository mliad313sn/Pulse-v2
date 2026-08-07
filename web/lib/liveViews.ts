"use client";

// Wave 5 live-view data hook — My Work, Portfolio Wall KPIs, Site Lens.
//
// All three endpoints are ONLINE-ONLY live reads (like gates/ledger): nothing
// is written to IndexedDB. While offline the hook resolves with data:null and
// offline:true so pages can render cached-fallback messaging from the central
// store instead of a stale copy of a server-derived view.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { useApp } from "./store";

export interface LiveView<T> {
  data: T | null;
  /** True until the first fetch settles (or immediately false while offline). */
  loading: boolean;
  /** Human-readable failure message (network/API error while online). */
  error: string | null;
  /** True when the fetch was skipped because the client is offline. */
  offline: boolean;
  reload: () => Promise<void>;
}

/**
 * Fetch a live, online-only view. Refetches whenever `path` changes or the
 * client comes back online. Pass path=null to pause the hook.
 */
export function useLiveView<T>(path: string | null): LiveView<T> {
  const { user, online } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Guards against out-of-order responses when filters change quickly.
  const seqRef = useRef(0);

  const reload = useCallback(async () => {
    if (!path || !user) {
      setLoading(false);
      return;
    }
    if (!online) {
      // Offline: keep whatever we had; pages show cached-fallback messaging.
      setLoading(false);
      setError(null);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api<T>(path);
      if (seq !== seqRef.current) return; // a newer request superseded this one
      setData(res);
      setError(null);
    } catch (e) {
      if (seq !== seqRef.current) return;
      if (e instanceof ApiError) {
        setError(e.message || `Request failed (${e.code}).`);
      } else {
        setError("Could not reach the server — check your connection and retry.");
      }
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [path, user, online]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, offline: !online, reload };
}
