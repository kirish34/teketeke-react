export const ISSUE_CATEGORIES = [
  'ENGINE',
  'GEARBOX_TRANSMISSION',
  'SUSPENSION_STEERING',
  'BRAKES',
  'TYRES_WHEELS',
  'ELECTRICAL',
  'COOLING_SYSTEM',
  'FUEL_SYSTEM',
  'EXHAUST_EMISSIONS',
  'BODYWORK',
  'INTERIOR',
  'SECURITY',
  'LIGHTS_SIGNALING',
  'SERVICE_ROUTINE',
  'INSPECTION_FAILURE',
  'LICENSE_COMPLIANCE',
  'ACCIDENT_INCIDENT',
  'OTHER',
]

export const PART_CATEGORIES = [
  'ENGINE_PARTS',
  'TRANSMISSION_PARTS',
  'BRAKE_PARTS',
  'SUSPENSION_PARTS',
  'TYRE_PARTS',
  'ELECTRICAL_PARTS',
  'COOLING_PARTS',
  'FUEL_PARTS',
  'BODY_PARTS',
  'INTERIOR_PARTS',
  'SECURITY_PARTS',
  'FLUIDS_CONSUMABLES',
  'OTHER',
]

export const STATUS_OPTIONS = ['OPEN', 'DIAGNOSING', 'WAITING_PARTS', 'IN_PROGRESS', 'RESOLVED', 'REOPENED']
export const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

export type AssetType = 'SHUTTLE' | 'TAXI' | 'BODA'
export type AssetTypeFilter = AssetType | 'ALL'

export const ASSET_TYPE_OPTIONS: AssetTypeFilter[] = ['ALL', 'SHUTTLE', 'TAXI', 'BODA']

export function makeAssetKey(assetType?: string | null, assetId?: string | null) {
  const type = (assetType || '').toString().trim().toUpperCase()
  const id = (assetId || '').toString().trim()
  if (!type || !id) return ''
  return `${type}:${id}`
}

export function parseAssetKey(value: string) {
  const raw = (value || '').toString().trim()
  if (!raw || !raw.includes(':')) return { asset_type: '', asset_id: '' }
  const [asset_type, asset_id] = raw.split(':')
  return { asset_type: asset_type || '', asset_id: asset_id || '' }
}

export function toAssetTypeFilter(value: string | null | undefined): AssetTypeFilter {
  const raw = (value || '').toString().trim().toUpperCase()
  if (raw === 'SHUTTLE' || raw === 'TAXI' || raw === 'BODA') return raw
  return 'ALL'
}

export function safeNumber(value: string | number | null | undefined) {
  const num = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(num) ? num : 0
}

export function sumPartsCost(parts: Array<{ qty?: number | null; unit_cost?: number | null }> = []) {
  return parts.reduce((total, part) => {
    const qty = safeNumber(part.qty)
    const cost = safeNumber(part.unit_cost)
    return total + qty * cost
  }, 0)
}
