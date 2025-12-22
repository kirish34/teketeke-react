import { api } from "./api";
import type { Role } from "../lib/types";

export type FrontendEvent = {
  event_type: string;
  sacco_id?: string | null;
  vehicle_type?: "matatu" | "taxi" | "boda" | "sacco" | "system" | "unknown";
  vehicle_id?: string | null;
  route_id?: string | null;
  role?: Role;
  meta?: Record<string, any>;
};

export async function logEvent(ev: FrontendEvent, token?: string | null) {
  try {
    await api("/api/events/frontend", { method: "POST", body: ev, token });
  } catch {
    // do not block UI
  }
}
