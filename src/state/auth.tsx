import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { clearAuthStorage, ensureSupabaseClient, persistToken, signOutEverywhere } from "../lib/auth";
import type { Role, SessionUser } from "../lib/types";
import { authFetch } from "../lib/auth";

type AuthCtx = {
  user: SessionUser | null;
  session: Session | null;
  token: string | null;
  status: "booting" | "authenticated" | "unauthenticated";
  loading: boolean;
  error: string | null;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

function mapRole(role?: string | null): Role | null {
  const r = (role || "").toUpperCase();
  if (r === "SYSTEM_ADMIN") return "system_admin";
  if (r === "SACCO" || r === "SACCO_ADMIN") return "sacco_admin";
  if (r === "SACCO_STAFF") return "sacco_staff";
  if (r === "OWNER") return "matatu_owner";
  if (r === "STAFF") return "matatu_staff";
  if (r === "TAXI") return "taxi";
  if (r === "BODA") return "boda";
  return null;
}

async function fetchProfile(token?: string | null): Promise<SessionUser> {
  const res = await authFetch("/api/auth/me", {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || res.statusText || "Failed to load profile") as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as any;
  const role = mapRole(data.context?.effective_role || data.role);
  if (!role) throw new Error("No role assigned to this account");
  return {
    id: data.user?.id || data.id || "",
    email: data.user?.email || data.email || null,
    role,
    sacco_id: data.context?.sacco_id ?? data.sacco_id ?? null,
    matatu_id: data.context?.matatu_id ?? data.matatu_id ?? null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"booting" | "authenticated" | "unauthenticated">("booting");
  const [error, setError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const supabase = useMemo(() => ensureSupabaseClient(), []);
  const profileLock = useRef<Promise<void> | null>(null);

  const withDebug = (msg: string, payload?: Record<string, unknown>) => {
    if (import.meta.env.VITE_DEBUG_AUTH === "1") {
      console.log("[auth]", msg, payload || {});
    }
  };

  const clearState = useCallback((nextStatus: "unauthenticated" | "booting" = "unauthenticated") => {
    setUser(null);
    setSession(null);
    setToken(null);
    setError(null);
    setStatus(nextStatus);
  }, []);

  const runProfileFetch = useCallback(
    async (accessToken: string | null | undefined) => {
      if (!accessToken) {
        clearAuthStorage();
        clearState("unauthenticated");
        return;
      }
      if (profileLock.current) return profileLock.current;

      const task = (async () => {
        setProfileLoading(true);
        setError(null);
        persistToken(accessToken);
        try {
          const profile = await fetchProfile(accessToken);
          setUser(profile);
          setToken(accessToken);
          setStatus("authenticated");
          withDebug("profile_loaded", { role: profile.role });
        } catch (err) {
          const statusCode = (err as any)?.status;
          const msg = err instanceof Error ? err.message : "Failed to load profile";
          setError(msg);
          withDebug("profile_error", { status: statusCode, msg });
          if (statusCode === 401 || statusCode === 403) {
            await signOutEverywhere();
            clearAuthStorage();
          }
          clearState("unauthenticated");
        } finally {
          profileLock.current = null;
          setProfileLoading(false);
        }
      })();

      profileLock.current = task;
      return task;
    },
    [clearState, withDebug],
  );

  const refreshProfile = useCallback(async () => {
    if (!supabase) {
      clearState("unauthenticated");
      return;
    }
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token || null;
    setSession(data.session || null);
    if (!accessToken) {
      clearAuthStorage();
      clearState("unauthenticated");
      return;
    }
    await runProfileFetch(accessToken);
  }, [clearState, runProfileFetch, supabase]);

  const loginWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) throw new Error("Supabase is not configured");
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      const sessionRes = data.session || (await supabase.auth.getSession()).data.session;
      const accessToken = sessionRes?.access_token || null;
      if (!accessToken) throw new Error("No session returned from Supabase");
      setStatus("booting");
      setSession(sessionRes || null);
      await runProfileFetch(accessToken);
    },
    [runProfileFetch, supabase],
  );

  const logout = useCallback(async () => {
    try {
      await signOutEverywhere();
    } finally {
      clearAuthStorage();
      clearState();
    }
  }, [clearState]);

  // Initial session load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) {
        clearState("unauthenticated");
        return;
      }
      setStatus("booting");
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        const sess = data.session;
        setSession(sess || null);
        const accessToken = sess?.access_token || null;
        if (!accessToken) {
          clearAuthStorage();
          clearState("unauthenticated");
          return;
        }
        await runProfileFetch(accessToken);
      } catch (err) {
        if (!cancelled) {
          withDebug("initial_session_error", {
            error: err instanceof Error ? err.message : String(err),
          });
          clearAuthStorage();
          clearState("unauthenticated");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearState, runProfileFetch, supabase, withDebug]);

  // Keep session refreshed and synced with Supabase auth events
  useEffect(() => {
    const client = ensureSupabaseClient();
    if (!client) return;
    const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
      withDebug("auth_event", { event, hasToken: Boolean(session?.access_token) });
      const nextToken = session?.access_token || null;
      if (event === "SIGNED_OUT") {
        profileLock.current = null;
        clearAuthStorage();
        clearState();
        return;
      }
      if (nextToken && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")) {
        setSession(session || null);
        setStatus("booting");
        void runProfileFetch(nextToken);
      }
    });
    return () => {
      subscription?.subscription?.unsubscribe();
    };
  }, [clearState, runProfileFetch, withDebug]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      session,
      token,
      loading: status === "booting" || profileLoading,
      status,
      error,
      loginWithPassword,
      logout,
      refreshProfile,
    }),
    [error, loginWithPassword, logout, profileLoading, refreshProfile, session, status, token, user],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
