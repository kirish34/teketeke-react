import { useEffect, useMemo, useState } from 'react'
import type { VehicleCareAsset, VehicleCareLog } from './vehicleCare.api'
import {
  ISSUE_CATEGORIES,
  PART_CATEGORIES,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  makeAssetKey,
  parseAssetKey,
  safeNumber,
  sumPartsCost,
} from './vehicleCare.utils'

type PartInput = {
  part_name: string
  part_category: string
  qty: string
  unit_cost: string
}

export type VehicleCareFormPayload = {
  asset_type: string
  asset_id: string
  issue_category: string
  issue_description: string
  priority: string
  status?: string
  parts_used?: Array<{
    part_name: string
    part_category?: string | null
    qty?: number | null
    unit_cost?: number | null
  }>
  total_cost_kes?: number | null
  downtime_days?: number | null
  next_service_due?: string | null
  notes?: string | null
}

type Props = {
  assets: VehicleCareAsset[]
  initial?: VehicleCareLog | null
  canManage: boolean
  onSubmit: (payload: VehicleCareFormPayload) => Promise<void>
  onCancel?: () => void
}

const emptyPart = (): PartInput => ({ part_name: '', part_category: '', qty: '', unit_cost: '' })

function mapPartsFromLog(parts?: VehicleCareLog['parts_used'] | null): PartInput[] {
  if (!parts || !Array.isArray(parts) || !parts.length) return [emptyPart()]
  return parts.map((p) => ({
    part_name: p?.part_name || '',
    part_category: p?.part_category || '',
    qty: p?.qty != null ? String(p.qty) : '',
    unit_cost: p?.unit_cost != null ? String(p.unit_cost) : '',
  }))
}

export default function VehicleCareForm({ assets, initial, canManage, onSubmit, onCancel }: Props) {
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => ({
    asset_key: '',
    issue_category: '',
    issue_description: '',
    priority: 'MEDIUM',
    status: 'OPEN',
    parts_used: [emptyPart()],
    total_cost_kes: '',
    downtime_days: '',
    next_service_due: '',
    notes: '',
  }))

  useEffect(() => {
    if (!initial) {
      setForm((f) => ({ ...f, asset_key: f.asset_key || '', issue_category: '', issue_description: '', priority: 'MEDIUM' }))
      return
    }
    setForm({
      asset_key: makeAssetKey(initial.asset_type, initial.asset_id),
      issue_category: initial.issue_category || '',
      issue_description: initial.issue_description || '',
      priority: initial.priority || 'MEDIUM',
      status: initial.status || 'OPEN',
      parts_used: mapPartsFromLog(initial.parts_used),
      total_cost_kes: initial.total_cost_kes != null ? String(initial.total_cost_kes) : '',
      downtime_days: initial.downtime_days != null ? String(initial.downtime_days) : '',
      next_service_due: initial.next_service_due || '',
      notes: initial.notes || '',
    })
  }, [initial])

  const assetOptions = useMemo(() => {
    return assets
      .map((asset) => {
        const key = makeAssetKey(asset.asset_type, asset.asset_id)
        if (!key) return null
        const label = asset.label || asset.plate || asset.identifier || asset.asset_id || 'Vehicle'
        const typeLabel = asset.asset_type || 'ASSET'
        return { key, label: `${label} (${typeLabel})` }
      })
      .filter((row): row is { key: string; label: string } => Boolean(row))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [assets])

  const partsTotal = useMemo(() => {
    const normalized = form.parts_used.map((part) => ({
      qty: safeNumber(part.qty),
      unit_cost: safeNumber(part.unit_cost),
    }))
    return sumPartsCost(normalized)
  }, [form.parts_used])

  async function handleSubmit() {
    setMsg('')
    const { asset_type, asset_id } = parseAssetKey(form.asset_key)
    if (!asset_type || !asset_id) {
      setMsg('Select a vehicle')
      return
    }
    if (!form.issue_category.trim()) {
      setMsg('Issue category required')
      return
    }
    if (!form.issue_description.trim()) {
      setMsg('Issue description required')
      return
    }
    if (!form.priority.trim()) {
      setMsg('Priority required')
      return
    }

    const parts =
      canManage && form.parts_used.length
        ? form.parts_used
            .map((part) => ({
              part_name: part.part_name.trim(),
              part_category: part.part_category ? part.part_category.trim() : null,
              qty: part.qty ? Math.max(1, Math.trunc(Number(part.qty))) : null,
              unit_cost: part.unit_cost ? Math.max(0, Number(part.unit_cost)) : null,
            }))
            .filter((part) => part.part_name)
        : []

    const totalCost = canManage
      ? form.total_cost_kes
        ? Number(form.total_cost_kes)
        : partsTotal || null
      : null

    const payload: VehicleCareFormPayload = {
      asset_type,
      asset_id,
      issue_category: form.issue_category.trim().toUpperCase(),
      issue_description: form.issue_description.trim(),
      priority: form.priority.trim().toUpperCase(),
      status: canManage ? form.status.trim().toUpperCase() : 'OPEN',
      parts_used: canManage && parts.length ? parts : undefined,
      total_cost_kes: canManage ? (Number.isFinite(totalCost as number) ? (totalCost as number) : null) : undefined,
      downtime_days: canManage ? (form.downtime_days ? Number(form.downtime_days) : null) : undefined,
      next_service_due: canManage && form.next_service_due ? form.next_service_due : undefined,
      notes: form.notes ? form.notes.trim() : undefined,
    }

    setSaving(true)
    try {
      await onSubmit(payload)
      setMsg('Saved')
      if (!initial) {
        setForm({
          asset_key: '',
          issue_category: '',
          issue_description: '',
          priority: 'MEDIUM',
          status: 'OPEN',
          parts_used: [emptyPart()],
          total_cost_kes: '',
          downtime_days: '',
          next_service_due: '',
          notes: '',
        })
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <div className="topline">
        <h3 style={{ margin: 0 }}>{initial ? 'Edit maintenance log' : 'Register maintenance'}</h3>
        <span className="muted small">{msg}</span>
      </div>
      <div className="grid g2">
        <label className="muted small">
          Vehicle *
          <select
            value={form.asset_key}
            onChange={(e) => setForm((f) => ({ ...f, asset_key: e.target.value }))}
            style={{ padding: 10 }}
          >
            <option value="">Select vehicle</option>
            {assetOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="muted small">
          Issue category *
          <select
            value={form.issue_category}
            onChange={(e) => setForm((f) => ({ ...f, issue_category: e.target.value }))}
            style={{ padding: 10 }}
          >
            <option value="">Select category</option>
            {ISSUE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="muted small">
          Priority *
          <select
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            style={{ padding: 10 }}
          >
            {PRIORITY_OPTIONS.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </label>
        {canManage ? (
          <label className="muted small">
            Status
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} style={{ padding: 10 }}>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {canManage ? (
          <label className="muted small">
            Downtime days
            <input
              className="input"
              type="number"
              min={0}
              value={form.downtime_days}
              onChange={(e) => setForm((f) => ({ ...f, downtime_days: e.target.value }))}
            />
          </label>
        ) : null}
        {canManage ? (
          <label className="muted small">
            Next service due
            <input
              className="input"
              type="date"
              value={form.next_service_due}
              onChange={(e) => setForm((f) => ({ ...f, next_service_due: e.target.value }))}
            />
          </label>
        ) : null}
      </div>
      <label className="muted small" style={{ display: 'block', marginTop: 10 }}>
        Issue description *
        <textarea
          className="input"
          value={form.issue_description}
          onChange={(e) => setForm((f) => ({ ...f, issue_description: e.target.value }))}
          style={{ minHeight: 90 }}
        />
      </label>
      {canManage ? (
        <>
          <label className="muted small" style={{ display: 'block', marginTop: 10 }}>
            Notes
            <textarea
              className="input"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              style={{ minHeight: 70 }}
            />
          </label>
          <div style={{ marginTop: 10 }}>
            <h4 style={{ margin: '0 0 6px' }}>Parts used</h4>
            {form.parts_used.map((part, idx) => (
              <div key={`part-${idx}`} className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <input
                  className="input"
                  placeholder="Part name"
                  value={part.part_name}
                  onChange={(e) =>
                    setForm((f) => {
                      const next = [...f.parts_used]
                      next[idx] = { ...next[idx], part_name: e.target.value }
                      return { ...f, parts_used: next }
                    })
                  }
                  style={{ minWidth: 160 }}
                />
                <select
                  value={part.part_category}
                  onChange={(e) =>
                    setForm((f) => {
                      const next = [...f.parts_used]
                      next[idx] = { ...next[idx], part_category: e.target.value }
                      return { ...f, parts_used: next }
                    })
                  }
                  style={{ padding: 10 }}
                >
                  <option value="">Category</option>
                  {PART_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder="Qty"
                  value={part.qty}
                  onChange={(e) =>
                    setForm((f) => {
                      const next = [...f.parts_used]
                      next[idx] = { ...next[idx], qty: e.target.value }
                      return { ...f, parts_used: next }
                    })
                  }
                  style={{ width: 90 }}
                />
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder="Unit cost"
                  value={part.unit_cost}
                  onChange={(e) =>
                    setForm((f) => {
                      const next = [...f.parts_used]
                      next[idx] = { ...next[idx], unit_cost: e.target.value }
                      return { ...f, parts_used: next }
                    })
                  }
                  style={{ width: 120 }}
                />
                {form.parts_used.length > 1 ? (
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, parts_used: f.parts_used.filter((_, partIdx) => partIdx !== idx) }))
                    }
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
            <button className="btn ghost" type="button" onClick={() => setForm((f) => ({ ...f, parts_used: [...f.parts_used, emptyPart()] }))}>
              Add part
            </button>
          </div>
          <div className="grid g2" style={{ marginTop: 10 }}>
            <label className="muted small">
              Total cost (KES)
              <input
                className="input"
                type="number"
                min={0}
                value={form.total_cost_kes}
                onChange={(e) => setForm((f) => ({ ...f, total_cost_kes: e.target.value }))}
              />
            </label>
            <div className="muted small" style={{ alignSelf: 'end' }}>
              Parts subtotal: {partsTotal.toLocaleString('en-KE')}
            </div>
          </div>
        </>
      ) : null}
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn" type="button" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving...' : initial ? 'Save changes' : 'Save log'}
        </button>
        {onCancel ? (
          <button className="btn ghost" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        ) : null}
      </div>
    </section>
  )
}
