import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authFetch } from "../lib/auth";
import { useAuth } from "./auth";

type ActiveSaccoCtx = {
  activeSaccoId: string | null;
  activeSaccoName: string | null;
  setActiveSacco: (saccoId: string | null, saccoName?: string | null) => void;
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

  // If no selection yet, and only one sacco, auto-select
  useEffect(() => {
    if (activeSaccoId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/u/my-saccos");
        if (!res.ok) return;
        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        if (items.length === 1) {
          const saccoId = items[0]?.sacco_id || null;
          const name = items[0]?.name || items[0]?.display_name || null;
          if (!cancelled && saccoId) {
            setActiveSaccoId(saccoId);
            setActiveSaccoName(name);
            try {
              localStorage.setItem(STORAGE_KEY, saccoId);
            } catch {
              /* ignore */
            }
            logDebug("set_active_from_single_sacco", { sacco_id: saccoId });
          }
        }
      } catch {
        // ignore bootstrap errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSaccoId]);

  const setActiveSacco = (saccoId: string | null, saccoName?: string | null) => {
    setActiveSaccoId(saccoId);
    setActiveSaccoName(saccoName || null);
    try {
      if (saccoId) {
        localStorage.setItem(STORAGE_KEY, saccoId);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
    logDebug("set_active_sacco", { saccoId, saccoName });
  };

  const value = useMemo<ActiveSaccoCtx>(
    () => ({
      activeSaccoId,
      activeSaccoName,
      setActiveSacco,
    }),
    [activeSaccoId, activeSaccoName],
  );

  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

export function useActiveSacco() {
  const ctx = useContext(CTX);
  if (!ctx) throw new Error("useActiveSacco must be used inside ActiveSaccoProvider");
  return ctx;
}
