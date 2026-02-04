import { authFetch } from "./auth";

export class ApiError extends Error {
  status: number;
  requestId: string | null;
  payload: unknown;

  constructor(message: string, opts: { status: number; requestId?: string | null; payload?: unknown }) {
    const suffix = opts.requestId ? ` (request_id: ${opts.requestId})` : "";
    super(`${message}${suffix}`);
    this.status = opts.status;
    this.requestId = opts.requestId || null;
    this.payload = opts.payload;
  }
}

export async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const res = await authFetch(input, { ...(init || {}), headers });
  const requestId = res.headers.get("x-request-id") || null;
  const contentType = res.headers.get("content-type") || "";

  let payload: unknown = null;
  if (res.status !== 204) {
    if (contentType.includes("application/json")) {
      payload = await res.json();
    } else {
      const text = await res.text();
      payload = text || null;
    }
  }

  if (!res.ok) {
    const message =
      (payload && typeof payload === "object" && "error" in (payload as any) && (payload as any).error) ||
      (payload && typeof payload === "object" && "message" in (payload as any) && (payload as any).message) ||
      (typeof payload === "string" && payload) ||
      res.statusText ||
      "Request failed";
    throw new ApiError(String(message), { status: res.status, requestId, payload });
  }

  return payload as T;
}
