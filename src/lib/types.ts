export type Role =
  | "user"
  | "super_admin"
  | "system_admin"
  | "sacco_admin"
  | "sacco_staff"
  | "matatu_staff"
  | "matatu_owner"
  | "taxi"
  | "boda";

export type SessionUser = {
  id: string;
  email?: string | null;
  name?: string;
  role: Role;
  sacco_id?: string | null;
  matatu_id?: string | null;
  taxi_id?: string | null;
  boda_id?: string | null;
  asset_id?: string | null;
  asset_type?: Role | "matatu" | null;
  matatu_plate?: string | null;
};
