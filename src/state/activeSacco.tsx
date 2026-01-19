import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authFetch } from "../lib/auth";
import { useAuth } from "./auth";

type ActiveSaccoInput = { id: string | null; name?: string | null } | string | null;

type ActiveSaccoCtx = {
  activeSaccoId: string | null;
  activeSaccoName: string | null;
  setActiveSacco: (sacco: ActiveSaccoInput, saccoName?: string | null) => void;
  clearActiveSacco: () => void;
};

const STORAGE_KEY = "teketeke_active_sacco_id";
const CTX = createContext<ActiveSaccoCtx | null>(null);

function logDebug(msg: string, payload?: Record<string, unknown>) {
  if (import.meta.env.VITE_DEBUG_AUTH === "1") {
    console.log("[sacco]", msg, payload || {});
  }
}

export function ActiveSaccoProvider({ children }: { children: React.ReactNode }) {
  const { context } = useAuth();
  const [activeSaccoId, setActiveSaccoId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });
  const [activeSaccoName, setActiveSaccoName] = useState<string | null>(null);

  const setActiveSacco = useCallback((input: ActiveSaccoInput, saccoName?: string | null) => {
    const saccoId = typeof input === "object" && input !== null ? input.id : input;
    const saccoLabel =
      typeof input === "object" && input !== null ? input.name ?? saccoName ?? null : saccoName ?? null;
    setActiveSaccoId(saccoId);
    setActiveSaccoName(saccoLabel || null);
    try {
      if (saccoId) {
        localStorage.setItem(STORAGE_KEY, saccoId);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
    logDebug("set_active_sacco", { saccoId, saccoName: saccoLabel });
  }, []);

  const clearActiveSacco = useCallback(() => setActiveSacco(null), [setActiveSacco]);

  // Bootstrap from auth context when available
  useEffect(() => {
    const authSacco = context?.sacco_id || null;
    if (authSacco && !activeSaccoId) {
      setActiveSaccoId(authSacco);
      setActiveSaccoName(null);
      try {
        localStorage.setItem(STORAGE_KEY, authSacco);
      } catch {
        /* ignore */
      }
      logDebug("set_active_from_auth", { sacco_id: authSacco });
    }
  }, [context?.sacco_id, activeSaccoId]);

  // Validate stored/auth sacco against accessible list and auto-select when possible
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/u/my-saccos", { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        const findInfo = (id: string | null) =>
          items.find(
            (it: { sacco_id?: string | null; name?: string | null; display_name?: string | null }) =>
              String(it?.sacco_id || "") === String(id || ""),
          );
        const stored = (() => {
          try {
            return localStorage.getItem(STORAGE_KEY) || null;
          } catch {
            return null;
          }
        })();
        const authSacco = context?.sacco_id || null;

        let nextId: string | null = null;
        let nextName: string | null = null;

        if (stored) {
          const match = findInfo(stored);
          if (match) {
            nextId = match.sacco_id || null;
            nextName = match.name || match.display_name || null;
          }
        }
        if (!nextId && authSacco) {
          const match = findInfo(authSacco);
          if (match) {
            nextId = match.sacco_id || null;
            nextName = match.name || match.display_name || null;
          }
        }
        if (!nextId && items.length === 1) {
          nextId = items[0]?.sacco_id || null;
          nextName = items[0]?.name || items[0]?.display_name || null;
        }

        if (cancelled) return;

        if (nextId) {
          setActiveSacco({ id: nextId, name: nextName });
          logDebug("bootstrap_active_sacco", { source: "list", sacco_id: nextId });
        } else if (activeSaccoId && !findInfo(activeSaccoId)) {
          setActiveSacco(null);
          logDebug("clear_stale_sacco", { sacco_id: activeSaccoId });
        }
      } catch {
        // ignore bootstrap errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context?.sacco_id, activeSaccoId, setActiveSacco]);

  const value = useMemo<ActiveSaccoCtx>(
    () => ({
      activeSaccoId,
      activeSaccoName,
      setActiveSacco,
      clearActiveSacco,
    }),
    [activeSaccoId, activeSaccoName, setActiveSacco, clearActiveSacco],
  );

  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

export function useActiveSacco() {
  const ctx = useContext(CTX);
  if (!ctx) throw new Error("useActiveSacco must be used inside ActiveSaccoProvider");
  return ctx;
}
