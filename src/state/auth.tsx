import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { clearAuthStorage, ensureSupabaseClient, persistToken, signOutEverywhere } from "../lib/auth";
import type { Role, SessionUser } from "../lib/types";
import { authFetch } from "../lib/auth";

type AuthCtx = {
  user: SessionUser | null;
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
    throw new Error(text || res.statusText || "Failed to load profile");
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
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"booting" | "authenticated" | "unauthenticated">("booting");
  const [error, setError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const supabase = useMemo(() => ensureSupabaseClient(), []);
  const fetchingProfile = useRef(false);

  const withDebug = (msg: string, payload?: Record<string, unknown>) => {
    if (import.meta.env.VITE_DEBUG_AUTH === "1") {
      console.log("[auth]", msg, payload || {});
    }
  };

  const clearState = useCallback(() => {
    setUser(null);
    setToken(null);
    setError(null);
    setStatus("unauthenticated");
  }, []);

  const refreshProfile = useCallback(async () => {
    if (fetchingProfile.current) return;
    fetchingProfile.current = true;
    setProfileLoading(true);
    try {
      const { data } = await supabase?.auth.getSession()!;
      const accessToken = data.session?.access_token || null;
      if (!accessToken) {
        clearAuthStorage();
        clearState();
        return;
      }
      persistToken(accessToken);
      const profile = await fetchProfile(accessToken);
      setUser(profile);
      setToken(accessToken);
      setError(null);
      setStatus("authenticated");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load profile";
      setError(msg);
      clearAuthStorage();
      clearState();
    } finally {
      fetchingProfile.current = false;
      setProfileLoading(false);
    }
  }, [clearState, supabase]);

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
      persistToken(accessToken);
      setToken(accessToken);
      setStatus("booting");
      await refreshProfile();
    },
    [refreshProfile, supabase],
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
      setStatus("booting");
      try {
        const { data } = await supabase?.auth.getSession()!;
        const sess = data.session;
        if (!sess?.access_token) {
          if (!cancelled) {
            clearState();
          }
          return;
        }
        persistToken(sess.access_token);
        await refreshProfile();
      } catch (err) {
        if (!cancelled) {
          clearAuthStorage();
          clearState();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearState, refreshProfile, supabase]);

  // Keep session refreshed and synced with Supabase auth events
  useEffect(() => {
    const client = ensureSupabaseClient();
    if (!client) return;
    const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
      withDebug("auth_event", { event, hasToken: Boolean(session?.access_token) });
      const nextToken = session?.access_token || null;
      if (event === "SIGNED_OUT") {
        clearAuthStorage();
        clearState();
        return;
      }
      if (nextToken && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")) {
        persistToken(nextToken);
        setToken(nextToken);
        setStatus("booting");
        void refreshProfile();
      }
    });
    return () => {
      subscription?.subscription?.unsubscribe();
    };
  }, [clearState, refreshProfile, withDebug]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      token,
      loading: status === "booting" || profileLoading,
      status,
      error,
      loginWithPassword,
      logout,
      refreshProfile,
    }),
    [error, loginWithPassword, logout, profileLoading, refreshProfile, status, token, user],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
