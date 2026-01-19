import { env } from "../lib/env";

type ApiOpts = {
  method?: string;
  body?: any;
  token?: string | null;
  saccoId?: string | null;
};

export async function api<T = any>(path: string, opts: ApiOpts = {}): Promise<T> {
  const url = resolveApiUrl(path);

  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.saccoId ? { "x-active-sacco-id": opts.saccoId } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || res.statusText;
    throw new Error(msg);
  }
  return data as T;
}

export function resolveApiUrl(path: string, baseOverride?: string, isDevOverride?: boolean) {
  if (/^https?:\/\//i.test(path)) return path;

  const isDev = typeof isDevOverride === "boolean" ? isDevOverride : import.meta.env.DEV;
  const base = String(baseOverride ?? env.apiBase ?? "").trim().replace(/\/$/, "");

  // Prefer same-origin (Vite proxy) in dev to avoid CORS headaches when the API
  // is the local dev server.
  if (isDev) {
    const lower = base.toLowerCase();
    const isLocalApi =
      !base ||
      base === "/" ||
      lower.includes("localhost") ||
      lower.includes("127.0.0.1") ||
      lower.includes("0.0.0.0");
    if (isLocalApi) return path;
  }

  if (!base || base === "/") return path;
  return `${base}${path}`;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
}
