import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import DashboardShell from '../components/DashboardShell'
import { authFetch } from '../lib/auth'

type OverviewCounts = {
  saccos?: number
  matatus?: number
  taxis?: number
  bodas?: number
  tx_today?: number
}

type OverviewPool = {
  available?: number
  total?: number
}

type Overview = {
  counts?: OverviewCounts
  ussd_pool?: OverviewPool
}

type PlatformTotals = {
  gross_fares?: number
  matatu_net?: number
  sacco_fee_income?: number
  teketeke_income?: number
}

type FinanceOverview = {
  today?: PlatformTotals
  week?: PlatformTotals
  month?: PlatformTotals
}

type SaccoSummaryRow = {
  sacco_id?: string
  sacco_name?: string
  matatus?: number
  gross_fares?: number
  matatu_net?: number
  sacco_fee_income?: number
  status?: string
}

type WithdrawalRow = {
  id?: string
  created_at?: string
  sacco_name?: string
  matatu_plate?: string
  phone?: string
  amount?: number
  status?: string
}

type WalletSummary = {
  virtual_account_code?: string
  balance?: number
  currency?: string
}

type WalletTx = {
  created_at?: string
  tx_type?: string
  amount?: number
  balance_after?: number
  source?: string
}

type UssdPoolRow = {
  id?: string
  code?: string
  full_code?: string
  base?: string
  status?: string
  allocated_to_type?: string
  allocated_to_id?: string
  allocated_at?: string
  telco?: string
  sacco_id?: string
}

type UssdPool = {
  available?: UssdPoolRow[]
  allocated?: UssdPoolRow[]
}

type SmsRow = {
  id?: string
  to_phone?: string
  template_code?: string
  status?: string
  tries?: number
  updated_at?: string
  error_message?: string
}

type RouteUsageRow = {
  sacco_id?: string
  sacco_name?: string
  routes?: number
  active_routes?: number
  total_distance_km?: number
  average_distance_km?: number
}

type AdminRoute = {
  id?: string
  name?: string
  sacco_id?: string
  active?: boolean
  path_points?: unknown
}

type AdminLogin = {
  user_id?: string
  email?: string
  role?: string
  sacco_id?: string | null
  matatu_id?: string | null
}

type SystemTabId =
  | 'overview'
  | 'finance'
  | 'saccos'
  | 'matatu'
  | 'taxis'
  | 'bodabodas'
  | 'ussd'
  | 'paybill'
  | 'sms'
  | 'logins'
  | 'routes'
  | 'registry'

type VehicleKind = 'MATATU' | 'TAXI' | 'BODABODA'

type VehicleTabKey = 'matatu' | 'taxis' | 'bodabodas'

type SaccoRow = {
  id?: string
  sacco_id?: string
  name?: string
  sacco_name?: string
  contact_name?: string
  phone?: string
  contact_phone?: string
  email?: string
  contact_email?: string
  default_till?: string
}

type VehicleRow = {
  id?: string
  plate?: string
  registration?: string
  vehicle_type?: string
  owner_name?: string
  owner_phone?: string
  sacco_id?: string
  sacco_name?: string
  sacco?: string
  body_type?: string
  type?: string
  number_plate?: string
  till_number?: string
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await authFetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return (await res.json()) as T
}

async function fetchList<T>(url: string): Promise<T[]> {
  const res = await authFetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  const data = await res.json()
  if (Array.isArray(data)) return data as T[]
  if (Array.isArray(data?.items)) return data.items as T[]
  return []
}

async function postJson(url: string) {
  const res = await authFetch(url, { method: 'POST', headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json().catch(() => ({}))
}

async function sendJson<T = unknown>(url: string, method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  const res = await authFetch(url, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return (await res.json().catch(() => ({}))) as T
}

async function deleteJson(url: string) {
  const res = await authFetch(url, { method: 'DELETE', headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json().catch(() => ({}))
}

const formatKes = (val?: number | null) => `KES ${(Number(val || 0)).toLocaleString('en-KE')}`

type CsvHeader = { key: string; label: string }
type CsvRow = Record<string, string | number | boolean | null | undefined>

function csvEscape(value: CsvRow[keyof CsvRow]) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

function buildCsv(headers: CsvHeader[], rows: CsvRow[]) {
  const headerLine = headers.map((h) => csvEscape(h.label)).join(',')
  const body = rows.map((row) => headers.map((h) => csvEscape(row[h.key])).join(',')).join('\n')
  return `${headerLine}\n${body}`
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function downloadJson(filename: string, payload: unknown) {
  downloadFile(filename, JSON.stringify(payload, null, 2), 'application/json')
}

function formatVehicleLabel(row?: VehicleRow | null) {
  if (!row) return '-'
  return row.number_plate || row.plate || row.registration || row.id || '-'
}

function formatUssdCode(row?: UssdPoolRow | null) {
  if (!row) return '-'
  return row.full_code || row.code || row.base || '-'
}

function formatUssdOwner(row?: UssdPoolRow | null) {
  if (!row) return '-'
  if (row.allocated_to_type) return `${row.allocated_to_type} ${row.allocated_to_id || ''}`.trim()
  return row.sacco_id || row.allocated_to_id || '-'
}

function normalizeUssdInput(raw?: string) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  const compact = trimmed.replace(/\s+/g, '')
  if (compact.includes('*') || compact.includes('#')) {
    return compact.endsWith('#') ? compact : `${compact}#`
  }
  return compact
}
type LatLng = [number, number]

declare global {
  interface Window {
    L?: any
  }
}

function getRange(key: 'today' | 'week' | 'month') {
  const today = new Date()
  const to = today.toISOString().slice(0, 10)
  if (key === 'today') return { from: to, to }
  if (key === 'week') {
    const d = new Date(today)
    const dow = d.getDay() || 7
    d.setDate(d.getDate() - (dow - 1))
    return { from: d.toISOString().slice(0, 10), to }
  }
  const start = new Date(today.getFullYear(), today.getMonth(), 1)
  return { from: start.toISOString().slice(0, 10), to }
}

const SystemDashboard = () => {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  const [saccos, setSaccos] = useState<SaccoRow[]>([])
  const [saccosError, setSaccosError] = useState<string | null>(null)

  const [matatus, setMatatus] = useState<VehicleRow[]>([])
  const [vehiclesError, setVehiclesError] = useState<string | null>(null)

  const [finance, setFinance] = useState<FinanceOverview | null>(null)
  const [financeError, setFinanceError] = useState<string | null>(null)

  const [saccoRange, setSaccoRange] = useState<'today' | 'week' | 'month'>('month')
  const [saccoSummary, setSaccoSummary] = useState<SaccoSummaryRow[]>([])
  const [saccoSummaryError, setSaccoSummaryError] = useState<string | null>(null)

  const [withdrawStatus, setWithdrawStatus] = useState<string>('')
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([])
  const [withdrawError, setWithdrawError] = useState<string | null>(null)

  const [walletCode, setWalletCode] = useState('')
  const [walletSummary, setWalletSummary] = useState<WalletSummary | null>(null)
  const [walletTx, setWalletTx] = useState<WalletTx[]>([])
  const [walletError, setWalletError] = useState<string | null>(null)

  const [ussd, setUssd] = useState<UssdPool | null>(null)
  const [ussdError, setUssdError] = useState<string | null>(null)

  const [ussdFilter, setUssdFilter] = useState('')

  const [smsFilter, setSmsFilter] = useState<string>('')
  const [smsSearch, setSmsSearch] = useState('')
  const [smsRows, setSmsRows] = useState<SmsRow[]>([])
  const [smsError, setSmsError] = useState<string | null>(null)

  const [routeUsage, setRouteUsage] = useState<RouteUsageRow[]>([])
  const [routeError, setRouteError] = useState<string | null>(null)

  const [routes, setRoutes] = useState<AdminRoute[]>([])
  const [routesError, setRoutesError] = useState<string | null>(null)
  const [routeName, setRouteName] = useState('')
  const [routeSaccoId, setRouteSaccoId] = useState('')
  const [routeEditId, setRouteEditId] = useState<string>('')
  const [routePathText, setRoutePathText] = useState('')
  const [routePathMsg, setRoutePathMsg] = useState('')
  const [routeMapOpen, setRouteMapOpen] = useState(false)
  const leafletLoader = useRef<Promise<any> | null>(null)
  const mapRef = useRef<HTMLDivElement | null>(null)
  const mapInstance = useRef<any>(null)
  const mapLayers = useRef<{ polyline?: any; markers?: any[] }>({})

  const [saccoForm, setSaccoForm] = useState({
    name: '',
    contact_name: '',
    contact_phone: '',
    contact_email: '',
    default_till: '',
  })
  const [saccoMsg, setSaccoMsg] = useState('')

  const [matatuForm, setMatatuForm] = useState({
    plate: '',
    owner: '',
    phone: '',
    till: '',
    sacco: '',
    body: '',
  })
  const [matatuMsg, setMatatuMsg] = useState('')

  const [ussdAssignForm, setUssdAssignForm] = useState({
    prefix: '*001*',
    level: 'MATATU',
    sacco_id: '',
    matatu_id: '',
  })
  const [ussdBindForm, setUssdBindForm] = useState({
    ussd_code: '',
    level: 'MATATU',
    sacco_id: '',
    matatu_id: '',
  })
  const [ussdImportForm, setUssdImportForm] = useState({
    prefix: '*001*',
    raw: '',
  })
  const [ussdMsg, setUssdMsg] = useState('')
  const [ussdImportMsg, setUssdImportMsg] = useState('')
  const [ussdReleaseMsg, setUssdReleaseMsg] = useState('')

  const [paybillForm, setPaybillForm] = useState({
    level: 'MATATU',
    sacco_id: '',
    matatu_id: '',
    paybill_account: '',
    ussd_code: '',
  })
  const [paybillMsg, setPaybillMsg] = useState('')
  const [paybillSearch, setPaybillSearch] = useState('')

  const [logins, setLogins] = useState<AdminLogin[]>([])
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
    role: 'SACCO',
    sacco_id: '',
    matatu_id: '',
  })
  const [loginMsg, setLoginMsg] = useState('')

  const [activeTab, setActiveTab] = useState<SystemTabId>('overview')
  const navigate = useNavigate()
  const location = useLocation()

  const tabs: Array<{ id: SystemTabId; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'registry', label: 'System Registry' },
    { id: 'finance', label: 'Finance' },
    { id: 'saccos', label: 'SACCOs' },
    { id: 'matatu', label: 'Matatu' },
    { id: 'taxis', label: 'Taxis' },
    { id: 'bodabodas', label: 'BodaBodas' },
    { id: 'ussd', label: 'USSD' },
    { id: 'paybill', label: 'Paybill' },
    { id: 'sms', label: 'SMS' },
    { id: 'logins', label: 'Logins' },
    { id: 'routes', label: 'Routes Overview' },
  ]

  const tabFromState = tabs.find((t) => t.id === (location.state as { tab?: string } | null)?.tab)?.id || null

  useEffect(() => {
    if (!tabFromState || tabFromState === 'registry') return
    setActiveTab((prev) => (prev === tabFromState ? prev : tabFromState))
  }, [tabFromState])

  const vehicleTabMeta: Record<VehicleTabKey, { label: string; plural: string; type: VehicleKind }> = {
    matatu: { label: 'Matatu', plural: 'Matatus', type: 'MATATU' },
    taxis: { label: 'Taxi', plural: 'Taxis', type: 'TAXI' },
    bodabodas: { label: 'BodaBoda', plural: 'BodaBodas', type: 'BODABODA' },
  }

  const selectedRoute = useMemo(
    () => routes.find((r) => (r.id || '') === routeEditId) || null,
    [routes, routeEditId],
  )

  const parsedRoutePoints = useMemo<LatLng[]>(() => {
    try {
      const parsed = JSON.parse(routePathText || '[]')
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((p) => {
          if (Array.isArray(p) && p.length >= 2) {
            const lat = Number(p[0])
            const lng = Number(p[1])
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
            return [lat, lng] as LatLng
          }
          return null
        })
        .filter(Boolean) as LatLng[]
    } catch {
      return []
    }
  }, [routePathText])

  const matatuById = useMemo(() => {
    const map = new Map<string, VehicleRow>()
    matatus.forEach((row) => {
      if (row.id) map.set(row.id, row)
    })
    return map
  }, [matatus])

  const saccoById = useMemo(() => {
    const map = new Map<string, SaccoRow>()
    saccos.forEach((row) => {
      const id = row.id || row.sacco_id
      if (id) map.set(id, row)
    })
    return map
  }, [saccos])

  const ussdByMatatuId = useMemo(() => {
    const map = new Map<string, UssdPoolRow>()
    ;(ussd?.allocated || []).forEach((row) => {
      const type = (row.allocated_to_type || '').toUpperCase()
      if (type === 'MATATU' && row.allocated_to_id) {
        map.set(row.allocated_to_id, row)
      }
    })
    return map
  }, [ussd?.allocated])

  const ussdBySaccoId = useMemo(() => {
    const map = new Map<string, UssdPoolRow>()
    ;(ussd?.allocated || []).forEach((row) => {
      const type = (row.allocated_to_type || '').toUpperCase()
      if (type === 'SACCO' && row.allocated_to_id) {
        map.set(row.allocated_to_id, row)
      }
      if (!type && row.sacco_id) {
        map.set(row.sacco_id, row)
      }
    })
    return map
  }, [ussd?.allocated])

  const filteredUssdAvailable = useMemo(() => {
    const rows = ussd?.available || []
    const q = ussdFilter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      `${formatUssdCode(row)} ${row.base || ''} ${row.status || ''}`.toLowerCase().includes(q),
    )
  }, [ussd?.available, ussdFilter])

  const filteredUssdAllocated = useMemo(() => {
    const rows = ussd?.allocated || []
    const q = ussdFilter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      `${formatUssdCode(row)} ${formatUssdOwner(row)} ${row.allocated_to_id || ''} ${row.sacco_id || ''} ${
        row.allocated_to_type || ''
      }`.toLowerCase().includes(q),
    )
  }, [ussd?.allocated, ussdFilter])

  const filteredSmsRows = useMemo(() => {
    const q = smsSearch.trim().toLowerCase()
    if (!q) return smsRows
    return smsRows.filter((row) => {
      const hay = [row.to_phone, row.template_code, row.status, row.error_message, row.id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [smsRows, smsSearch])

  const retryableSmsRows = useMemo(
    () => filteredSmsRows.filter((row) => row.id && (row.status === 'FAILED' || row.status === 'PENDING')),
    [filteredSmsRows],
  )

  const paybillRows = useMemo(() => {
    const rows: Array<{
      type: 'MATATU' | 'SACCO'
      id: string
      label: string
      paybill_account: string
      ussd_code: string
      ussd_assigned_at: string
      parent: string
    }> = []

    matatus.forEach((row) => {
      if (!row.id) return
      const ussdRow = ussdByMatatuId.get(row.id)
      const sacco = row.sacco_id ? saccoById.get(row.sacco_id) : null
      const saccoName = row.sacco_name || sacco?.name || sacco?.sacco_name || row.sacco || ''
      rows.push({
        type: 'MATATU',
        id: row.id,
        label: formatVehicleLabel(row),
        paybill_account: row.till_number || '',
        ussd_code: ussdRow ? formatUssdCode(ussdRow) : '',
        ussd_assigned_at: ussdRow?.allocated_at || '',
        parent: saccoName,
      })
    })

    saccos.forEach((row) => {
      const id = row.id || row.sacco_id
      if (!id) return
      const ussdRow = ussdBySaccoId.get(id)
      rows.push({
        type: 'SACCO',
        id,
        label: row.name || row.sacco_name || id,
        paybill_account: row.default_till || '',
        ussd_code: ussdRow ? formatUssdCode(ussdRow) : '',
        ussd_assigned_at: ussdRow?.allocated_at || '',
        parent: '',
      })
    })

    return rows
  }, [matatus, saccos, saccoById, ussdByMatatuId, ussdBySaccoId])

  const filteredPaybillRows = useMemo(() => {
    const q = paybillSearch.trim().toLowerCase()
    if (!q) return paybillRows
    return paybillRows.filter((row) => {
      const hay = [row.type, row.label, row.id, row.parent, row.paybill_account, row.ussd_code]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [paybillRows, paybillSearch])

  const normalizeVehicleType = (value?: string) => {
    const val = (value || '').toUpperCase()
    if (val === 'BODA' || val === 'BODABODA') return 'BODABODA'
    if (val === 'MATATU') return 'MATATU'
    if (val === 'TAXI') return 'TAXI'
    return val
  }

  const vehiclesFor = (kind: VehicleKind) =>
    matatus.filter((v) => normalizeVehicleType(v.vehicle_type || v.body_type || v.type) === kind)

  async function ensureLeaflet() {
    if (window.L) return window.L
    if (!leafletLoader.current) {
      leafletLoader.current = new Promise((resolve, reject) => {
        // css
        if (!document.querySelector('link[data-leaflet]')) {
          const link = document.createElement('link')
          link.setAttribute('data-leaflet', '1')
          link.rel = 'stylesheet'
          link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
          document.head.appendChild(link)
        }
        // js
        const existing = document.querySelector('script[data-leaflet]')
        if (existing) {
          existing.addEventListener('load', () => resolve(window.L))
          existing.addEventListener('error', () => reject(new Error('Leaflet failed to load')))
          return
        }
        const script = document.createElement('script')
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
        script.async = true
        script.setAttribute('data-leaflet', '1')
        script.onload = () => resolve(window.L)
        script.onerror = () => reject(new Error('Leaflet failed to load'))
        document.body.appendChild(script)
      })
    }
    return leafletLoader.current
  }

  function syncRouteMap() {
    const L = window.L
    if (!L || !mapInstance.current) return
    const map = mapInstance.current
    // clear old layers
    if (mapLayers.current.polyline) {
      map.removeLayer(mapLayers.current.polyline)
    }
    if (mapLayers.current.markers) {
      mapLayers.current.markers.forEach((m: any) => map.removeLayer(m))
    }
    if (parsedRoutePoints.length) {
      mapLayers.current.polyline = L.polyline(parsedRoutePoints, { color: '#2563eb', weight: 4 }).addTo(map)
      mapLayers.current.markers = parsedRoutePoints.map((pt) =>
        L.circleMarker(pt, { radius: 5, color: '#0ea5e9', fillColor: '#0ea5e9', fillOpacity: 0.9 }).addTo(map),
      )
      const bounds = mapLayers.current.polyline.getBounds()
      map.fitBounds(bounds, { padding: [20, 20] })
    } else {
      mapLayers.current.polyline = null
      mapLayers.current.markers = []
    }
  }

  async function loadSaccoSummary(rangeKey: 'today' | 'week' | 'month') {
    const range = getRange(rangeKey)
    setSaccoRange(rangeKey)
    try {
      const rows = await fetchList<SaccoSummaryRow>(
        `/api/admin/platform-saccos-summary?from=${range.from}&to=${range.to}`,
      )
      setSaccoSummary(rows)
      setSaccoSummaryError(null)
    } catch (err) {
      setSaccoSummary([])
      setSaccoSummaryError(err instanceof Error ? err.message : String(err))
    }
  }

  async function loadWithdrawals(status: string, range: { from: string; to: string }) {
    try {
      const q = status ? `&status=${encodeURIComponent(status)}` : ''
      const rows = await fetchList<WithdrawalRow>(
        `/api/admin/withdrawals?from=${range.from}&to=${range.to}${q}`,
      )
      setWithdrawals(rows)
      setWithdrawError(null)
    } catch (err) {
      setWithdrawals([])
      setWithdrawError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    if (!routeMapOpen || !routeEditId) return
    let cancelled = false
    ;(async () => {
      try {
        setRoutePathMsg((m) => (m ? m : 'Loading map...'))
        const L = await ensureLeaflet()
        if (cancelled || !mapRef.current) return
        if (!mapInstance.current) {
          const center = parsedRoutePoints[0] || [-1.286389, 36.817223]
          mapInstance.current = L.map(mapRef.current).setView(center, 12)
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: '&copy; OpenStreetMap',
          }).addTo(mapInstance.current)
          mapInstance.current.on('click', (e: any) => {
            const { lat, lng } = e.latlng || {}
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
            setRoutePathText((txt) => {
              let arr: any[] = []
              try {
                const parsed = JSON.parse(txt || '[]')
                arr = Array.isArray(parsed) ? parsed : []
              } catch {
                arr = []
              }
              arr.push([lat, lng])
              return JSON.stringify(arr, null, 2)
            })
          })
        }
        syncRouteMap()
        setRoutePathMsg((m) => (m?.includes('fail') ? m : 'Map ready (click to add points)'))
      } catch (err) {
        if (!cancelled) {
          setRoutePathMsg(err instanceof Error ? err.message : 'Map failed to load')
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeMapOpen, routeEditId])

  useEffect(() => {
    if (routeMapOpen) syncRouteMap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedRoutePoints])

  useEffect(() => {
    const forcedBody =
      activeTab === 'matatu' ? 'MATATU' : activeTab === 'taxis' ? 'TAXI' : activeTab === 'bodabodas' ? 'BODABODA' : ''
    if (!forcedBody) return
    setMatatuForm((f) => (f.body === forcedBody ? f : { ...f, body: forcedBody }))
  }, [activeTab])

  async function loadWallet(code: string) {
    const clean = code.trim()
    if (!clean) return
    setWalletError(null)
    try {
      const summary = await fetchJson<{ wallet?: WalletSummary }>(`/wallets/${encodeURIComponent(clean)}`)
      const tx = await fetchJson<{ transactions?: WalletTx[]; data?: WalletTx[] }>(
        `/wallets/${encodeURIComponent(clean)}/transactions?limit=50&offset=0`,
      )
      setWalletSummary(summary.wallet || (summary as unknown as WalletSummary))
      setWalletTx(tx.transactions || tx.data || [])
    } catch (err) {
      setWalletSummary(null)
      setWalletTx([])
      setWalletError(err instanceof Error ? err.message : String(err))
    }
  }

  async function loadUssd() {
    try {
      const available = await fetchList<UssdPoolRow>('/api/admin/ussd/pool/available')
      const allocated = await fetchList<UssdPoolRow>('/api/admin/ussd/pool/allocated')
      setUssd({ available, allocated })
      setUssdError(null)
    } catch (err) {
      setUssd(null)
      setUssdError(err instanceof Error ? err.message : String(err))
    }
  }

  async function assignNextUssd() {
    setUssdMsg('Assigning...')
    const payload = {
      prefix: ussdAssignForm.prefix || '*001*',
      level: ussdAssignForm.level,
      sacco_id: ussdAssignForm.level === 'SACCO' ? ussdAssignForm.sacco_id || null : null,
      matatu_id: ussdAssignForm.level === 'MATATU' ? ussdAssignForm.matatu_id || null : null,
    }
    if (!payload.sacco_id && !payload.matatu_id) {
      setUssdMsg('Select a SACCO or Matatu for allocation')
      return
    }
    try {
      await sendJson('/api/admin/ussd/pool/assign-next', 'POST', payload)
      setUssdMsg('Assigned next USSD code')
      await loadUssd()
      await refreshOverview()
    } catch (err) {
      setUssdMsg(err instanceof Error ? err.message : 'Assign failed')
    }
  }

  async function bindUssdCode() {
    setUssdMsg('Binding...')
    const code = ussdBindForm.ussd_code.trim()
    if (!code) {
      setUssdMsg('Enter the USSD code to bind')
      return
    }
    const payload = {
      ussd_code: code,
      level: ussdBindForm.level,
      sacco_id: ussdBindForm.level === 'SACCO' ? ussdBindForm.sacco_id || null : null,
      matatu_id: ussdBindForm.level === 'MATATU' ? ussdBindForm.matatu_id || null : null,
    }
    if (!payload.sacco_id && !payload.matatu_id) {
      setUssdMsg('Select a SACCO or Matatu for allocation')
      return
    }
    try {
      await sendJson('/api/admin/ussd/bind-from-pool', 'POST', payload)
      setUssdMsg('USSD code bound')
      setUssdBindForm((f) => ({ ...f, ussd_code: '' }))
      await loadUssd()
      await refreshOverview()
    } catch (err) {
      setUssdMsg(err instanceof Error ? err.message : 'Bind failed')
    }
  }

  async function releaseUssd(row: UssdPoolRow) {
    if (!row) return
    const code = formatUssdCode(row)
    if (!confirm(`Release ${code} back to the pool?`)) return
    setUssdReleaseMsg('Releasing...')
    try {
      await sendJson('/api/admin/ussd/pool/release', 'POST', {
        id: row.id || null,
        ussd_code: row.full_code || row.code || null,
      })
      setUssdReleaseMsg(`Released ${code}`)
      await loadUssd()
      await refreshOverview()
    } catch (err) {
      setUssdReleaseMsg(err instanceof Error ? err.message : 'Release failed')
    }
  }

  async function importUssdPool() {
    setUssdImportMsg('Importing...')
    const raw = ussdImportForm.raw.trim()
    if (!raw) {
      setUssdImportMsg('Paste USSD codes or base numbers first')
      return
    }
    try {
      const res = await sendJson<{ ok?: boolean; inserted?: number; skipped?: number; errors?: string[] }>(
        '/api/admin/ussd/pool/import',
        'POST',
        {
          prefix: ussdImportForm.prefix || '*001*',
          raw,
        },
      )
      const inserted = res?.inserted ?? 0
      const skipped = res?.skipped ?? 0
      const errCount = res?.errors?.length || 0
      setUssdImportMsg(`Imported ${inserted}, skipped ${skipped}${errCount ? `, errors ${errCount}` : ''}`)
      setUssdImportForm((f) => ({ ...f, raw: '' }))
      await loadUssd()
      await refreshOverview()
    } catch (err) {
      setUssdImportMsg(err instanceof Error ? err.message : 'Import failed')
    }
  }

  function resolveUssdMatch(input: string) {
    const normalized = normalizeUssdInput(input)
    const hasSymbols = /[*#]/.test(normalized)
    const digits = normalized.replace(/\D/g, '')
    if (!normalized) {
      return { normalized: '', digits: '', row: null, source: null, hasSymbols }
    }
    const available = ussd?.available || []
    const allocated = ussd?.allocated || []

    const matches = (row: UssdPoolRow) => {
      const full = row.full_code || row.code || ''
      if (hasSymbols) {
        return full === normalized || row.code === normalized
      }
      if (row.base && digits && row.base === digits) return true
      return false
    }

    const allocatedRow = allocated.find(matches)
    if (allocatedRow) return { normalized, digits, row: allocatedRow, source: 'allocated', hasSymbols }

    const availableRow = available.find(matches)
    if (availableRow) return { normalized, digits, row: availableRow, source: 'available', hasSymbols }

    return { normalized, digits, row: null, source: null, hasSymbols }
  }

  function isSameUssdTarget(row: UssdPoolRow, level: string, targetId: string) {
    const type = (row.allocated_to_type || '').toUpperCase()
    if (level === 'MATATU') {
      return type === 'MATATU' && row.allocated_to_id === targetId
    }
    if (level === 'SACCO') {
      if (type === 'SACCO' && row.allocated_to_id === targetId) return true
      if (!type && row.sacco_id === targetId) return true
    }
    return false
  }

  async function assignPaybill() {
    setPaybillMsg('Saving...')
    const level = paybillForm.level
    const targetId = level === 'MATATU' ? paybillForm.matatu_id : paybillForm.sacco_id
    const paybillAccount = paybillForm.paybill_account.trim()
    const ussdInput = paybillForm.ussd_code.trim()

    if (!targetId) {
      setPaybillMsg(`Select a ${level === 'MATATU' ? 'matatu' : 'SACCO'}`)
      return
    }
    if (!paybillAccount) {
      setPaybillMsg('Enter a paybill account')
      return
    }

    try {
      if (level === 'MATATU') {
        await sendJson('/api/admin/update-matatu', 'POST', { id: targetId, till_number: paybillAccount })
        try {
          const rows = await fetchList<VehicleRow>('/api/admin/matatus')
          setMatatus(rows)
        } catch (err) {
          setVehiclesError(err instanceof Error ? err.message : String(err))
        }
      } else {
        await sendJson('/api/admin/update-sacco', 'POST', { id: targetId, default_till: paybillAccount })
        try {
          const rows = await fetchList<SaccoRow>('/api/admin/saccos')
          setSaccos(rows)
        } catch (err) {
          setSaccosError(err instanceof Error ? err.message : String(err))
        }
      }
    } catch (err) {
      setPaybillMsg(err instanceof Error ? err.message : 'Paybill update failed')
      return
    }

    let msg = 'Paybill account saved'

    if (ussdInput) {
      const match = resolveUssdMatch(ussdInput)
      if (match.row && match.source === 'allocated') {
        if (isSameUssdTarget(match.row, level, targetId)) {
          msg = `${msg}. USSD already linked`
        } else {
          msg = `${msg}. USSD ${formatUssdCode(match.row)} is allocated to ${formatUssdOwner(match.row)}`
          setPaybillMsg(msg)
          return
        }
      } else {
        const fullCode = match.row?.full_code || match.row?.code || (match.hasSymbols ? match.normalized : '')
        if (!fullCode) {
          msg = `${msg}. USSD code not found in pool`
        } else {
          try {
            await sendJson('/api/admin/ussd/bind-from-pool', 'POST', {
              ussd_code: fullCode,
              level,
              sacco_id: level === 'SACCO' ? targetId : null,
              matatu_id: level === 'MATATU' ? targetId : null,
            })
            await loadUssd()
            await refreshOverview()
            msg = `${msg}. USSD linked`
          } catch (err) {
            msg = `${msg}. USSD merge failed: ${err instanceof Error ? err.message : 'Bind failed'}`
          }
        }
      }
    }

    setPaybillMsg(msg)
    setPaybillForm((f) => ({ ...f, ussd_code: '' }))
  }

  async function refreshPaybillData() {
    await loadUssd()
    try {
      const rows = await fetchList<SaccoRow>('/api/admin/saccos')
      setSaccos(rows)
    } catch (err) {
      setSaccosError(err instanceof Error ? err.message : String(err))
    }
    try {
      const rows = await fetchList<VehicleRow>('/api/admin/matatus')
      setMatatus(rows)
    } catch (err) {
      setVehiclesError(err instanceof Error ? err.message : String(err))
    }
  }

  async function loadSms(status: string) {
    try {
      const q = status ? `?status=${encodeURIComponent(status)}` : ''
      const rows = await fetchList<SmsRow>(`/api/admin/sms${q}`)
      setSmsRows(rows)
      setSmsError(null)
    } catch (err) {
      setSmsRows([])
      setSmsError(err instanceof Error ? err.message : String(err))
    }
  }

  async function retrySms(id?: string) {
    if (!id) return
    try {
      await postJson(`/api/admin/sms/${id}/retry`)
      await loadSms(smsFilter)
    } catch (err) {
      setSmsError(err instanceof Error ? err.message : String(err))
    }
  }

  async function retrySmsBatch(rows: SmsRow[]) {
    const ids = rows.map((row) => row.id).filter(Boolean) as string[]
    if (!ids.length) return
    if (!confirm(`Retry ${ids.length} SMS now?`)) return
    setSmsError(null)
    for (const id of ids) {
      try {
        await postJson(`/api/admin/sms/${id}/retry`)
      } catch (err) {
        setSmsError(err instanceof Error ? err.message : String(err))
        break
      }
    }
    await loadSms(smsFilter)
  }

  function exportSmsCsv() {
    const headers: CsvHeader[] = [
      { key: 'to_phone', label: 'To' },
      { key: 'template_code', label: 'Template' },
      { key: 'status', label: 'Status' },
      { key: 'tries', label: 'Tries' },
      { key: 'updated_at', label: 'Updated' },
      { key: 'error_message', label: 'Error' },
      { key: 'id', label: 'ID' },
    ]
    const rows: CsvRow[] = filteredSmsRows.map((row) => ({
      to_phone: row.to_phone || '',
      template_code: row.template_code || '',
      status: row.status || '',
      tries: row.tries ?? '',
      updated_at: row.updated_at || '',
      error_message: row.error_message || '',
      id: row.id || '',
    }))
    const csv = buildCsv(headers, rows)
    downloadFile('sms-log.csv', csv, 'text/csv;charset=utf-8;')
  }

  function exportSmsJson() {
    const rows = filteredSmsRows.map((row) => ({
      id: row.id || null,
      to_phone: row.to_phone || null,
      template_code: row.template_code || null,
      status: row.status || null,
      tries: row.tries ?? null,
      updated_at: row.updated_at || null,
      error_message: row.error_message || null,
    }))
    downloadJson('sms-log.json', rows)
  }

  async function loadRouteUsage() {
    try {
      const rows = await fetchList<RouteUsageRow>('/api/admin/routes/usage-summary')
      setRouteUsage(rows)
      setRouteError(null)
    } catch (err) {
      setRouteUsage([])
      setRouteError(err instanceof Error ? err.message : String(err))
    }
  }

  async function loadRoutes() {
    try {
      const rows = await fetchList<AdminRoute>('/api/admin/routes')
      setRoutes(rows)
      setRoutesError(null)
    } catch (err) {
      setRoutes([])
      setRoutesError(err instanceof Error ? err.message : String(err))
    }
  }

  async function loadLogins() {
    try {
      const rows = await fetchList<AdminLogin>('/api/admin/user-roles/logins')
      setLogins(rows)
      setLoginError(null)
    } catch (err) {
      setLogins([])
      setLoginError(err instanceof Error ? err.message : String(err))
    }
  }

  async function refreshOverview() {
    try {
      const data = await fetchJson<Overview>('/api/admin/system-overview')
      setOverview(data)
      setOverviewError(null)
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    async function bootstrap() {
      void refreshOverview()
      fetchList<SaccoRow>('/api/admin/saccos')
        .then((rows) => setSaccos(rows))
        .catch((err) => setSaccosError(err instanceof Error ? err.message : String(err)))
      fetchList<VehicleRow>('/api/admin/matatus')
        .then((rows) => setMatatus(rows))
        .catch((err) => setVehiclesError(err instanceof Error ? err.message : String(err)))
      Promise.all([
        fetchJson<PlatformTotals>(
          '/api/admin/platform-overview?from=' + getRange('today').from + '&to=' + getRange('today').to,
        ).catch(() => null),
        fetchJson<PlatformTotals>(
          '/api/admin/platform-overview?from=' + getRange('week').from + '&to=' + getRange('week').to,
        ).catch(() => null),
        fetchJson<PlatformTotals>(
          '/api/admin/platform-overview?from=' + getRange('month').from + '&to=' + getRange('month').to,
        ).catch(() => null),
      ])
        .then(([todayTotals, weekTotals, monthTotals]) =>
          setFinance({ today: todayTotals || undefined, week: weekTotals || undefined, month: monthTotals || undefined }),
        )
        .catch((err) => setFinanceError(err instanceof Error ? err.message : String(err)))

      await loadSaccoSummary('month')
      await loadWithdrawals('', getRange('month'))
      await loadUssd()
      await loadSms('')
      await loadRouteUsage()
      await loadRoutes()
      await loadLogins()
    }
    void bootstrap()
  }, [])

  const counts = overview?.counts || {}
  const pool = overview?.ussd_pool || {}

  const renderVehicleTab = (meta: { label: string; plural: string; type: VehicleKind }) => {
    const rows = vehiclesFor(meta.type)
    return (
      <>
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Register {meta.label}</h3>
          <div className="row">
            <input
              className="input"
              placeholder="Plate (KDA123A)"
              value={matatuForm.plate}
              onChange={(e) => setMatatuForm((f) => ({ ...f, plate: e.target.value }))}
            />
            <input
              className="input"
              placeholder="Owner name"
              value={matatuForm.owner}
              onChange={(e) => setMatatuForm((f) => ({ ...f, owner: e.target.value }))}
            />
            <input
              className="input"
              placeholder="Owner phone"
              value={matatuForm.phone}
              onChange={(e) => setMatatuForm((f) => ({ ...f, phone: e.target.value }))}
            />
            <input
              className="input"
              placeholder="Till number"
              value={matatuForm.till}
              onChange={(e) => setMatatuForm((f) => ({ ...f, till: e.target.value }))}
            />
            <select
              value={matatuForm.sacco}
              onChange={(e) => setMatatuForm((f) => ({ ...f, sacco: e.target.value }))}
              style={{ padding: 10 }}
            >
              <option value="">Select SACCO</option>
              {saccos.map((s) => (
                <option key={s.id || s.sacco_id} value={s.id || s.sacco_id || ''}>
                  {s.name || s.sacco_name || s.sacco_id}
                </option>
              ))}
            </select>
            <select value={matatuForm.body} disabled style={{ padding: 10 }}>
              <option value={meta.type}>{meta.label}</option>
            </select>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                setMatatuMsg('Saving...')
                try {
                  await sendJson('/api/admin/register-matatu', 'POST', {
                    number_plate: matatuForm.plate.trim(),
                    owner_name: matatuForm.owner.trim(),
                    owner_phone: matatuForm.phone.trim(),
                    till_number: matatuForm.till.trim(),
                    sacco_id: matatuForm.sacco || null,
                    vehicle_type: matatuForm.body || null,
                  })
                  setMatatuMsg(`${meta.label} registered`)
                  setMatatuForm({ plate: '', owner: '', phone: '', till: '', sacco: '', body: meta.type })
                  await fetchList<VehicleRow>('/api/admin/matatus')
                    .then((rows) => setMatatus(rows))
                    .catch((err) => setVehiclesError(err instanceof Error ? err.message : String(err)))
                } catch (err) {
                  setMatatuMsg(err instanceof Error ? err.message : 'Create failed')
                }
              }}
            >
              Register {meta.label}
            </button>
          </div>
          <div className="muted small">{matatuMsg}</div>
        </section>

        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>{meta.plural}</h3>
            <span className="muted small">
              Showing {rows.length} record{rows.length === 1 ? '' : 's'}
            </span>
          </div>
          {vehiclesError ? <div className="err">Vehicle load error: {vehiclesError}</div> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Owner</th>
                  <th>Phone</th>
                  <th>SACCO</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No vehicles yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((v) => (
                    <tr key={v.id || v.plate || v.registration}>
                      <td>{v.plate || v.number_plate || v.registration || '-'}</td>
                      <td>{v.owner_name || '-'}</td>
                      <td>{v.owner_phone || '-'}</td>
                      <td>{v.sacco_name || v.sacco || '-'}</td>
                      <td>{normalizeVehicleType(v.vehicle_type || v.body_type || v.type) || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </>
    )
  }

  return (
    <DashboardShell title="System Admin" subtitle="React port of the system dashboard" hideNav>
      <nav className="sys-nav" aria-label="System admin sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`sys-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => {
              if (t.id === 'registry') {
                navigate('/system/registry')
                return
              }
              setActiveTab(t.id)
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' ? (
      <section className="card">
        <h3 style={{ margin: '0 0 8px' }}>Platform snapshot</h3>
        {overviewError ? <div className="err">Overview error: {overviewError}</div> : null}
        <div className="grid metrics">
          <div className="metric">
            <div className="k">SACCOs</div>
            <div className="v">{counts.saccos ?? '-'}</div>
          </div>
          <div className="metric">
            <div className="k">Matatus</div>
            <div className="v">{counts.matatus ?? '-'}</div>
          </div>
          <div className="metric">
            <div className="k">Taxis</div>
            <div className="v">{counts.taxis ?? '-'}</div>
          </div>
          <div className="metric">
            <div className="k">BodaBodas</div>
            <div className="v">{counts.bodas ?? '-'}</div>
          </div>
          <div className="metric">
            <div className="k">Transactions today</div>
            <div className="v">{counts.tx_today ?? '-'}</div>
          </div>
          <div className="metric">
            <div className="k">USSD available</div>
            <div className="v">{pool.available ?? '-'}</div>
          </div>
          <div className="metric">
            <div className="k">USSD total</div>
            <div className="v">{pool.total ?? '-'}</div>
          </div>
        </div>
      </section>
      ) : null}

      {activeTab === 'saccos' ? (
        <>
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Register SACCO</h3>
            <div className="row">
              <input
                className="input"
                placeholder="Name"
                value={saccoForm.name}
                onChange={(e) => setSaccoForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Contact name"
                value={saccoForm.contact_name}
                onChange={(e) => setSaccoForm((f) => ({ ...f, contact_name: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Phone"
                value={saccoForm.contact_phone}
                onChange={(e) => setSaccoForm((f) => ({ ...f, contact_phone: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Email"
                value={saccoForm.contact_email}
                onChange={(e) => setSaccoForm((f) => ({ ...f, contact_email: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Default till (optional)"
                value={saccoForm.default_till}
                onChange={(e) => setSaccoForm((f) => ({ ...f, default_till: e.target.value }))}
              />
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  setSaccoMsg('Saving...')
                  try {
                    await sendJson('/api/admin/register-sacco', 'POST', {
                      name: saccoForm.name.trim(),
                      contact_name: saccoForm.contact_name.trim(),
                      contact_phone: saccoForm.contact_phone.trim(),
                      contact_email: saccoForm.contact_email.trim(),
                      default_till: saccoForm.default_till.trim() || null,
                    })
                    setSaccoMsg('SACCO created')
                    setSaccoForm({
                      name: '',
                      contact_name: '',
                      contact_phone: '',
                      contact_email: '',
                      default_till: '',
                    })
                    await fetchList<SaccoRow>('/api/admin/saccos')
                      .then((rows) => setSaccos(rows))
                      .catch((err) => setSaccosError(err instanceof Error ? err.message : String(err)))
                  } catch (err) {
                    setSaccoMsg(err instanceof Error ? err.message : 'Create failed')
                  }
                }}
              >
                Register SACCO
              </button>
            </div>
            <div className="muted small">{saccoMsg}</div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>SACCOs</h3>
              <span className="muted small">
                Showing {saccos.length} record{saccos.length === 1 ? '' : 's'}
              </span>
            </div>
            {saccosError ? <div className="err">SACCO load error: {saccosError}</div> : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {saccos.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No SACCOs yet.
                      </td>
                    </tr>
                  ) : (
                    saccos.map((sacco) => (
                      <tr key={sacco.id || sacco.sacco_id || sacco.email}>
                        <td>{sacco.name || sacco.sacco_name || '-'}</td>
                        <td>{sacco.contact_name || '-'}</td>
                        <td>{sacco.phone || sacco.contact_phone || '-'}</td>
                        <td>{sacco.email || sacco.contact_email || '-'}</td>
                        <td>{sacco.id || sacco.sacco_id || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {activeTab === 'matatu' ? renderVehicleTab(vehicleTabMeta.matatu) : null}
      {activeTab === 'taxis' ? renderVehicleTab(vehicleTabMeta.taxis) : null}
      {activeTab === 'bodabodas' ? renderVehicleTab(vehicleTabMeta.bodabodas) : null}

      {activeTab === 'finance' ? (
        <>
      <section className="card">
        <h3 style={{ marginTop: 0 }}>Finance overview</h3>
        {financeError ? <div className="err">Finance error: {financeError}</div> : null}
        <div className="grid metrics">
          <div className="metric">
            <div className="k">Today gross</div>
            <div className="v">{formatKes(finance?.today?.gross_fares)}</div>
            <div className="muted small">
              Matatu: {formatKes(finance?.today?.matatu_net)} • SACCO: {formatKes(finance?.today?.sacco_fee_income)} •
              TekeTeke: {formatKes(finance?.today?.teketeke_income)}
            </div>
          </div>
          <div className="metric">
            <div className="k">This week gross</div>
            <div className="v">{formatKes(finance?.week?.gross_fares)}</div>
            <div className="muted small">
              Matatu: {formatKes(finance?.week?.matatu_net)} • SACCO: {formatKes(finance?.week?.sacco_fee_income)} •
              TekeTeke: {formatKes(finance?.week?.teketeke_income)}
            </div>
          </div>
          <div className="metric">
            <div className="k">This month gross</div>
            <div className="v">{formatKes(finance?.month?.gross_fares)}</div>
            <div className="muted small">
              Matatu: {formatKes(finance?.month?.matatu_net)} • SACCO: {formatKes(finance?.month?.sacco_fee_income)} •
              TekeTeke: {formatKes(finance?.month?.teketeke_income)}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>SACCO performance</h3>
          <label className="muted small">
            Period:{' '}
            <select
              value={saccoRange}
              onChange={(e) => loadSaccoSummary((e.target.value as 'today' | 'week' | 'month') || 'month')}
            >
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>
          </label>
        </div>
        {saccoSummaryError ? <div className="err">Summary error: {saccoSummaryError}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SACCO</th>
                <th>Matatus</th>
                <th>Gross fares</th>
                <th>Matatu net</th>
                <th>SACCO income</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {saccoSummary.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No rows.
                  </td>
                </tr>
              ) : (
                saccoSummary.map((row) => (
                  <tr key={row.sacco_id || row.sacco_name}>
                    <td>{row.sacco_name || row.sacco_id || '-'}</td>
                    <td>{row.matatus ?? 0}</td>
                    <td>{formatKes(row.gross_fares)}</td>
                    <td>{formatKes(row.matatu_net)}</td>
                    <td>{formatKes(row.sacco_fee_income)}</td>
                    <td>{row.status || 'ACTIVE'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid g2">
        <div className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Withdrawals monitor</h3>
            <label className="muted small">
              Status:{' '}
              <select
                value={withdrawStatus}
                onChange={(e) => {
                  const val = e.target.value
                  setWithdrawStatus(val)
                  loadWithdrawals(val, getRange('month'))
                }}
              >
                <option value="">Any</option>
                <option value="PENDING">Pending</option>
                <option value="PROCESSING">Processing</option>
                <option value="SUCCESS">Success</option>
                <option value="FAILED">Failed</option>
              </select>
            </label>
          </div>
          {withdrawError ? <div className="err">Withdrawals error: {withdrawError}</div> : null}
          <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Matatu/SACCO</th>
                  <th>Phone</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No withdrawals found.
                    </td>
                  </tr>
                ) : (
                  withdrawals.map((row) => (
                    <tr key={row.id || row.created_at}>
                      <td className="mono">{row.created_at ? new Date(row.created_at).toLocaleString() : ''}</td>
                      <td>{row.matatu_plate || row.sacco_name || '-'}</td>
                      <td>{row.phone || ''}</td>
                      <td>{formatKes(row.amount)}</td>
                      <td>{row.status || ''}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3 style={{ margin: '0 0 8px' }}>Wallet inspector</h3>
          <div className="row">
            <input
              className="input"
              placeholder="MAT0021"
              value={walletCode}
              onChange={(e) => setWalletCode(e.target.value)}
              style={{ maxWidth: 200 }}
            />
            <button type="button" className="btn" onClick={() => loadWallet(walletCode)}>
              Inspect
            </button>
          </div>
          {walletError ? <div className="err">{walletError}</div> : null}
          <div className="muted small" style={{ marginTop: 8 }}>
            {walletSummary ? (
              <>
                <strong>{walletSummary.virtual_account_code || 'Wallet'}</strong> — Balance:{' '}
                {formatKes(walletSummary.balance)} ({walletSummary.currency || 'KES'})
              </>
            ) : (
              'No wallet selected yet.'
            )}
          </div>
          <div className="table-wrap" style={{ marginTop: 8, maxHeight: 220, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Balance after</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {walletTx.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No transactions.
                    </td>
                  </tr>
                ) : (
                  walletTx.map((row, idx) => (
                    <tr key={`${row.created_at || ''}-${idx}`}>
                      <td className="mono">{row.created_at ? new Date(row.created_at).toLocaleString() : ''}</td>
                      <td>{row.tx_type || ''}</td>
                      <td>{formatKes(row.amount)}</td>
                      <td>{formatKes(row.balance_after)}</td>
                      <td>{row.source || ''}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
        </>
      ) : null}

      {activeTab === 'ussd' ? (
        <>
      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>USSD allocation</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" type="button" onClick={() => void loadUssd()}>
              Refresh
            </button>
          </div>
        </div>
        {ussdError ? <div className="err">USSD error: {ussdError}</div> : null}
        <div className="grid g2">
          <label className="muted small">
            Prefix
            <input
              className="input"
              value={ussdAssignForm.prefix}
              onChange={(e) => setUssdAssignForm((f) => ({ ...f, prefix: e.target.value }))}
              placeholder="*001*"
            />
          </label>
          <label className="muted small">
            Level
            <select
              value={ussdAssignForm.level}
              onChange={(e) =>
                setUssdAssignForm((f) => ({ ...f, level: e.target.value, sacco_id: '', matatu_id: '' }))
              }
              style={{ padding: 10 }}
            >
              <option value="MATATU">MATATU</option>
              <option value="SACCO">SACCO</option>
            </select>
          </label>
          {ussdAssignForm.level === 'MATATU' ? (
            <label className="muted small">
              Matatu
              <select
                value={ussdAssignForm.matatu_id}
                onChange={(e) => setUssdAssignForm((f) => ({ ...f, matatu_id: e.target.value }))}
                style={{ padding: 10 }}
              >
                <option value="">Select matatu</option>
                {vehiclesFor('MATATU').map((v) => (
                  <option key={v.id || formatVehicleLabel(v)} value={v.id || ''}>
                    {formatVehicleLabel(v)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="muted small">
              SACCO
              <select
                value={ussdAssignForm.sacco_id}
                onChange={(e) => setUssdAssignForm((f) => ({ ...f, sacco_id: e.target.value }))}
                style={{ padding: 10 }}
              >
                <option value="">Select SACCO</option>
                {saccos.map((s) => (
                  <option key={s.id || s.sacco_id} value={s.id || s.sacco_id || ''}>
                    {s.name || s.sacco_name || s.sacco_id}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" type="button" onClick={assignNextUssd}>
            Assign next
          </button>
          <span className="muted small">{ussdMsg}</span>
        </div>
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Bind specific code</h3>
          <button className="btn" type="button" onClick={bindUssdCode}>
            Bind code
          </button>
        </div>
        <div className="grid g2">
          <label className="muted small">
            USSD code
            <input
              className="input"
              value={ussdBindForm.ussd_code}
              onChange={(e) => setUssdBindForm((f) => ({ ...f, ussd_code: e.target.value }))}
              placeholder="*001*11013#"
            />
          </label>
          <label className="muted small">
            Level
            <select
              value={ussdBindForm.level}
              onChange={(e) =>
                setUssdBindForm((f) => ({ ...f, level: e.target.value, sacco_id: '', matatu_id: '' }))
              }
              style={{ padding: 10 }}
            >
              <option value="MATATU">MATATU</option>
              <option value="SACCO">SACCO</option>
            </select>
          </label>
          {ussdBindForm.level === 'MATATU' ? (
            <label className="muted small">
              Matatu
              <select
                value={ussdBindForm.matatu_id}
                onChange={(e) => setUssdBindForm((f) => ({ ...f, matatu_id: e.target.value }))}
                style={{ padding: 10 }}
              >
                <option value="">Select matatu</option>
                {vehiclesFor('MATATU').map((v) => (
                  <option key={v.id || formatVehicleLabel(v)} value={v.id || ''}>
                    {formatVehicleLabel(v)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="muted small">
              SACCO
              <select
                value={ussdBindForm.sacco_id}
                onChange={(e) => setUssdBindForm((f) => ({ ...f, sacco_id: e.target.value }))}
                style={{ padding: 10 }}
              >
                <option value="">Select SACCO</option>
                {saccos.map((s) => (
                  <option key={s.id || s.sacco_id} value={s.id || s.sacco_id || ''}>
                    {s.name || s.sacco_name || s.sacco_id}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Import USSD pool</h3>
          <button className="btn" type="button" onClick={importUssdPool}>
            Import
          </button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            className="input"
            placeholder="Prefix for base numbers"
            value={ussdImportForm.prefix}
            onChange={(e) => setUssdImportForm((f) => ({ ...f, prefix: e.target.value }))}
            style={{ maxWidth: 200 }}
          />
          <span className="muted small">{ussdImportMsg}</span>
        </div>
        <textarea
          className="input"
          style={{ minHeight: 120, width: '100%' }}
          placeholder="Paste USSD codes or base numbers, one per line"
          value={ussdImportForm.raw}
          onChange={(e) => setUssdImportForm((f) => ({ ...f, raw: e.target.value }))}
        />
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>USSD pool</h3>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              placeholder="Search code or allocation"
              value={ussdFilter}
              onChange={(e) => setUssdFilter(e.target.value)}
              style={{ maxWidth: 240 }}
            />
            <span className="muted small">
              Available: {filteredUssdAvailable.length} | Allocated: {filteredUssdAllocated.length}
            </span>
          </div>
        </div>
        {ussdReleaseMsg ? <div className="muted small">{ussdReleaseMsg}</div> : null}
      </section>

      <section className="grid g2">
        <div className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Available codes</h3>
            <span className="muted small">{filteredUssdAvailable.length} available</span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 240 }}>
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredUssdAvailable.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="muted">
                      No available codes.
                    </td>
                  </tr>
                ) : (
                  filteredUssdAvailable.map((row, idx) => (
                    <tr key={row.id || row.full_code || row.code || idx}>
                      <td>{formatUssdCode(row)}</td>
                      <td>{row.status || 'AVAILABLE'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Allocated codes</h3>
            <span className="muted small">{filteredUssdAllocated.length} allocated</span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 240 }}>
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Allocated to</th>
                  <th>Assigned</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredUssdAllocated.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No allocated codes.
                    </td>
                  </tr>
                ) : (
                  filteredUssdAllocated.map((row, idx) => (
                    <tr key={row.id || row.full_code || row.code || idx}>
                      <td>{formatUssdCode(row)}</td>
                      <td>{formatUssdOwner(row)}</td>
                      <td>{row.allocated_at ? new Date(row.allocated_at).toLocaleString() : '-'}</td>
                      <td>
                        <button className="btn ghost" type="button" onClick={() => releaseUssd(row)}>
                          Release
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
        </>
      ) : null}

      {activeTab === 'paybill' ? (
        <>
      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Paybill assignment</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" type="button" onClick={refreshPaybillData}>
              Refresh
            </button>
          </div>
        </div>
        <div className="grid g2">
          <label className="muted small">
            Level
            <select
              value={paybillForm.level}
              onChange={(e) =>
                setPaybillForm((f) => ({
                  ...f,
                  level: e.target.value,
                  sacco_id: '',
                  matatu_id: '',
                  paybill_account: '',
                  ussd_code: '',
                }))
              }
              style={{ padding: 10 }}
            >
              <option value="MATATU">MATATU</option>
              <option value="SACCO">SACCO</option>
            </select>
          </label>
          {paybillForm.level === 'MATATU' ? (
            <label className="muted small">
              Matatu
              <select
                value={paybillForm.matatu_id}
                onChange={(e) => setPaybillForm((f) => ({ ...f, matatu_id: e.target.value }))}
                style={{ padding: 10 }}
              >
                <option value="">Select matatu</option>
                {vehiclesFor('MATATU').map((v) => (
                  <option key={v.id || formatVehicleLabel(v)} value={v.id || ''}>
                    {formatVehicleLabel(v)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="muted small">
              SACCO
              <select
                value={paybillForm.sacco_id}
                onChange={(e) => setPaybillForm((f) => ({ ...f, sacco_id: e.target.value }))}
                style={{ padding: 10 }}
              >
                <option value="">Select SACCO</option>
                {saccos.map((s) => (
                  <option key={s.id || s.sacco_id} value={s.id || s.sacco_id || ''}>
                    {s.name || s.sacco_name || s.sacco_id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="muted small">
            Paybill account
            <input
              className="input"
              value={paybillForm.paybill_account}
              onChange={(e) => setPaybillForm((f) => ({ ...f, paybill_account: e.target.value }))}
              placeholder="Paybill account"
            />
          </label>
          <label className="muted small">
            USSD code (optional)
            <input
              className="input"
              value={paybillForm.ussd_code}
              onChange={(e) => setPaybillForm((f) => ({ ...f, ussd_code: e.target.value }))}
              placeholder="*001*11013#"
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" type="button" onClick={assignPaybill}>
            Save paybill
          </button>
          <span className="muted small">{paybillMsg}</span>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Add a USSD code to bind it from the pool to the same matatu or SACCO.
        </p>
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Paybill accounts</h3>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              placeholder="Search paybill or USSD"
              value={paybillSearch}
              onChange={(e) => setPaybillSearch(e.target.value)}
              style={{ maxWidth: 240 }}
            />
            <span className="muted small">{filteredPaybillRows.length} row(s)</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Entity</th>
                <th>Parent SACCO</th>
                <th>Paybill</th>
                <th>USSD code</th>
                <th>USSD assigned</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {filteredPaybillRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No paybill records found.
                  </td>
                </tr>
              ) : (
                filteredPaybillRows.map((row) => (
                  <tr key={`${row.type}-${row.id}`}>
                    <td>{row.type}</td>
                    <td>{row.label}</td>
                    <td>{row.parent || '-'}</td>
                    <td>{row.paybill_account || '-'}</td>
                    <td>{row.ussd_code || '-'}</td>
                    <td>{row.ussd_assigned_at ? new Date(row.ussd_assigned_at).toLocaleString() : '-'}</td>
                    <td className="mono">{row.id}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
        </>
      ) : null}

      {activeTab === 'sms' ? (
        <>
      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>SMS control</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" type="button" onClick={() => loadSms(smsFilter)}>
              Refresh
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => retrySmsBatch(retryableSmsRows)}
              disabled={retryableSmsRows.length === 0}
            >
              Retry failed/pending{retryableSmsRows.length ? ` (${retryableSmsRows.length})` : ''}
            </button>
            <button className="btn ghost" type="button" onClick={exportSmsCsv}>
              Export CSV
            </button>
            <button className="btn ghost" type="button" onClick={exportSmsJson}>
              Export JSON
            </button>
          </div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label className="muted small">
            Status:{' '}
            <select
              value={smsFilter}
              onChange={(e) => {
                const val = e.target.value
                setSmsFilter(val)
                loadSms(val)
              }}
            >
              <option value="">Any</option>
              <option value="FAILED">Failed</option>
              <option value="PENDING">Pending</option>
              <option value="SUCCESS">Success</option>
            </select>
          </label>
          <input
            className="input"
            placeholder="Search phone, template, error"
            value={smsSearch}
            onChange={(e) => setSmsSearch(e.target.value)}
            style={{ maxWidth: 240 }}
          />
          <span className="muted small">{filteredSmsRows.length} message(s)</span>
        </div>
        {smsError ? <div className="err">SMS error: {smsError}</div> : null}
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <table>
            <thead>
              <tr>
                <th>To</th>
                <th>Template</th>
                <th>Status</th>
                <th>Tries</th>
                <th>Updated</th>
                <th>Error</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredSmsRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No messages.
                  </td>
                </tr>
              ) : (
                filteredSmsRows.map((row) => {
                  const canRetry = row.status === 'FAILED' || row.status === 'PENDING'
                  return (
                    <tr key={row.id || row.updated_at}>
                      <td>{row.to_phone || ''}</td>
                      <td>{row.template_code || ''}</td>
                      <td>{row.status || ''}</td>
                      <td>{row.tries ?? ''}</td>
                      <td>{row.updated_at ? new Date(row.updated_at).toLocaleString() : ''}</td>
                      <td>{row.error_message || ''}</td>
                      <td>
                        {canRetry ? (
                          <button className="btn ghost" type="button" onClick={() => retrySms(row.id)}>
                            Retry
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
        </>
      ) : null}

      {activeTab === 'routes' ? (
        <>
      <section className="card">
        <h3 style={{ marginTop: 0 }}>Routes overview</h3>
        {routeError ? <div className="err">Route error: {routeError}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SACCO</th>
                <th>Routes</th>
                <th>Active</th>
                <th>Total km</th>
                <th>Avg km</th>
              </tr>
            </thead>
            <tbody>
              {routeUsage.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No routes data.
                  </td>
                </tr>
              ) : (
                routeUsage.map((row) => (
                  <tr key={row.sacco_id || row.sacco_name}>
                    <td>{row.sacco_name || row.sacco_id || '-'}</td>
                    <td>{row.routes ?? 0}</td>
                    <td>{row.active_routes ?? 0}</td>
                    <td>{(row.total_distance_km ?? 0).toLocaleString()}</td>
                    <td>{(row.average_distance_km ?? 0).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Routes admin</h3>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              placeholder="Route name"
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              style={{ maxWidth: 200 }}
            />
            <select
              value={routeSaccoId}
              onChange={(e) => setRouteSaccoId(e.target.value)}
              style={{ padding: 10, maxWidth: 220 }}
            >
              <option value="">SACCO (optional)</option>
              {saccos.map((s) => (
                <option key={s.id || s.sacco_id} value={s.id || s.sacco_id || ''}>
                  {s.name || s.sacco_name || s.sacco_id}
                </option>
              ))}
            </select>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                try {
                  await sendJson('/api/admin/routes', 'POST', {
                    name: routeName || 'New Route',
                    sacco_id: routeSaccoId || null,
                  })
                  setRouteName('')
                  setRouteSaccoId('')
                  await loadRoutes()
                  await loadRouteUsage()
                } catch (err) {
                  setRoutesError(err instanceof Error ? err.message : 'Create route failed')
                }
              }}
            >
              Add route
            </button>
          </div>
        </div>
        {routesError ? <div className="err">Routes error: {routesError}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>SACCO</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {routes.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No routes.
                  </td>
                </tr>
              ) : (
                routes.map((r) => (
                  <tr key={r.id || r.name}>
                    <td>{r.name || ''}</td>
                    <td>{r.sacco_id || ''}</td>
                    <td>{r.active ? 'Yes' : 'No'}</td>
                    <td className="row" style={{ gap: 6 }}>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => {
                          const nextId = routeEditId === (r.id || '') ? '' : r.id || ''
                          setRouteEditId(nextId)
                          setRoutePathMsg('')
                          if (nextId) {
                            try {
                              const raw = r.path_points ?? []
                              setRoutePathText(JSON.stringify(raw, null, 2))
                            } catch (err) {
                              console.warn('route path parse', err)
                              setRoutePathText('')
                            }
                          } else {
                            setRoutePathText('')
                          }
                        }}
                      >
                        {routeEditId === (r.id || '') ? 'Close edit' : 'Edit path'}
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={async () => {
                          if (!r.id) return
                          try {
                            await sendJson(`/api/admin/routes/${encodeURIComponent(r.id)}`, 'PATCH', {
                              active: !r.active,
                            })
                            await loadRoutes()
                            await loadRouteUsage()
                          } catch (err) {
                            setRoutesError(err instanceof Error ? err.message : 'Toggle failed')
                          }
                        }}
                      >
                        {r.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={async () => {
                          if (!r.id) return
                          const confirmText = prompt(
                            `Type the route name or ID to delete (${r.name || r.id}). This is irreversible.`,
                            '',
                          )
                          const norm = (confirmText || '').trim().toUpperCase()
                          const expected = ((r.name || r.id || '') as string).trim().toUpperCase()
                          if (!norm || norm !== expected) return
                          try {
                            await deleteJson(`/api/admin/routes/${encodeURIComponent(r.id)}`)
                            await loadRoutes()
                            await loadRouteUsage()
                          } catch (err) {
                            setRoutesError(err instanceof Error ? err.message : 'Delete failed')
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {routeEditId && selectedRoute ? (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="topline">
              <h4 style={{ margin: 0 }}>Edit path: {selectedRoute.name}</h4>
              <span className="muted small">Route ID: {selectedRoute.id}</span>
            </div>
            <p className="muted small">
              Provide an array of [lat,lng] pairs (GeoJSON-like). Example: <code>[[ -1.3, 36.8 ], [ -1.29, 36.82 ]]</code>
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn ghost"
                type="button"
                onClick={() => setRouteMapOpen((v) => !v)}
                title="Optional map helper using Leaflet + OSM tiles"
              >
                {routeMapOpen ? 'Hide map editor' : 'Open map editor (beta)'}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  setRoutePathText(JSON.stringify(parsedRoutePoints.slice(0, -1), null, 2))
                }}
                disabled={parsedRoutePoints.length === 0}
              >
                Undo last point
              </button>
            </div>
            <textarea
              className="input"
              style={{ minHeight: 160, width: '100%', fontFamily: 'SFMono-Regular, Consolas, monospace' }}
              value={routePathText}
              onChange={(e) => setRoutePathText(e.target.value)}
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  setRoutePathMsg('Saving...')
                  try {
                    const parsed = JSON.parse(routePathText || '[]')
                    await sendJson(`/api/admin/routes/${encodeURIComponent(routeEditId)}`, 'PATCH', {
                      path_points: parsed,
                    })
                    setRoutePathMsg('Path saved')
                    await loadRoutes()
                  } catch (err) {
                    setRoutePathMsg(err instanceof Error ? err.message : 'Save failed')
                  }
                }}
            >
              Save path
            </button>
            <button className="btn ghost" type="button" onClick={() => setRouteEditId('')}>
              Cancel
            </button>
            <span className="muted small">{routePathMsg}</span>
          </div>
          {routeMapOpen ? (
            <div className="card" style={{ marginTop: 10 }}>
              <h4 style={{ margin: '0 0 6px' }}>Map editor</h4>
              <p className="muted small" style={{ marginTop: 0 }}>
                Click on the map to add points; they will sync to the JSON above. Uses OSM tiles via Leaflet (loaded from CDN).
              </p>
              <div
                ref={mapRef}
                style={{ width: '100%', height: 360, borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}
              />
            </div>
          ) : null}
          <div className="card" style={{ marginTop: 10, background: '#f8fafc' }}>
            <h4 style={{ margin: '0 0 6px' }}>Path preview</h4>
            {parsedRoutePoints.length < 2 ? (
              <div className="muted small">Add at least two [lat,lng] points to preview.</div>
            ) : (
              <svg viewBox="0 0 600 320" style={{ width: '100%', maxWidth: '100%', height: 'auto', background: '#fff' }}>
                {(() => {
                  const lats = parsedRoutePoints.map((p) => p[0])
                  const lngs = parsedRoutePoints.map((p) => p[1])
                  const minLat = Math.min(...lats)
                  const maxLat = Math.max(...lats)
                  const minLng = Math.min(...lngs)
                  const maxLng = Math.max(...lngs)
                  const pad = 10
                  const w = 600 - pad * 2
                  const h = 320 - pad * 2
                  const latRange = maxLat - minLat || 1
                  const lngRange = maxLng - minLng || 1
                  const pts = parsedRoutePoints
                    .map(([lat, lng]) => {
                      const x = pad + ((lng - minLng) / lngRange) * w
                      const y = pad + (1 - (lat - minLat) / latRange) * h
                      return `${x},${y}`
                    })
                    .join(' ')
                  return (
                    <>
                      <rect x={pad} y={pad} width={w} height={h} fill="#f1f5f9" stroke="#e2e8f0" />
                      <polyline
                        points={pts}
                        fill="none"
                        stroke="#0ea5e9"
                        strokeWidth="3"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      {parsedRoutePoints.map(([lat, lng], idx) => {
                        const x = pad + ((lng - minLng) / lngRange) * w
                        const y = pad + (1 - (lat - minLat) / latRange) * h
                        return <circle key={`${lat}-${lng}-${idx}`} cx={x} cy={y} r={3} fill="#0284c7" />
                      })}
                    </>
                  )
                })()}
              </svg>
            )}
          </div>
        </div>
      ) : null}
    </section>
        </>
      ) : null}

      {activeTab === 'logins' ? (
      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Logins</h3>
          <span className="muted small">{logins.length} login(s)</span>
        </div>
        {loginError ? <div className="err">Logins error: {loginError}</div> : null}
        <div className="row" style={{ marginBottom: 8 }}>
          <input
            className="input"
            placeholder="Email"
            value={loginForm.email}
            onChange={(e) => setLoginForm((f) => ({ ...f, email: e.target.value }))}
          />
          <input
            className="input"
            placeholder="Password"
            type="password"
            value={loginForm.password}
            onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))}
          />
          <select
            value={loginForm.role}
            onChange={(e) => setLoginForm((f) => ({ ...f, role: e.target.value }))}
            style={{ padding: 10 }}
          >
            <option value="SYSTEM_ADMIN">SYSTEM_ADMIN</option>
            <option value="SACCO">SACCO</option>
            <option value="OWNER">OWNER</option>
            <option value="STAFF">STAFF</option>
            <option value="TAXI">TAXI</option>
            <option value="BODA">BODA</option>
            <option value="OPS">OPS</option>
          </select>
          <input
            className="input"
            placeholder="SACCO ID (optional)"
            value={loginForm.sacco_id}
            onChange={(e) => setLoginForm((f) => ({ ...f, sacco_id: e.target.value }))}
          />
          <input
            className="input"
            placeholder="Matatu ID (optional)"
            value={loginForm.matatu_id}
            onChange={(e) => setLoginForm((f) => ({ ...f, matatu_id: e.target.value }))}
          />
          <button
            className="btn"
            type="button"
            onClick={async () => {
              setLoginMsg('Saving...')
              try {
                await sendJson('/api/admin/user-roles/create-user', 'POST', {
                  email: loginForm.email.trim(),
                  password: loginForm.password,
                  role: loginForm.role,
                  sacco_id: loginForm.sacco_id || null,
                  matatu_id: loginForm.matatu_id || null,
                })
                setLoginMsg('Login created')
                setLoginForm({ email: '', password: '', role: 'SACCO', sacco_id: '', matatu_id: '' })
                await loadLogins()
              } catch (err) {
                setLoginMsg(err instanceof Error ? err.message : 'Create failed')
              }
            }}
          >
            Create login
          </button>
        </div>
        <div className="muted small">{loginMsg}</div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>SACCO</th>
                <th>Matatu</th>
                <th>ID</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {logins.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No logins.
                  </td>
                </tr>
              ) : (
                logins.map((row) => (
                  <tr key={row.user_id || row.email}>
                    <td>{row.email || ''}</td>
                    <td>{row.role || ''}</td>
                    <td>{row.sacco_id || ''}</td>
                    <td>{row.matatu_id || ''}</td>
                    <td className="mono">{row.user_id || ''}</td>
                    <td className="row" style={{ gap: 6 }}>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={async () => {
                          if (!row.user_id) return
                          try {
                            await sendJson('/api/admin/user-roles/update', 'POST', {
                              user_id: row.user_id,
                              role: row.role,
                              email: row.email,
                              sacco_id: row.sacco_id || null,
                              matatu_id: row.matatu_id || null,
                            })
                            await loadLogins()
                          } catch (err) {
                            setLoginError(err instanceof Error ? err.message : 'Update failed')
                          }
                        }}
                      >
                        Save
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={async () => {
                          if (!row.user_id) return
                          if (!confirm('Remove this login?')) return
                          try {
                            await deleteJson(`/api/admin/user-roles/${row.user_id}?remove_user=true`)
                            await loadLogins()
                          } catch (err) {
                            setLoginError(err instanceof Error ? err.message : 'Delete failed')
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      {activeTab === 'routes' ? (
      <section className="card">
        <h3 style={{ marginTop: 0 }}>SMS & routes</h3>
        <p className="muted" style={{ marginTop: 6 }}>
          Detailed SMS, route management, and wallet tools are still available in the legacy console at{' '}
          <a href="/public/system/dashboard.html">/public/system/dashboard.html</a>. We will mirror those actions in React next.
        </p>
      </section>
      ) : null}
    </DashboardShell>
  )
}

export default SystemDashboard
