import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { ensureSupabaseClient, getAccessToken, persistToken, signOutEverywhere } from "../lib/auth";
import { env } from "../lib/env";
import { useAuth } from "../state/auth";

type Tone = "muted" | "ok" | "err";
const LOGIN_PREFILL_KEY = "tt_login_prefill";

export function sanitizeNext(raw: string | null) {
  if (raw && raw.startsWith("/")) return raw;
  return "/";
}

function buildLoginReturnUrl(next: string) {
  const base = (env.appBase || "/").replace(/\/$/, "");
  const loginPath = `${base || ""}/login`;
  const url = new URL(loginPath || "/login", window.location.origin);
  url.searchParams.set("next", next || "/");
  return url.toString();
}

export function Login() {
  const { loginWithPassword, refreshProfile } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("Not signed in");
  const [message, setMessage] = useState<{ text: string; tone: Tone }>({ text: "", tone: "muted" });
  const [busy, setBusy] = useState(false);
  const [magicBusy, setMagicBusy] = useState(false);

  const nav = useNavigate();
  const location = useLocation();
  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const next = useMemo(() => sanitizeNext(search.get("next")), [search]);
  const supabase = useMemo(() => ensureSupabaseClient(), []);

  const redirect = useCallback(
    (delayMs = 120) => {
      setTimeout(() => nav(next, { replace: true }), delayMs);
    },
    [nav, next],
  );

  const refreshSessionState = useCallback(async () => {
    if (!supabase) {
      setStatus("Supabase not configured");
      return;
    }
    try {
      const { data } = await supabase.auth.getSession();
      const emailValue = data.session?.user?.email;
      if (data.session?.access_token) {
        persistToken(data.session.access_token);
        await refreshProfile();
      }
      setStatus(emailValue ? `Signed in as ${emailValue}` : "Not signed in");
      if (data.session?.access_token) {
        redirect(80);
      }
    } catch (err) {
      setStatus("Not signed in");
    }
  }, [redirect, refreshProfile, supabase]);

  useEffect(() => {
    refreshSessionState();
  }, [refreshSessionState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(LOGIN_PREFILL_KEY);
      if (!raw) return;
      window.sessionStorage.removeItem(LOGIN_PREFILL_KEY);
      const parsed = JSON.parse(raw) as { email?: string; password?: string } | null;
      const nextEmail = typeof parsed?.email === "string" ? parsed.email : "";
      const nextPassword = typeof parsed?.password === "string" ? parsed.password : "";
      if (nextEmail) setEmail(nextEmail);
      if (nextPassword) setPassword(nextPassword);
      if (nextEmail || nextPassword) {
        setMessage({ text: "Login details prefilled from operator registration.", tone: "muted" });
      }
    } catch {
      // ignore storage failures or invalid payloads
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.access_token) {
        persistToken(session.access_token);
        await refreshProfile();
        setStatus(session.user?.email ? `Signed in as ${session.user.email}` : "Signed in");
        redirect();
      } else {
        setStatus("Not signed in");
      }
    });
    return () => subscription.unsubscribe();
  }, [refreshProfile, redirect, supabase]);

  const handlePasswordSignIn = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setMagicBusy(false);
      setMessage({ text: "", tone: "muted" });
      try {
        await loginWithPassword(email, password);
        setMessage({ text: "Signed in. Redirecting...", tone: "ok" });
        redirect();
      } catch (err) {
        const text = err instanceof Error ? err.message : "Sign-in failed";
        setMessage({ text, tone: "err" });
      } finally {
        setBusy(false);
      }
    },
    [email, loginWithPassword, password, redirect],
  );

  const handleMagicLink = useCallback(async () => {
    if (!supabase) {
      setMessage({ text: "Supabase not configured", tone: "err" });
      return;
    }
    if (!email.trim()) {
      setMessage({ text: "Enter email first", tone: "err" });
      return;
    }
    setMagicBusy(true);
    setBusy(false);
    setMessage({ text: "Sending magic link...", tone: "muted" });
    try {
      const redirectTo = buildLoginReturnUrl(next);
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setMessage({ text: "Check your email for the sign-in link.", tone: "ok" });
    } catch (err) {
      const text = err instanceof Error ? err.message : "Magic link failed";
      setMessage({ text, tone: "err" });
    } finally {
      setMagicBusy(false);
    }
  }, [email, next, supabase]);

  const handleSignOut = useCallback(async () => {
    await signOutEverywhere();
    setStatus("Not signed in");
    setMessage({ text: "Signed out", tone: "ok" });
  }, []);

  useEffect(() => {
    // On load, if we already have a stored token, try to use it before re-auth
    (async () => {
      const token = await getAccessToken();
      if (token) {
        setStatus("Restoring session...");
        redirect(100);
      }
    })();
  }, [redirect]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 40%, #e0f2fe 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "rgba(255,255,255,0.96)",
          borderRadius: 18,
          boxShadow: "0 24px 70px rgba(15,23,42,0.22)",
          padding: 24,
          border: "1px solid rgba(226,232,240,0.8)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="badge" style={{ background: "#e2e8f0", color: "#0f172a" }}>
            {status}
          </div>
          <Link to="/role" className="badge" style={{ background: "#e0f2fe", color: "#0f172a" }}>
            Role Select
          </Link>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 6,
              background: "#2563eb",
              boxShadow: "0 0 0 6px rgba(37,99,235,0.12)",
            }}
            aria-hidden="true"
          />
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#0f172a" }}>Sign in to TekeTeke</div>
            <div style={{ color: "#475569", fontSize: 13 }}>
              Use your work email and password. If allowed, you can use a magic link.
            </div>
          </div>
        </div>

        <form onSubmit={handlePasswordSignIn} className="stack" style={{ gap: 12 }}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowPassword((v) => !v)}
                style={{ whiteSpace: "nowrap" }}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          {message.text ? (
            <div
              className={`badge${message.tone === "err" ? " err" : ""}`}
              role={message.tone === "err" ? "alert" : "status"}
            >
              {message.text}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="submit" disabled={busy}>
              {busy ? "Signing in..." : "Sign in"}
            </button>
            <button type="button" className="ghost" onClick={handleMagicLink} disabled={magicBusy}>
              {magicBusy ? "Sending..." : "Send magic link"}
            </button>
            <Link to="/role" className="ghost">
              Back
            </Link>
          </div>
        </form>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 13 }}>
          <span className="muted">Forgot password?</span>
          <button type="button" className="ghost" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
