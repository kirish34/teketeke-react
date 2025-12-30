import type { VehicleCareLog, VehicleCareAsset } from './vehicleCare.api'
import { makeAssetKey } from './vehicleCare.utils'

type Props = {
  logs: VehicleCareLog[]
  assets: VehicleCareAsset[]
  canManage: boolean
  onSelect: (log: VehicleCareLog) => void
  onEdit: (log: VehicleCareLog) => void
}

export default function VehicleCareTable({ logs, assets, canManage, onSelect, onEdit }: Props) {
  const assetMap = new Map<string, VehicleCareAsset>()
  assets.forEach((asset) => {
    const key = makeAssetKey(asset.asset_type, asset.asset_id)
    if (key) assetMap.set(key, asset)
  })

  return (
    <section className="card">
      <div className="topline">
        <h3 style={{ margin: 0 }}>Maintenance logs</h3>
        <span className="muted small">
          {logs.length} record{logs.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Vehicle</th>
              <th>Asset Type</th>
              <th>Category</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Cost</th>
              <th>Downtime</th>
              <th>Handled By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={10} className="muted">
                  No maintenance logs found.
                </td>
              </tr>
            ) : (
              logs.map((log) => {
                const key = makeAssetKey(log.asset_type, log.asset_id)
                const asset = key ? assetMap.get(key) : null
                const dateLabel = log.occurred_at || log.created_at
                return (
                  <tr key={log.id || `${log.asset_id}-${log.occurred_at}`}>
                    <td>{dateLabel ? new Date(dateLabel).toLocaleDateString('en-KE') : '-'}</td>
                    <td>{asset?.label || log.asset_id || '-'}</td>
                    <td>{log.asset_type || '-'}</td>
                    <td>{log.issue_category || '-'}</td>
                    <td>{log.priority || '-'}</td>
                    <td>{log.status || '-'}</td>
                    <td>{log.total_cost_kes ? log.total_cost_kes.toLocaleString('en-KE') : '-'}</td>
                    <td>{log.downtime_days ?? '-'}</td>
                    <td className="mono">{log.handled_by_user_id || '-'}</td>
                    <td className="row" style={{ gap: 6 }}>
                      <button className="btn ghost" type="button" onClick={() => onSelect(log)}>
                        View
                      </button>
                      {canManage ? (
                        <button className="btn ghost" type="button" onClick={() => onEdit(log)}>
                          Edit
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
