import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { authFetch, clearAuthStorage, ensureSupabaseClient } from "../lib/auth";
import type { Role, SessionUser } from "../lib/types";

type AuthStatus = "booting" | "authenticated" | "unauthenticated";

type AuthContext = {
  user: SessionUser | null;
  context: UserContext | null;
  contextMissing: boolean;
  session: Session | null;
  token: string | null;
  status: AuthStatus;
  loading: boolean;
  error: string | null;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

type UserContext = {
  effective_role: Role;
  sacco_id: string | null;
  matatu_id: string | null;
};

const Ctx = createContext<AuthContext | null>(null);

function logDebug(msg: string, payload?: Record<string, unknown>) {
  if (import.meta.env.VITE_DEBUG_AUTH === "1") {
    console.log("[auth]", msg, payload || {});
  }
}

function normalizePath(raw: string | null | undefined) {
  if (!raw) return "/";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return `/${trimmed}`;
  return trimmed;
}

function stripAppPrefix(path: string) {
  return path.startsWith("/app/") ? path.slice(4) || "/" : path;
}

export function resolveHomePath(role: Role | null | undefined): string {
  switch ((role || "").toLowerCase()) {
    case "user":
      return "/app/pending";
    case "super_admin":
    case "system_admin":
      return "/app/system";
    case "sacco_admin":
    case "sacco":
      return "/app/sacco-admin";
    case "sacco_staff":
      return "/app/sacco-staff";
    case "matatu_owner":
    case "owner":
      return "/app/matatu-owner";
    case "matatu_staff":
    case "staff":
    case "driver":
      return "/app/matatu-staff";
    case "taxi":
      return "/taxi";
    case "boda":
      return "/boda";
    default:
      return "/login";
  }
}

export function isPathAllowedForRole(role: Role | null | undefined, rawPath: string | null | undefined) {
  if (!role) return false;
  const normalized = stripAppPrefix(normalizePath(rawPath));
  const r = role;
  if (normalized.startsWith("/pending")) return true;
  if (normalized.startsWith("/app/pending")) return true;
  if (normalized.startsWith("/system") || normalized.startsWith("/ops")) {
    return r === "system_admin" || r === "super_admin";
  }
  if (normalized.startsWith("/sacco/staff")) {
    return r === "sacco_staff" || r === "sacco_admin" || r === "super_admin" || r === "system_admin";
  }
  if (normalized.startsWith("/sacco")) {
    return r === "sacco_admin" || r === "super_admin" || r === "system_admin";
  }
  if (normalized.startsWith("/matatu/owner")) {
    return r === "matatu_owner" || r === "super_admin";
  }
  if (normalized.startsWith("/matatu/staff")) {
    return r === "matatu_staff" || r === "super_admin";
  }
  if (normalized.startsWith("/taxi")) return r === "taxi" || r === "super_admin";
  if (normalized.startsWith("/boda")) return r === "boda" || r === "super_admin";
  if (normalized.startsWith("/dash")) return true;
  return true;
}

function mapRole(role?: string | null): Role | null {
  const r = (role || "").toUpperCase();
  if (r === "USER") return "user";
  if (r === "SUPER_ADMIN") return "super_admin";
  if (r === "SYSTEM_ADMIN") return "system_admin";
  if (r === "SACCO" || r === "SACCO_ADMIN") return "sacco_admin";
  if (r === "SACCO_STAFF") return "sacco_staff";
  if (r === "OWNER" || r === "MATATU_OWNER") return "matatu_owner";
  if (r === "STAFF" || r === "MATATU_STAFF" || r === "DRIVER") return "matatu_staff";
  if (r === "TAXI") return "taxi";
  if (r === "BODA") return "boda";
  return null;
}

async function fetchProfile(token: string): Promise<{ user: SessionUser; context: UserContext; contextMissing: boolean }> {
  logDebug("fetch_me_start");
  const res = await authFetch("/api/auth/me", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || res.statusText || "Failed to load profile") as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as any;
  const role = mapRole(data.context?.effective_role || data.role || "USER");
  if (!role) throw new Error("No role assigned to this account");
  const ctx: UserContext = {
    effective_role: role,
    sacco_id: data.context?.sacco_id ?? data.sacco_id ?? null,
    matatu_id: data.context?.matatu_id ?? data.matatu_id ?? null,
  };
  const user: SessionUser = {
    id: data.user?.id || data.id || "",
    email: data.user?.email || data.email || null,
    role,
    sacco_id: ctx.sacco_id,
    matatu_id: ctx.matatu_id,
  };
  const contextMissing = Boolean(data.context_missing);
  logDebug("fetch_me_success", { role, contextMissing });
  return { user, context: ctx, contextMissing };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [context, setContext] = useState<UserContext | null>(null);
  const [contextMissing, setContextMissing] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>("booting");
  const [error, setError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const supabase = useMemo(() => ensureSupabaseClient(), []);
  const inflightProfile = useRef<Promise<void> | null>(null);
  const signingOut = useRef(false);
  const subscriptionCount = useRef(0);
  const lastStatus = useRef<AuthStatus>(status);

  const clearState = useCallback((nextStatus: AuthStatus = "unauthenticated") => {
    setUser(null);
    setContext(null);
    setContextMissing(false);
    setSession(null);
    setToken(null);
    setError(null);
    setStatus(nextStatus);
  }, []);

  const signOutOnce = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    try {
      await supabase?.auth.signOut();
    } catch {
      // ignore sign-out failures
    } finally {
      clearAuthStorage();
      clearState("unauthenticated");
      signingOut.current = false;
    }
  }, [clearState, supabase]);

  const runProfileFetch = useCallback(
    async (nextSession?: Session | null) => {
      const accessToken = nextSession?.access_token || null;
      if (!accessToken) {
        await signOutOnce();
        return;
      }
      if (inflightProfile.current) return inflightProfile.current;
      inflightProfile.current = (async () => {
        setProfileLoading(true);
        setError(null);
        try {
          const { user: u, context: ctx, contextMissing: ctxMissing } = await fetchProfile(accessToken);
          setUser(u);
          setContext(ctx);
          setContextMissing(ctxMissing);
          setToken(accessToken);
          setStatus("authenticated");
        } catch (err) {
          const statusCode = (err as any)?.status;
          const msg = err instanceof Error ? err.message : "Failed to load profile";
          setError(msg);
          logDebug("fetch_me_error", { status: statusCode, msg });
          if (statusCode === 401 || statusCode === 403) {
            await signOutOnce();
          } else {
            clearState("unauthenticated");
          }
        } finally {
          inflightProfile.current = null;
          setProfileLoading(false);
        }
      })();
      return inflightProfile.current;
    },
    [clearState, signOutOnce],
  );

  const refreshProfile = useCallback(async () => {
    if (!supabase) {
      clearState("unauthenticated");
      return;
    }
    const { data } = await supabase.auth.getSession();
    setSession(data.session || null);
    await runProfileFetch(data.session);
  }, [clearState, runProfileFetch, supabase]);

  const loginWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) throw new Error("Supabase is not configured");
      setStatus("booting");
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      const sess = data.session || (await supabase.auth.getSession()).data.session;
      setSession(sess || null);
      await runProfileFetch(sess);
    },
    [runProfileFetch, supabase],
  );

  const logout = useCallback(async () => {
    await signOutOnce();
  }, [signOutOnce]);

  // Initial session load (one-time)
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
        setSession(data.session || null);
        if (!data.session?.access_token) {
          clearState("unauthenticated");
          return;
        }
        await runProfileFetch(data.session);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Session load failed");
          await signOutOnce();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearState, runProfileFetch, signOutOnce, supabase]);

  // Auth event subscription (single)
  useEffect(() => {
    const client = ensureSupabaseClient();
    if (!client) return;
    const { data: subscription } = client.auth.onAuthStateChange((event, nextSession) => {
      logDebug("auth_event", { event, hasToken: Boolean(nextSession?.access_token) });
      if (event === "SIGNED_OUT") {
        inflightProfile.current = null;
        void signOutOnce();
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        setStatus("booting");
        setSession(nextSession || null);
        void runProfileFetch(nextSession);
      }
    });
    subscriptionCount.current += 1;
    logDebug("auth_subscription_added", { count: subscriptionCount.current });
    return () => {
      subscription?.subscription?.unsubscribe();
      subscriptionCount.current = Math.max(subscriptionCount.current - 1, 0);
      logDebug("auth_subscription_removed", { count: subscriptionCount.current });
    };
  }, [runProfileFetch, signOutOnce]);

  useEffect(() => {
    if (lastStatus.current !== status) {
      logDebug("status_transition", { from: lastStatus.current, to: status });
      lastStatus.current = status;
    }
  }, [status]);

  const value = useMemo<AuthContext>(
    () => ({
      user,
      context,
      session,
      token,
      status,
      loading: status === "booting" || profileLoading,
      error,
      loginWithPassword,
      logout,
      refreshProfile,
      contextMissing,
    }),
    [context, contextMissing, error, loginWithPassword, logout, profileLoading, refreshProfile, session, status, token, user],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
