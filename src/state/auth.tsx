import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { clearAuthStorage, ensureSupabaseClient, getAccessToken, persistToken, signOutEverywhere } from "../lib/auth";
import type { Role, SessionUser } from "../lib/types";
import { authFetch } from "../lib/auth";

type AuthCtx = {
  user: SessionUser | null;
  token: string | null;
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
  const res = await authFetch("/u/me", {
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
  const role = mapRole(data.role);
  if (!role) throw new Error("No role assigned to this account");
  return {
    id: data.id || "",
    email: data.email || null,
    role,
    sacco_id: data.sacco_id ?? null,
    matatu_id: data.matatu_id ?? null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => ensureSupabaseClient(), []);

  const refreshProfile = useCallback(async () => {
    setLoading(true);
    try {
      const accessToken = (await getAccessToken()) || null;
      if (!accessToken) {
        setUser(null);
        setToken(null);
        setError(null);
        return;
      }
      const profile = await fetchProfile(accessToken);
      setUser(profile);
      setToken(accessToken);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load profile";
      setError(msg);
      setUser(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) throw new Error("Supabase is not configured");
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      let accessToken = data.session?.access_token || null;
      if (!accessToken) {
        const sessionRes = await supabase.auth.getSession();
        accessToken = sessionRes.data.session?.access_token || null;
      }
      if (!accessToken) throw new Error("No session returned from Supabase");
      persistToken(accessToken);
      setToken(accessToken);
      await refreshProfile();
    },
    [refreshProfile, supabase],
  );

  const logout = useCallback(async () => {
    try {
      await signOutEverywhere();
    } finally {
      clearAuthStorage();
      setUser(null);
      setToken(null);
      setError(null);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  // Do not clear auth storage on refresh; keep session unless user explicitly logs out.

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      token,
      loading,
      error,
      loginWithPassword,
      logout,
      refreshProfile,
    }),
    [error, loading, loginWithPassword, logout, refreshProfile, token, user],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
