import { authFetch } from '../../lib/auth'
import type { AssetType, AssetTypeFilter } from './vehicleCare.utils'

export type AccessGrant = {
  id?: string
  granter_type?: string
  granter_id?: string
  user_id?: string
  scope_type?: string
  scope_id?: string
  role?: string
  can_manage_staff?: boolean
  can_manage_vehicles?: boolean
  can_manage_vehicle_care?: boolean
  can_manage_compliance?: boolean
  can_view_analytics?: boolean
  is_active?: boolean
}

export type VehicleCareAsset = {
  asset_type?: AssetType
  asset_id?: string
  operator_id?: string | null
  label?: string
  plate?: string | null
  identifier?: string | null
  make?: string | null
  model?: string | null
  year?: number | null
  vehicle_type?: string | null
  vehicle_type_other?: string | null
  seat_capacity?: number | null
  load_capacity_kg?: number | null
  tlb_expiry_date?: string | null
  insurance_expiry_date?: string | null
  inspection_expiry_date?: string | null
  license_expiry_date?: string | null
}

export type VehicleCareLog = {
  id?: string
  operator_id?: string | null
  asset_type?: AssetType
  asset_id?: string
  issue_category?: string
  issue_tags?: string[] | null
  issue_description?: string
  priority?: string
  status?: string
  parts_used?: Array<{
    part_name?: string
    part_category?: string | null
    qty?: number | null
    unit_cost?: number | null
  }> | null
  total_cost_kes?: number | null
  downtime_days?: number | null
  occurred_at?: string | null
  resolved_at?: string | null
  next_service_due?: string | null
  notes?: string | null
  created_at?: string | null
  handled_by_user_id?: string | null
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers || {}) },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return (await res.json()) as T
}

export async function fetchAccessGrants(opts?: { scope_type?: string; scope_id?: string; all?: boolean }) {
  const params = new URLSearchParams()
  if (opts?.scope_type) params.set('scope_type', opts.scope_type)
  if (opts?.scope_id) params.set('scope_id', opts.scope_id)
  if (opts?.all) params.set('all', 'true')
  const q = params.toString()
  const url = q ? `/u/access-grants?${q}` : '/u/access-grants'
  const data = await fetchJson<{ items?: AccessGrant[] }>(url)
  return data.items || []
}

export async function saveAccessGrant(payload: Record<string, unknown>) {
  return fetchJson<AccessGrant>('/u/access-grants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function fetchVehicleCareAssets(opts: {
  scope_type: 'OWNER' | 'OPERATOR'
  scope_id: string
  asset_type?: AssetTypeFilter
}) {
  const params = new URLSearchParams()
  params.set('scope_type', opts.scope_type)
  params.set('scope_id', opts.scope_id)
  if (opts.asset_type) params.set('asset_type', opts.asset_type)
  const data = await fetchJson<{ items?: VehicleCareAsset[] }>(`/u/vehicle-care/assets?${params.toString()}`)
  return data.items || []
}

export async function fetchVehicleCareLogs(opts: {
  scope_type: 'OWNER' | 'OPERATOR'
  scope_id: string
  asset_type?: AssetTypeFilter
  asset_id?: string
  status?: string
  category?: string
  priority?: string
  from?: string
  to?: string
}) {
  const params = new URLSearchParams()
  params.set('scope_type', opts.scope_type)
  params.set('scope_id', opts.scope_id)
  if (opts.asset_type) params.set('asset_type', opts.asset_type)
  if (opts.asset_id) params.set('asset_id', opts.asset_id)
  if (opts.status) params.set('status', opts.status)
  if (opts.category) params.set('category', opts.category)
  if (opts.priority) params.set('priority', opts.priority)
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  const data = await fetchJson<{ items?: VehicleCareLog[] }>(`/u/vehicle-care/logs?${params.toString()}`)
  return data.items || []
}

export async function createVehicleCareLog(payload: Record<string, unknown>) {
  return fetchJson<VehicleCareLog>('/u/vehicle-care/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function updateVehicleCareLog(id: string, payload: Record<string, unknown>) {
  return fetchJson<VehicleCareLog>(`/u/vehicle-care/logs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function updateVehicleCompliance(
  assetType: AssetType,
  assetId: string,
  payload: Record<string, unknown>,
) {
  return fetchJson(`/u/vehicle-care/assets/${encodeURIComponent(assetType)}/${encodeURIComponent(assetId)}/compliance`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
