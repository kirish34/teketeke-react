import { useEffect, useMemo, useState } from 'react'
import VehicleCareAnalytics from './VehicleCareAnalytics'
import VehicleCareForm, { type VehicleCareFormPayload } from './VehicleCareForm'
import VehicleCareTable from './VehicleCareTable'
import {
  ASSET_TYPE_OPTIONS,
  ISSUE_CATEGORIES,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  makeAssetKey,
  parseAssetKey,
  toAssetTypeFilter,
  type AssetType,
  type AssetTypeFilter,
} from './vehicleCare.utils'
import {
  createVehicleCareLog,
  fetchVehicleCareAssets,
  fetchVehicleCareLogs,
  updateVehicleCareLog,
  updateVehicleCompliance,
  type VehicleCareAsset,
  type VehicleCareLog,
} from './vehicleCare.api'

export type VehicleCareContext = {
  scope_type: 'OWNER' | 'OPERATOR'
  scope_id: string
  can_manage_vehicle_care: boolean
  can_manage_compliance: boolean
  can_view_analytics: boolean
  default_asset_type?: AssetTypeFilter
  asset_type_options?: AssetTypeFilter[]
}

type ComplianceForm = {
  tlb_expiry_date: string
  insurance_expiry_date: string
  inspection_expiry_date: string
  license_expiry_date: string
}

const emptyCompliance = (): ComplianceForm => ({
  tlb_expiry_date: '',
  insurance_expiry_date: '',
  inspection_expiry_date: '',
  license_expiry_date: '',
})

export default function VehicleCarePage({ context }: { context: VehicleCareContext }) {
  const [assets, setAssets] = useState<VehicleCareAsset[]>([])
  const [logs, setLogs] = useState<VehicleCareLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const [selectedLog, setSelectedLog] = useState<VehicleCareLog | null>(null)
  const [editingLog, setEditingLog] = useState<VehicleCareLog | null>(null)

  const [filters, setFilters] = useState({
    asset_type: context.default_asset_type || 'ALL',
    asset_key: '',
    category: '',
    status: '',
    priority: '',
    from: '',
    to: '',
  })

  const [complianceForm, setComplianceForm] = useState<ComplianceForm>(emptyCompliance())
  const [complianceMsg, setComplianceMsg] = useState('')

  const assetTypeOptions = context.asset_type_options || ASSET_TYPE_OPTIONS

  const parsedAsset = useMemo(() => parseAssetKey(filters.asset_key), [filters.asset_key])
  const effectiveAssetType = useMemo(() => {
    if (parsedAsset.asset_type) return toAssetTypeFilter(parsedAsset.asset_type)
    return toAssetTypeFilter(filters.asset_type)
  }, [filters.asset_type, parsedAsset.asset_type])

  const selectedAsset = useMemo(() => {
    if (!parsedAsset.asset_id) return null
    return assets.find(
      (asset) =>
        makeAssetKey(asset.asset_type, asset.asset_id) === makeAssetKey(parsedAsset.asset_type, parsedAsset.asset_id),
    )
  }, [assets, parsedAsset.asset_id, parsedAsset.asset_type])

  useEffect(() => {
    let cancelled = false
    async function loadAssets() {
      if (!context.scope_id) return
      setLoading(true)
      setError(null)
      try {
        const items = await fetchVehicleCareAssets({
          scope_type: context.scope_type,
          scope_id: context.scope_id,
          asset_type: effectiveAssetType,
        })
        if (cancelled) return
        setAssets(items)
        if (filters.asset_key) {
          const exists = items.some(
            (asset) => makeAssetKey(asset.asset_type, asset.asset_id) === filters.asset_key,
          )
          if (!exists) {
            setFilters((f) => ({ ...f, asset_key: '' }))
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load assets')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadAssets()
    return () => {
      cancelled = true
    }
  }, [context.scope_id, context.scope_type, effectiveAssetType, filters.asset_key])

  useEffect(() => {
    let cancelled = false
    async function loadLogs() {
      if (!context.scope_id) return
      setLoading(true)
      setError(null)
      try {
        const items = await fetchVehicleCareLogs({
          scope_type: context.scope_type,
          scope_id: context.scope_id,
          asset_type: effectiveAssetType,
          asset_id: parsedAsset.asset_id || '',
          category: filters.category || '',
          status: filters.status || '',
          priority: filters.priority || '',
          from: filters.from || '',
          to: filters.to || '',
        })
        if (!cancelled) setLogs(items)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load logs')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadLogs()
    return () => {
      cancelled = true
    }
  }, [
    context.scope_id,
    context.scope_type,
    effectiveAssetType,
    parsedAsset.asset_id,
    filters.category,
    filters.status,
    filters.priority,
    filters.from,
    filters.to,
  ])

  useEffect(() => {
    if (!selectedAsset) return
    setComplianceForm({
      tlb_expiry_date: selectedAsset.tlb_expiry_date || '',
      insurance_expiry_date: selectedAsset.insurance_expiry_date || '',
      inspection_expiry_date: selectedAsset.inspection_expiry_date || '',
      license_expiry_date: selectedAsset.license_expiry_date || '',
    })
  }, [selectedAsset])

  async function handleCreate(payload: VehicleCareFormPayload) {
    setMsg('')
    await createVehicleCareLog({
      scope_type: context.scope_type,
      scope_id: context.scope_id,
      ...payload,
    })
    setMsg('Log saved')
    setEditingLog(null)
    setSelectedLog(null)
    const items = await fetchVehicleCareLogs({
      scope_type: context.scope_type,
      scope_id: context.scope_id,
      asset_type: effectiveAssetType,
      asset_id: parsedAsset.asset_id || '',
      category: filters.category || '',
      status: filters.status || '',
      priority: filters.priority || '',
      from: filters.from || '',
      to: filters.to || '',
    })
    setLogs(items)
  }

  async function handleUpdate(payload: VehicleCareFormPayload) {
    if (!editingLog?.id) return
    setMsg('')
    await updateVehicleCareLog(editingLog.id, {
      scope_type: context.scope_type,
      scope_id: context.scope_id,
      ...payload,
    })
    setMsg('Log updated')
    setEditingLog(null)
    const items = await fetchVehicleCareLogs({
      scope_type: context.scope_type,
      scope_id: context.scope_id,
      asset_type: effectiveAssetType,
      asset_id: parsedAsset.asset_id || '',
      category: filters.category || '',
      status: filters.status || '',
      priority: filters.priority || '',
      from: filters.from || '',
      to: filters.to || '',
    })
    setLogs(items)
  }

  async function handleComplianceUpdate() {
    if (!selectedAsset?.asset_type || !selectedAsset?.asset_id) return
    setComplianceMsg('Saving...')
    try {
      await updateVehicleCompliance(selectedAsset.asset_type as AssetType, selectedAsset.asset_id, {
        scope_type: context.scope_type,
        scope_id: context.scope_id,
        tlb_expiry_date: complianceForm.tlb_expiry_date || null,
        insurance_expiry_date: complianceForm.insurance_expiry_date || null,
        inspection_expiry_date: complianceForm.inspection_expiry_date || null,
        license_expiry_date: complianceForm.license_expiry_date || null,
      })
      setComplianceMsg('Updated')
    } catch (err) {
      setComplianceMsg(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const assetOptions = useMemo(() => {
    return assets
      .map((asset) => {
        const key = makeAssetKey(asset.asset_type, asset.asset_id)
        if (!key) return null
        const label = asset.label || asset.plate || asset.identifier || asset.asset_id || 'Vehicle'
        return { key, label: `${label} (${asset.asset_type || 'ASSET'})` }
      })
      .filter((row): row is { key: string; label: string } => Boolean(row))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [assets])

  return (
    <>
      {error ? <div className="card err">Vehicle Care error: {error}</div> : null}
      {loading ? <div className="card muted">Loading Vehicle Care...</div> : null}

      {context.can_view_analytics ? <VehicleCareAnalytics logs={logs} /> : null}

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Filters</h3>
          <span className="muted small">{msg}</span>
        </div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <label className="muted small">
            Asset type
            <select
              value={filters.asset_type}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  asset_type: toAssetTypeFilter(e.target.value),
                  asset_key: '',
                }))
              }
              style={{ padding: 10 }}
            >
              {assetTypeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label className="muted small">
            Vehicle
            <select
              value={filters.asset_key}
              onChange={(e) => {
                const nextKey = e.target.value
                const parsed = parseAssetKey(nextKey)
                setFilters((f) => ({
                  ...f,
                  asset_key: nextKey,
                  asset_type: parsed.asset_type ? toAssetTypeFilter(parsed.asset_type) : f.asset_type,
                }))
              }}
              style={{ padding: 10, minWidth: 220 }}
            >
              <option value="">All vehicles</option>
              {assetOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="muted small">
            Category
            <select
              value={filters.category}
              onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
              style={{ padding: 10 }}
            >
              <option value="">All</option>
              {ISSUE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="muted small">
            Status
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              style={{ padding: 10 }}
            >
              <option value="">All</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="muted small">
            Priority
            <select
              value={filters.priority}
              onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
              style={{ padding: 10 }}
            >
              <option value="">All</option>
              {PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>
          <label className="muted small">
            From
            <input
              className="input"
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            />
          </label>
          <label className="muted small">
            To
            <input
              className="input"
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            />
          </label>
          <button
            className="btn ghost"
            type="button"
            onClick={() =>
              setFilters({
                asset_type: context.default_asset_type || 'ALL',
                asset_key: '',
                category: '',
                status: '',
                priority: '',
                from: '',
                to: '',
              })
            }
          >
            Clear
          </button>
        </div>
      </section>

      {context.can_manage_compliance ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Compliance dates</h3>
            <span className="muted small">{complianceMsg}</span>
          </div>
          {!selectedAsset ? (
            <p className="muted" style={{ marginTop: 8 }}>
              Select a vehicle to update compliance dates.
            </p>
          ) : (
            <div className="grid g2" style={{ marginTop: 8 }}>
              {selectedAsset.asset_type === 'SHUTTLE' ? (
                <>
                  <label className="muted small">
                    TLB expiry
                    <input
                      className="input"
                      type="date"
                      value={complianceForm.tlb_expiry_date}
                      onChange={(e) => setComplianceForm((f) => ({ ...f, tlb_expiry_date: e.target.value }))}
                    />
                  </label>
                  <label className="muted small">
                    Insurance expiry
                    <input
                      className="input"
                      type="date"
                      value={complianceForm.insurance_expiry_date}
                      onChange={(e) => setComplianceForm((f) => ({ ...f, insurance_expiry_date: e.target.value }))}
                    />
                  </label>
                  <label className="muted small">
                    Inspection expiry
                    <input
                      className="input"
                      type="date"
                      value={complianceForm.inspection_expiry_date}
                      onChange={(e) => setComplianceForm((f) => ({ ...f, inspection_expiry_date: e.target.value }))}
                    />
                  </label>
                </>
              ) : null}
              {selectedAsset.asset_type === 'TAXI' ? (
                <>
                  <label className="muted small">
                    Insurance expiry
                    <input
                      className="input"
                      type="date"
                      value={complianceForm.insurance_expiry_date}
                      onChange={(e) => setComplianceForm((f) => ({ ...f, insurance_expiry_date: e.target.value }))}
                    />
                  </label>
                  <label className="muted small">
                    PSV badge expiry
                    <input
                      className="input"
                      type="date"
                      value={complianceForm.license_expiry_date}
                      onChange={(e) => setComplianceForm((f) => ({ ...f, license_expiry_date: e.target.value }))}
                    />
                  </label>
                </>
              ) : null}
              {selectedAsset.asset_type === 'BODA' ? (
                <>
                  <label className="muted small">
                    Insurance expiry
                    <input
                      className="input"
                      type="date"
                      value={complianceForm.insurance_expiry_date}
                      onChange={(e) => setComplianceForm((f) => ({ ...f, insurance_expiry_date: e.target.value }))}
                    />
                  </label>
                  <label className="muted small">
                    Rider license expiry
                    <input
                      className="input"
                      type="date"
                      value={complianceForm.license_expiry_date}
                      onChange={(e) => setComplianceForm((f) => ({ ...f, license_expiry_date: e.target.value }))}
                    />
                  </label>
                </>
              ) : null}
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <button className="btn" type="button" onClick={handleComplianceUpdate}>
                  Update compliance
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <VehicleCareForm
        assets={assets}
        initial={editingLog}
        canManage={context.can_manage_vehicle_care}
        onSubmit={editingLog ? handleUpdate : handleCreate}
        onCancel={editingLog ? () => setEditingLog(null) : undefined}
      />

      {selectedLog && !context.can_manage_vehicle_care ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Maintenance details</h3>
            <button className="btn ghost" type="button" onClick={() => setSelectedLog(null)}>
              Close
            </button>
          </div>
          <div className="grid g2" style={{ marginTop: 8 }}>
            <div>
              <div className="muted small">Category</div>
              <div>{selectedLog.issue_category || '-'}</div>
            </div>
            <div>
              <div className="muted small">Priority</div>
              <div>{selectedLog.priority || '-'}</div>
            </div>
            <div>
              <div className="muted small">Status</div>
              <div>{selectedLog.status || '-'}</div>
            </div>
            <div>
              <div className="muted small">Cost</div>
              <div>{selectedLog.total_cost_kes ? selectedLog.total_cost_kes.toLocaleString('en-KE') : '-'}</div>
            </div>
          </div>
          <p style={{ marginTop: 8 }}>{selectedLog.issue_description || '-'}</p>
          {selectedLog.notes ? <p className="muted">{selectedLog.notes}</p> : null}
        </section>
      ) : null}

      <VehicleCareTable
        logs={logs}
        assets={assets}
        canManage={context.can_manage_vehicle_care}
        onSelect={(log) => setSelectedLog(log)}
        onEdit={(log) => {
          setEditingLog(log)
          setSelectedLog(null)
        }}
      />
    </>
  )
}
