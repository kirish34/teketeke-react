import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import DashboardShell from '../components/DashboardShell'
import { authFetch } from '../lib/auth'
import { defaultOperatorType, getOperatorConfig, normalizeOperatorType, type OperatorType } from '../lib/operatorConfig'
import PayoutHistory from '../pages/PayoutHistory'
import WorkerMonitor from '../pages/WorkerMonitor'

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

type WithdrawalInlineEdit = {
  status?: string
  note?: string
  busy?: boolean
  error?: string
  msg?: string
}

type C2bPaymentRow = {
  id?: string
  mpesa_receipt?: string
  phone_number?: string
  amount?: number
  paybill_number?: string
  account_reference?: string
  transaction_timestamp?: string
  processed?: boolean
  processed_at?: string
}

type C2bActionState = {
  busy?: boolean
  error?: string
  msg?: string
}

type C2bRawState = {
  open?: boolean
  loading?: boolean
  payload?: string
  error?: string
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

type SmsTemplateRow = {
  code?: string
  label?: string
  body?: string
  is_active?: boolean
  updated_at?: string
}

type SmsSettings = {
  sender_id?: string | null
  quiet_hours_start?: string | null
  quiet_hours_end?: string | null
  fee_paid_enabled?: boolean
  fee_failed_enabled?: boolean
  balance_enabled?: boolean
  eod_enabled?: boolean
  payout_paid_enabled?: boolean
  payout_failed_enabled?: boolean
  savings_paid_enabled?: boolean
  savings_balance_enabled?: boolean
  loan_paid_enabled?: boolean
  loan_failed_enabled?: boolean
  loan_balance_enabled?: boolean
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
  | 'c2b'
  | 'payouts'
  | 'worker_monitor'
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
  display_name?: string
  legal_name?: string | null
  registration_no?: string | null
  operator_type?: string | null
  org_type?: string | null
  fee_label?: string | null
  savings_enabled?: boolean | null
  loans_enabled?: boolean | null
  routes_enabled?: boolean | null
  status?: string | null
  contact_account_number?: string | null
  settlement_bank_name?: string | null
  settlement_bank_account_number?: string | null
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
  tlb_number?: string
  till_number?: string
}

type ShuttleOwnerRow = {
  id?: string
  full_name?: string
  id_number?: string
  kra_pin?: string | null
  phone?: string
  email?: string | null
  address?: string | null
  occupation?: string | null
  location?: string | null
  date_of_birth?: string | null
  created_at?: string
}

type ShuttleOperatorRow = {
  id?: string
  display_name?: string | null
  name?: string | null
  sacco_name?: string | null
}

type ShuttleRow = {
  id?: string
  plate?: string
  make?: string | null
  model?: string | null
  year?: number | null
  vehicle_type?: string | null
  vehicle_type_other?: string | null
  seat_capacity?: number | null
  load_capacity_kg?: number | null
  operator_id?: string | null
  tlb_license?: string | null
  till_number?: string | null
  owner_id?: string | null
  created_at?: string
  owner?: ShuttleOwnerRow | null
  operator?: ShuttleOperatorRow | null
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

const WITHDRAW_STATUS_OPTIONS = ['PENDING', 'PROCESSING', 'SENT', 'SUCCESS', 'FAILED']

function parseAmountInput(value: string) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return num
}

function normalizeFeePercentInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const num = Number(trimmed)
  if (!Number.isFinite(num) || num < 0) return null
  if (num === 0) return 0
  return num / 100
}

const operatorTypeOptions: Array<{ value: OperatorType; label: string }> = [
  { value: 'MATATU_SACCO', label: 'Matatu SACCO' },
  { value: 'MATATU_COMPANY', label: 'Matatu Company / Fleet' },
  { value: 'BODA_GROUP', label: 'Boda Boda Group' },
  { value: 'TAXI_FLEET', label: 'Taxi Fleet / Company' },
]

function buildOperatorDefaults(operatorType?: string | null) {
  const normalized = normalizeOperatorType(operatorType)
  const config = getOperatorConfig(normalized)
  return {
    operator_type: normalized,
    fee_label: config.feeLabel,
    routes_enabled: config.showRouteMap,
  }
}

function createOperatorForm(operatorType?: string | null) {
  const defaults = buildOperatorDefaults(operatorType)
  return {
    display_name: '',
    operator_type: defaults.operator_type,
    legal_name: '',
    registration_no: '',
    status: 'ACTIVE',
    contact_name: '',
    contact_phone: '',
    contact_email: '',
    contact_account_number: '',
    default_till: '',
    settlement_method: 'MPESA',
    settlement_bank_name: '',
    settlement_bank_account_number: '',
    fee_label: defaults.fee_label,
    savings_enabled: true,
    loans_enabled: true,
    routes_enabled: defaults.routes_enabled,
    admin_email: '',
    admin_phone: '',
  }
}

const SHUTTLE_TYPE_OPTIONS = [
  { value: 'VAN', label: 'VAN' },
  { value: 'MINIBUS', label: 'MINIBUS' },
  { value: 'BUS', label: 'BUS' },
  { value: 'PICKUP', label: 'PICKUP' },
  { value: 'LORRY', label: 'LORRY' },
  { value: 'OTHER', label: 'OTHER' },
]

const SEAT_CAPACITY_TYPES = new Set(['VAN', 'MINIBUS', 'BUS'])
const LOAD_CAPACITY_TYPES = new Set(['PICKUP', 'LORRY'])

function normalizeShuttleType(value?: string | null) {
  return String(value || '').trim().toUpperCase()
}

function shouldShowSeatCapacity(value?: string | null) {
  const normalized = normalizeShuttleType(value)
  return SEAT_CAPACITY_TYPES.has(normalized)
}

function shouldShowLoadCapacity(value?: string | null) {
  const normalized = normalizeShuttleType(value)
  return LOAD_CAPACITY_TYPES.has(normalized)
}

function createShuttleOwnerForm() {
  return {
    full_name: '',
    id_number: '',
    kra_pin: '',
    phone: '',
    email: '',
    address: '',
    occupation: '',
    location: '',
    date_of_birth: '',
  }
}

function createShuttleForm() {
  return {
    plate: '',
    make: '',
    model: '',
    year: '',
    vehicle_type: '',
    vehicle_type_other: '',
    seat_capacity: '',
    load_capacity_kg: '',
    operator_id: '',
    tlb_license: '',
    till_number: '',
  }
}

function normalizePhoneInput(value: string) {
  return String(value || '').replace(/\s+/g, '')
}

function isValidEmail(value: string) {
  if (!value) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isValidKenyanPhone(value: string) {
  if (!value) return false
  const cleaned = normalizePhoneInput(value)
  return /^(?:\+?254|0)(7\d{8}|1\d{8})$/.test(cleaned)
}

function parseYearInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const num = Number(trimmed)
  if (!Number.isFinite(num)) return null
  return Math.trunc(num)
}

function parsePositiveIntInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const num = Number(trimmed)
  if (!Number.isFinite(num)) return null
  const intVal = Math.trunc(num)
  if (intVal <= 0) return null
  return intVal
}

function formatDateInput(value?: string | null) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function formatOperatorTypeLabel(value?: string | null) {
  const normalized = normalizeOperatorType(value)
  const match = operatorTypeOptions.find((option) => option.value === normalized)
  return match ? match.label : normalized
}

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

const smsSettingsDefaults: SmsSettings = {
  sender_id: '',
  quiet_hours_start: '',
  quiet_hours_end: '',
  fee_paid_enabled: false,
  fee_failed_enabled: true,
  balance_enabled: true,
  eod_enabled: true,
  payout_paid_enabled: false,
  payout_failed_enabled: true,
  savings_paid_enabled: false,
  savings_balance_enabled: true,
  loan_paid_enabled: false,
  loan_failed_enabled: true,
  loan_balance_enabled: true,
}

const smsTemplateHints: Record<string, string> = {
  fee_paid: 'Tokens: plate, amount, ref, balance',
  fee_failed: 'Tokens: plate, amount, reason',
  balance_request: 'Tokens: plate, balance, available, date',
  eod_summary: 'Tokens: plate, collected, fee, savings, loan_paid, payout, balance, date',
  payout_paid: 'Tokens: plate, amount, phone, ref, balance',
  payout_failed: 'Tokens: plate, amount, reason, ref',
  savings_paid: 'Tokens: plate, amount, savings_balance',
  savings_balance: 'Tokens: plate, savings_balance, date',
  loan_paid: 'Tokens: plate, amount, loan_balance',
  loan_failed: 'Tokens: plate, amount, reason',
  loan_balance: 'Tokens: plate, loan_balance, next_due',
}

function ussdDigitalRoot(value: string | number) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return 1 + ((Math.floor(num) - 1) % 9)
}

function ussdTierFromBase(value?: string | number | null) {
  const num = Number(value)
  if (!Number.isFinite(num)) return ''
  if (num >= 1 && num <= 199) return 'A'
  if (num >= 200 && num <= 699) return 'B'
  if (num >= 700 && num <= 999) return 'C'
  return ''
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

  const [c2bRange, setC2bRange] = useState<'today' | 'week' | 'month'>('week')
  const [c2bStatus, setC2bStatus] = useState('')
  const [c2bSearch, setC2bSearch] = useState('')
  const [c2bPage, setC2bPage] = useState(1)
  const [c2bLimit, setC2bLimit] = useState(50)
  const [c2bTotal, setC2bTotal] = useState(0)
  const [c2bRows, setC2bRows] = useState<C2bPaymentRow[]>([])
  const [c2bError, setC2bError] = useState<string | null>(null)
  const [c2bActions, setC2bActions] = useState<Record<string, C2bActionState>>({})
  const [c2bRawState, setC2bRawState] = useState<Record<string, C2bRawState>>({})

  const [walletCode, setWalletCode] = useState('')
  const [walletSummary, setWalletSummary] = useState<WalletSummary | null>(null)
  const [walletTx, setWalletTx] = useState<WalletTx[]>([])
  const [walletError, setWalletError] = useState<string | null>(null)
  const [walletCreditForm, setWalletCreditForm] = useState({
    wallet_code: '',
    amount: '',
    reference: '',
    description: '',
  })
  const [walletCreditMsg, setWalletCreditMsg] = useState('')
  const [walletCreditError, setWalletCreditError] = useState<string | null>(null)
  const [walletB2CForm, setWalletB2CForm] = useState({
    wallet_code: '',
    amount: '',
    phone_number: '',
  })
  const [walletB2CMsg, setWalletB2CMsg] = useState('')
  const [walletB2CError, setWalletB2CError] = useState<string | null>(null)
  const [walletBankForm, setWalletBankForm] = useState({
    wallet_code: '',
    amount: '',
    bank_name: '',
    bank_branch: '',
    bank_account_number: '',
    bank_account_name: '',
    fee_percent: '',
  })
  const [walletBankMsg, setWalletBankMsg] = useState('')
  const [walletBankError, setWalletBankError] = useState<string | null>(null)
  const [withdrawInlineEdits, setWithdrawInlineEdits] = useState<Record<string, WithdrawalInlineEdit>>({})

  const [ussd, setUssd] = useState<UssdPool | null>(null)
  const [ussdError, setUssdError] = useState<string | null>(null)

  const [ussdFilter, setUssdFilter] = useState('')
  const [ussdTierFilter, setUssdTierFilter] = useState('')

  const [smsFilter, setSmsFilter] = useState<string>('')
  const [smsSearch, setSmsSearch] = useState('')
  const [smsRows, setSmsRows] = useState<SmsRow[]>([])
  const [smsError, setSmsError] = useState<string | null>(null)
  const [smsTemplates, setSmsTemplates] = useState<SmsTemplateRow[]>([])
  const [smsTemplatesError, setSmsTemplatesError] = useState<string | null>(null)
  const [smsTemplatesMsg, setSmsTemplatesMsg] = useState('')
  const [smsSettingsForm, setSmsSettingsForm] = useState<SmsSettings>({ ...smsSettingsDefaults })
  const [smsSettingsError, setSmsSettingsError] = useState<string | null>(null)
  const [smsSettingsMsg, setSmsSettingsMsg] = useState('')

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
  const shuttlesTableRef = useRef<HTMLDivElement | null>(null)

  const [saccoForm, setSaccoForm] = useState(() => createOperatorForm(defaultOperatorType))
  const [saccoMsg, setSaccoMsg] = useState('')
  const [saccoEditId, setSaccoEditId] = useState('')
  const [saccoEditForm, setSaccoEditForm] = useState({
    name: '',
    contact_name: '',
    contact_phone: '',
    contact_email: '',
    default_till: '',
  })
  const [saccoEditMsg, setSaccoEditMsg] = useState('')
  const [saccoEditError, setSaccoEditError] = useState<string | null>(null)

  const [shuttles, setShuttles] = useState<ShuttleRow[]>([])
  const [shuttlesError, setShuttlesError] = useState<string | null>(null)
  const [shuttleOwnerForm, setShuttleOwnerForm] = useState(() => createShuttleOwnerForm())
  const [shuttleForm, setShuttleForm] = useState(() => createShuttleForm())
  const [shuttleMsg, setShuttleMsg] = useState('')
  const [shuttleOperatorFilter, setShuttleOperatorFilter] = useState('')
  const [shuttleEditId, setShuttleEditId] = useState('')
  const [shuttleEditOwnerId, setShuttleEditOwnerId] = useState('')
  const [shuttleEditOwnerForm, setShuttleEditOwnerForm] = useState(() => createShuttleOwnerForm())
  const [shuttleEditForm, setShuttleEditForm] = useState(() => createShuttleForm())
  const [shuttleEditMsg, setShuttleEditMsg] = useState('')
  const [shuttleEditError, setShuttleEditError] = useState<string | null>(null)

  const [matatuForm, setMatatuForm] = useState({
    plate: '',
    owner: '',
    phone: '',
    till: '',
    sacco: '',
    body: '',
  })
  const [matatuMsg, setMatatuMsg] = useState('')
  const [vehicleEditId, setVehicleEditId] = useState('')
  const [vehicleEditKind, setVehicleEditKind] = useState<VehicleKind | ''>('')
  const [vehicleEditForm, setVehicleEditForm] = useState({
    number_plate: '',
    owner_name: '',
    owner_phone: '',
    sacco_id: '',
    tlb_number: '',
    till_number: '',
  })
  const [vehicleEditMsg, setVehicleEditMsg] = useState('')
  const [vehicleEditError, setVehicleEditError] = useState<string | null>(null)

  const [ussdAssignForm, setUssdAssignForm] = useState({
    prefix: '',
    tier: '',
    level: 'MATATU',
    sacco_id: '',
    matatu_id: '',
  })
  const [ussdBindForm, setUssdBindForm] = useState({
    mode: 'full',
    ussd_code: '',
    base_code: '',
    level: 'MATATU',
    sacco_id: '',
    matatu_id: '',
  })
  const [ussdImportForm, setUssdImportForm] = useState({
    mode: 'short_full',
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
    { id: 'c2b', label: 'C2B Payments' },
    { id: 'payouts', label: 'B2C Payouts' },
    { id: 'worker_monitor', label: 'Worker Monitor' },
    { id: 'saccos', label: 'Operators' },
    { id: 'matatu', label: 'Shuttles' },
    { id: 'taxis', label: 'Taxis' },
    { id: 'bodabodas', label: 'BodaBodas' },
    { id: 'ussd', label: 'USSD' },
    { id: 'paybill', label: 'Paybill' },
    { id: 'sms', label: 'SMS' },
    { id: 'logins', label: 'Logins' },
    { id: 'routes', label: 'Routes Overview' },
  ]

  const tabFromState = tabs.find((t) => t.id === (location.state as { tab?: string } | null)?.tab)?.id || null
  const tabFromPath =
    location.pathname === '/system/payouts'
      ? 'payouts'
      : location.pathname === '/system/worker-monitor'
        ? 'worker_monitor'
        : null

  useEffect(() => {
    const next = tabFromState || tabFromPath
    if (!next || next === 'registry') return
    setActiveTab((prev) => (prev === next ? prev : next))
  }, [tabFromState, tabFromPath])

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

  const saccoById = useMemo(() => {
    const map = new Map<string, SaccoRow>()
    saccos.forEach((row) => {
      const id = row.id || row.sacco_id
      if (id) map.set(id, row)
    })
    return map
  }, [saccos])

  const operatorOptions = useMemo(() => {
    return saccos
      .map((row) => {
        const id = row.id || row.sacco_id || ''
        if (!id) return null
        const label = row.display_name || row.name || row.sacco_name || row.sacco_id || row.id || id
        return { id, label }
      })
      .filter((option): option is { id: string; label: string } => Boolean(option))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [saccos])

  const shuttleOperatorSummary = useMemo(() => {
    const map = new Map<string, { id: string; label: string; count: number }>()
    shuttles.forEach((row) => {
      const id = row.operator_id || row.operator?.id || ''
      if (!id) return
      const operatorRow = saccoById.get(id)
      const label =
        row.operator?.display_name ||
        row.operator?.name ||
        row.operator?.sacco_name ||
        operatorRow?.display_name ||
        operatorRow?.name ||
        id
      const existing = map.get(id) || { id, label, count: 0 }
      existing.count += 1
      if (label && existing.label !== label) existing.label = label
      map.set(id, existing)
    })
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [shuttles, saccoById])

  const filteredShuttles = useMemo(() => {
    if (!shuttleOperatorFilter) return shuttles
    return shuttles.filter((row) => (row.operator_id || row.operator?.id || '') === shuttleOperatorFilter)
  }, [shuttles, shuttleOperatorFilter])

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
    let rows = ussd?.available || []
    if (ussdTierFilter) {
      rows = rows.filter((row) => ussdTierFromBase(row.base) === ussdTierFilter)
    }
    const q = ussdFilter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      `${formatUssdCode(row)} ${row.base || ''} ${row.status || ''} ${ussdTierFromBase(row.base)}`.toLowerCase().includes(q),
    )
  }, [ussd?.available, ussdFilter, ussdTierFilter])

  const filteredUssdAllocated = useMemo(() => {
    let rows = ussd?.allocated || []
    if (ussdTierFilter) {
      rows = rows.filter((row) => ussdTierFromBase(row.base) === ussdTierFilter)
    }
    const q = ussdFilter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      `${formatUssdCode(row)} ${formatUssdOwner(row)} ${row.allocated_to_id || ''} ${row.sacco_id || ''} ${
        row.allocated_to_type || ''
      } ${ussdTierFromBase(row.base)}`.toLowerCase().includes(q),
    )
  }, [ussd?.allocated, ussdFilter, ussdTierFilter])

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

  const ussdBindBaseValue = useMemo(() => {
    if (ussdBindForm.mode !== 'base') return null
    const digits = String(ussdBindForm.base_code || '').replace(/\D/g, '')
    if (!digits) return null
    const num = Number(digits)
    if (!Number.isFinite(num) || num < 1 || num > 999) return null
    return num
  }, [ussdBindForm.base_code, ussdBindForm.mode])

  const ussdBindCheckDigit = useMemo(() => {
    if (ussdBindBaseValue === null) return null
    return ussdDigitalRoot(ussdBindBaseValue)
  }, [ussdBindBaseValue])

  const ussdBindFullFromBase = useMemo(() => {
    if (ussdBindBaseValue === null || ussdBindCheckDigit === null) return ''
    return `${ussdBindBaseValue}${ussdBindCheckDigit}`
  }, [ussdBindBaseValue, ussdBindCheckDigit])

  const ussdBindTier = useMemo(() => {
    if (ussdBindBaseValue === null) return ''
    return ussdTierFromBase(ussdBindBaseValue)
  }, [ussdBindBaseValue])

  const ussdBindFullMeta = useMemo(() => {
    const raw = ussdBindForm.ussd_code.trim()
    if (!/^\d+$/.test(raw) || raw.length < 2) {
      return { base: '', check: '', expected: null, valid: null }
    }
    const base = raw.slice(0, -1)
    const check = raw.slice(-1)
    const expected = ussdDigitalRoot(base)
    const valid = expected !== null && String(expected) === check
    return { base, check, expected, valid }
  }, [ussdBindForm.ussd_code])

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
      const saccoName =
        row.sacco_name || sacco?.display_name || sacco?.name || sacco?.sacco_name || row.sacco || ''
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
        label: row.display_name || row.name || row.sacco_name || id,
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

  const ussdImportPlaceholder = useMemo(() => {
    if (ussdImportForm.mode === 'legacy') return 'Paste legacy USSD codes, one per line'
    if (ussdImportForm.mode === 'short_base') return 'Paste base codes (1-999), one per line'
    return 'Paste full codes (base + check digit), one per line'
  }, [ussdImportForm.mode])

  const normalizeVehicleType = (value?: string) => {
    const val = (value || '').toUpperCase()
    if (val === 'BODA' || val === 'BODABODA') return 'BODABODA'
    if (val === 'MATATU') return 'MATATU'
    if (val === 'TAXI') return 'TAXI'
    return val
  }

  const vehiclesFor = (kind: VehicleKind) =>
    matatus.filter((v) => normalizeVehicleType(v.vehicle_type || v.body_type || v.type) === kind)

  function startSaccoEdit(row: SaccoRow) {
    const id = row.id || row.sacco_id
    if (!id) return
    if (saccoEditId === id) {
      setSaccoEditId('')
      setSaccoEditMsg('')
      setSaccoEditError(null)
      return
    }
    setSaccoEditId(id)
    setSaccoEditMsg('')
    setSaccoEditError(null)
    setSaccoEditForm({
      name: row.display_name || row.name || row.sacco_name || '',
      contact_name: row.contact_name || '',
      contact_phone: row.contact_phone || row.phone || '',
      contact_email: row.contact_email || row.email || '',
      default_till: row.default_till || '',
    })
  }

  async function saveSaccoEdit() {
    if (!saccoEditId) return
    setSaccoEditMsg('Saving...')
    setSaccoEditError(null)
    try {
      const payload = {
        id: saccoEditId,
        name: saccoEditForm.name.trim(),
        display_name: saccoEditForm.name.trim(),
        contact_name: saccoEditForm.contact_name.trim() || null,
        contact_phone: saccoEditForm.contact_phone.trim() || null,
        contact_email: saccoEditForm.contact_email.trim() || null,
        default_till: saccoEditForm.default_till.trim() || null,
      }
      if (!payload.name) {
        setSaccoEditMsg('Display name is required')
        return
      }
      const data = await sendJson<SaccoRow>('/api/admin/update-sacco', 'POST', payload)
      setSaccoEditMsg('Operator updated')
      setSaccoEditForm({
        name: data.display_name || data.name || payload.name,
        contact_name: data.contact_name || '',
        contact_phone: data.contact_phone || '',
        contact_email: data.contact_email || '',
        default_till: data.default_till || '',
      })
      try {
        const rows = await fetchList<SaccoRow>('/api/admin/saccos')
        setSaccos(rows)
      } catch (err) {
        setSaccosError(err instanceof Error ? err.message : String(err))
      }
    } catch (err) {
      setSaccoEditMsg('')
      setSaccoEditError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  function startVehicleEdit(row: VehicleRow, kind: VehicleKind) {
    const id = row.id
    if (!id) return
    if (vehicleEditId === id && vehicleEditKind === kind) {
      setVehicleEditId('')
      setVehicleEditKind('')
      setVehicleEditMsg('')
      setVehicleEditError(null)
      return
    }
    setVehicleEditId(id)
    setVehicleEditKind(kind)
    setVehicleEditMsg('')
    setVehicleEditError(null)
    setVehicleEditForm({
      number_plate: row.number_plate || row.plate || row.registration || '',
      owner_name: row.owner_name || '',
      owner_phone: row.owner_phone || '',
      sacco_id: row.sacco_id || '',
      tlb_number: row.tlb_number || '',
      till_number: row.till_number || '',
    })
  }

  async function saveVehicleEdit() {
    if (!vehicleEditId) return
    setVehicleEditMsg('Saving...')
    setVehicleEditError(null)
    try {
      const payload = {
        id: vehicleEditId,
        number_plate: vehicleEditForm.number_plate.trim().toUpperCase(),
        owner_name: vehicleEditForm.owner_name.trim() || null,
        owner_phone: vehicleEditForm.owner_phone.trim() || null,
        sacco_id: vehicleEditForm.sacco_id || null,
        tlb_number: vehicleEditForm.tlb_number.trim() || null,
        till_number: vehicleEditForm.till_number.trim() || null,
      }
      if (!payload.number_plate) {
        setVehicleEditMsg('Plate is required')
        return
      }
      if (vehicleEditKind === 'MATATU' && !payload.sacco_id) {
        setVehicleEditMsg('Select a SACCO for this matatu')
        return
      }
      const data = await sendJson<VehicleRow>('/api/admin/update-matatu', 'POST', payload)
      setVehicleEditMsg(`${vehicleEditKind || 'Vehicle'} updated`)
      setVehicleEditForm({
        number_plate: data.number_plate || payload.number_plate,
        owner_name: data.owner_name || '',
        owner_phone: data.owner_phone || '',
        sacco_id: data.sacco_id || payload.sacco_id || '',
        tlb_number: data.tlb_number || '',
        till_number: data.till_number || '',
      })
      try {
        const rows = await fetchList<VehicleRow>('/api/admin/matatus')
        setMatatus(rows)
      } catch (err) {
        setVehiclesError(err instanceof Error ? err.message : String(err))
      }
    } catch (err) {
      setVehicleEditMsg('')
      setVehicleEditError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  function resetShuttleFormState() {
    setShuttleOwnerForm(createShuttleOwnerForm())
    setShuttleForm(createShuttleForm())
  }

  function resetShuttleEditState() {
    setShuttleEditId('')
    setShuttleEditOwnerId('')
    setShuttleEditOwnerForm(createShuttleOwnerForm())
    setShuttleEditForm(createShuttleForm())
    setShuttleEditMsg('')
    setShuttleEditError(null)
  }

  function operatorLabelFor(row?: ShuttleRow | null) {
    if (!row) return '-'
    const operatorId = row.operator_id || row.operator?.id || ''
    const operatorRow = operatorId ? saccoById.get(operatorId) : null
    return (
      row.operator?.display_name ||
      row.operator?.name ||
      row.operator?.sacco_name ||
      operatorRow?.display_name ||
      operatorRow?.name ||
      row.operator_id ||
      '-'
    )
  }

  function startShuttleEdit(row: ShuttleRow) {
    const id = row.id
    if (!id) return
    if (shuttleEditId === id) {
      resetShuttleEditState()
      return
    }
    const owner = row.owner || {}
    setShuttleEditId(id)
    setShuttleEditOwnerId(row.owner_id || row.owner?.id || '')
    setShuttleEditOwnerForm({
      full_name: owner.full_name || '',
      id_number: owner.id_number || '',
      kra_pin: owner.kra_pin || '',
      phone: owner.phone || '',
      email: owner.email || '',
      address: owner.address || '',
      occupation: owner.occupation || '',
      location: owner.location || '',
      date_of_birth: formatDateInput(owner.date_of_birth),
    })
    setShuttleEditForm({
      plate: row.plate || '',
      make: row.make || '',
      model: row.model || '',
      year: row.year ? String(row.year) : '',
      vehicle_type: normalizeShuttleType(row.vehicle_type) || 'MINIBUS',
      vehicle_type_other: row.vehicle_type_other || '',
      seat_capacity: row.seat_capacity ? String(row.seat_capacity) : '',
      load_capacity_kg: row.load_capacity_kg ? String(row.load_capacity_kg) : '',
      operator_id: row.operator_id || row.operator?.id || '',
      tlb_license: row.tlb_license || '',
      till_number: row.till_number || '',
    })
    setShuttleEditMsg('')
    setShuttleEditError(null)
  }

  async function submitShuttle() {
    const ownerPayload = {
      full_name: shuttleOwnerForm.full_name.trim(),
      id_number: shuttleOwnerForm.id_number.trim(),
      kra_pin: shuttleOwnerForm.kra_pin.trim() || null,
      phone: normalizePhoneInput(shuttleOwnerForm.phone),
      email: shuttleOwnerForm.email.trim() || null,
      address: shuttleOwnerForm.address.trim() || null,
      occupation: shuttleOwnerForm.occupation.trim() || null,
      location: shuttleOwnerForm.location.trim() || null,
      date_of_birth: shuttleOwnerForm.date_of_birth || null,
    }
    const vehicleType = normalizeShuttleType(shuttleForm.vehicle_type)
    const seatCapacityInput = shuttleForm.seat_capacity.trim()
    const loadCapacityInput = shuttleForm.load_capacity_kg.trim()
    const seatCapacity = parsePositiveIntInput(seatCapacityInput)
    const loadCapacity = parsePositiveIntInput(loadCapacityInput)
    const shuttlePayload = {
      plate: shuttleForm.plate.trim().toUpperCase(),
      make: shuttleForm.make.trim() || null,
      model: shuttleForm.model.trim() || null,
      year: parseYearInput(shuttleForm.year),
      vehicle_type: vehicleType || null,
      vehicle_type_other: vehicleType === 'OTHER' ? shuttleForm.vehicle_type_other.trim() || null : null,
      seat_capacity: shouldShowSeatCapacity(vehicleType) || vehicleType === 'OTHER' ? seatCapacity : null,
      load_capacity_kg: shouldShowLoadCapacity(vehicleType) || vehicleType === 'OTHER' ? loadCapacity : null,
      operator_id: shuttleForm.operator_id || null,
      tlb_license: shuttleForm.tlb_license.trim() || null,
      till_number: shuttleForm.till_number.trim(),
    }
    if (!ownerPayload.full_name) {
      setShuttleMsg('Owner full name is required')
      return
    }
    if (!ownerPayload.id_number) {
      setShuttleMsg('Owner ID number is required')
      return
    }
    if (!ownerPayload.phone) {
      setShuttleMsg('Owner phone number is required')
      return
    }
    if (!isValidKenyanPhone(ownerPayload.phone)) {
      setShuttleMsg('Enter a valid Kenyan phone number')
      return
    }
    if (!shuttlePayload.plate) {
      setShuttleMsg('Shuttle plate/identifier is required')
      return
    }
    if (!shuttlePayload.operator_id) {
      setShuttleMsg('Operator is required')
      return
    }
    if (!vehicleType) {
      setShuttleMsg('Vehicle type is required')
      return
    }
    if (shouldShowSeatCapacity(vehicleType)) {
      if (!seatCapacity) {
        setShuttleMsg('Seat capacity is required')
        return
      }
    } else if (seatCapacityInput && !seatCapacity) {
      setShuttleMsg('Seat capacity must be a positive integer')
      return
    }
    if (shouldShowLoadCapacity(vehicleType)) {
      if (!loadCapacity) {
        setShuttleMsg('Load capacity is required')
        return
      }
    } else if (loadCapacityInput && !loadCapacity) {
      setShuttleMsg('Load capacity must be a positive integer')
      return
    }
    if (!shuttlePayload.till_number) {
      setShuttleMsg('Till number is required')
      return
    }
    setShuttleMsg('Saving...')
    try {
      await sendJson('/api/admin/register-shuttle', 'POST', {
        owner: ownerPayload,
        shuttle: shuttlePayload,
      })
      setShuttleMsg('Shuttle registered')
      resetShuttleFormState()
      await loadShuttles()
    } catch (err) {
      setShuttleMsg(err instanceof Error ? err.message : 'Create failed')
    }
  }

  async function saveShuttleEdit() {
    if (!shuttleEditId) return
    const ownerPayload = {
      full_name: shuttleEditOwnerForm.full_name.trim(),
      id_number: shuttleEditOwnerForm.id_number.trim(),
      kra_pin: shuttleEditOwnerForm.kra_pin.trim() || null,
      phone: normalizePhoneInput(shuttleEditOwnerForm.phone),
      email: shuttleEditOwnerForm.email.trim() || null,
      address: shuttleEditOwnerForm.address.trim() || null,
      occupation: shuttleEditOwnerForm.occupation.trim() || null,
      location: shuttleEditOwnerForm.location.trim() || null,
      date_of_birth: shuttleEditOwnerForm.date_of_birth || null,
    }
    const vehicleType = normalizeShuttleType(shuttleEditForm.vehicle_type)
    const seatCapacityInput = shuttleEditForm.seat_capacity.trim()
    const loadCapacityInput = shuttleEditForm.load_capacity_kg.trim()
    const seatCapacity = parsePositiveIntInput(seatCapacityInput)
    const loadCapacity = parsePositiveIntInput(loadCapacityInput)
    const shuttlePayload = {
      plate: shuttleEditForm.plate.trim().toUpperCase(),
      make: shuttleEditForm.make.trim() || null,
      model: shuttleEditForm.model.trim() || null,
      year: parseYearInput(shuttleEditForm.year),
      vehicle_type: vehicleType || null,
      vehicle_type_other: vehicleType === 'OTHER' ? shuttleEditForm.vehicle_type_other.trim() || null : null,
      seat_capacity: shouldShowSeatCapacity(vehicleType) || vehicleType === 'OTHER' ? seatCapacity : null,
      load_capacity_kg: shouldShowLoadCapacity(vehicleType) || vehicleType === 'OTHER' ? loadCapacity : null,
      operator_id: shuttleEditForm.operator_id || null,
      tlb_license: shuttleEditForm.tlb_license.trim() || null,
      till_number: shuttleEditForm.till_number.trim(),
    }
    if (!ownerPayload.full_name) {
      setShuttleEditMsg('Owner full name is required')
      return
    }
    if (!ownerPayload.id_number) {
      setShuttleEditMsg('Owner ID number is required')
      return
    }
    if (!ownerPayload.phone) {
      setShuttleEditMsg('Owner phone number is required')
      return
    }
    if (!isValidKenyanPhone(ownerPayload.phone)) {
      setShuttleEditMsg('Enter a valid Kenyan phone number')
      return
    }
    if (!shuttlePayload.plate) {
      setShuttleEditMsg('Shuttle plate/identifier is required')
      return
    }
    if (!shuttlePayload.operator_id) {
      setShuttleEditMsg('Operator is required')
      return
    }
    if (!vehicleType) {
      setShuttleEditMsg('Vehicle type is required')
      return
    }
    if (shouldShowSeatCapacity(vehicleType)) {
      if (!seatCapacity) {
        setShuttleEditMsg('Seat capacity is required')
        return
      }
    } else if (seatCapacityInput && !seatCapacity) {
      setShuttleEditMsg('Seat capacity must be a positive integer')
      return
    }
    if (shouldShowLoadCapacity(vehicleType)) {
      if (!loadCapacity) {
        setShuttleEditMsg('Load capacity is required')
        return
      }
    } else if (loadCapacityInput && !loadCapacity) {
      setShuttleEditMsg('Load capacity must be a positive integer')
      return
    }
    if (!shuttlePayload.till_number) {
      setShuttleEditMsg('Till number is required')
      return
    }
    setShuttleEditMsg('Saving...')
    setShuttleEditError(null)
    try {
      await sendJson('/api/admin/update-shuttle', 'POST', {
        id: shuttleEditId,
        owner_id: shuttleEditOwnerId || null,
        owner: ownerPayload,
        shuttle: shuttlePayload,
      })
      setShuttleEditMsg('Shuttle updated')
      resetShuttleEditState()
      await loadShuttles()
    } catch (err) {
      setShuttleEditMsg('')
      setShuttleEditError(err instanceof Error ? err.message : 'Update failed')
    }
  }

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

  function updateC2bAction(id: string, patch: Partial<C2bActionState>) {
    setC2bActions((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), ...patch },
    }))
  }

  async function loadC2bPayments({
    rangeKey,
    status,
    search,
    page,
    limit,
  }: {
    rangeKey?: 'today' | 'week' | 'month'
    status?: string
    search?: string
    page?: number
    limit?: number
  } = {}) {
    const range = getRange(rangeKey || c2bRange)
    const statusValue = status !== undefined ? status : c2bStatus
    const searchValue = search !== undefined ? search : c2bSearch
    const pageValue = page !== undefined ? page : c2bPage
    const limitValue = limit !== undefined ? limit : c2bLimit
    if (rangeKey) setC2bRange(rangeKey)
    if (status !== undefined) setC2bStatus(statusValue)
    if (search !== undefined) setC2bSearch(searchValue)
    if (page !== undefined) setC2bPage(pageValue)
    if (limit !== undefined) setC2bLimit(limitValue)
    try {
      const params = new URLSearchParams()
      params.set('from', range.from)
      params.set('to', range.to)
      if (statusValue) params.set('status', statusValue)
      if (searchValue.trim()) params.set('q', searchValue.trim())
      params.set('limit', String(limitValue))
      params.set('offset', String(Math.max(0, (pageValue - 1) * limitValue)))
      const res = await fetchJson<{ items?: C2bPaymentRow[]; total?: number }>(
        `/api/admin/c2b-payments?${params.toString()}`,
      )
      setC2bRows(res.items || [])
      setC2bTotal(res.total || 0)
      setC2bError(null)
    } catch (err) {
      setC2bRows([])
      setC2bTotal(0)
      setC2bError(err instanceof Error ? err.message : String(err))
    }
  }

  async function reprocessC2b(row: C2bPaymentRow) {
    const id = row.id || ''
    if (!id) return
    updateC2bAction(id, { busy: true, error: '', msg: '' })
    try {
      const res = await sendJson<{ message?: string }>(
        `/api/admin/c2b-payments/${encodeURIComponent(id)}/reprocess`,
        'POST',
        {},
      )
      updateC2bAction(id, { busy: false, error: '', msg: res?.message || 'Reprocessed' })
      await loadC2bPayments()
    } catch (err) {
      updateC2bAction(id, {
        busy: false,
        error: err instanceof Error ? err.message : 'Reprocess failed',
        msg: '',
      })
    }
  }

  function toggleC2bRaw(id: string) {
    setC2bRawState((prev) => {
      const current = prev[id] || {}
      const open = !current.open
      return { ...prev, [id]: { ...current, open } }
    })
  }

  async function loadC2bRaw(id: string) {
    setC2bRawState((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), loading: true, error: '' },
    }))
    try {
      const res = await fetchJson<{ payload?: unknown }>(`/api/admin/c2b-payments/${encodeURIComponent(id)}/raw`)
      const payload = JSON.stringify(res?.payload ?? null, null, 2)
      setC2bRawState((prev) => ({
        ...prev,
        [id]: { ...(prev[id] || {}), loading: false, payload },
      }))
    } catch (err) {
      setC2bRawState((prev) => ({
        ...prev,
        [id]: {
          ...(prev[id] || {}),
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load payload',
        },
      }))
    }
  }

  function ensureC2bRaw(id: string) {
    const current = c2bRawState[id]
    if (current?.payload || current?.loading) return
    void loadC2bRaw(id)
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

  async function submitWalletCredit() {
    const code = walletCreditForm.wallet_code.trim()
    const amount = parseAmountInput(walletCreditForm.amount)
    if (!code) {
      setWalletCreditError('Wallet code is required')
      setWalletCreditMsg('')
      return
    }
    if (!amount || amount <= 0) {
      setWalletCreditError('Amount must be greater than 0')
      setWalletCreditMsg('')
      return
    }
    setWalletCreditMsg('Crediting wallet...')
    setWalletCreditError(null)
    try {
      const res = await sendJson<{ message?: string }>(
        '/api/admin/wallets/credit',
        'POST',
        {
          virtualAccountCode: code,
          amount,
          source: 'ADMIN_ADJUST',
          sourceRef: walletCreditForm.reference.trim() || null,
          description: walletCreditForm.description.trim() || null,
        },
      )
      setWalletCreditMsg(res?.message || 'Wallet credited')
      setWalletCreditForm((f) => ({ ...f, amount: '' }))
      if (!walletCode.trim() || walletCode.trim().toLowerCase() === code.toLowerCase()) {
        setWalletCode(code)
        await loadWallet(code)
      }
    } catch (err) {
      setWalletCreditError(err instanceof Error ? err.message : 'Credit failed')
      setWalletCreditMsg('')
    }
  }

  async function submitWalletB2C() {
    const code = walletB2CForm.wallet_code.trim()
    const amount = parseAmountInput(walletB2CForm.amount)
    const phone = walletB2CForm.phone_number.trim()
    if (!code) {
      setWalletB2CError('Wallet code is required')
      setWalletB2CMsg('')
      return
    }
    if (!amount || amount <= 0) {
      setWalletB2CError('Amount must be greater than 0')
      setWalletB2CMsg('')
      return
    }
    if (!phone) {
      setWalletB2CError('Phone number is required')
      setWalletB2CMsg('')
      return
    }
    setWalletB2CMsg('Submitting B2C withdrawal...')
    setWalletB2CError(null)
    try {
      const res = await sendJson<{ message?: string }>(
        `/wallets/${encodeURIComponent(code)}/withdraw`,
        'POST',
        { amount, phoneNumber: phone },
      )
      setWalletB2CMsg(res?.message || 'Withdrawal initiated')
      setWalletB2CForm((f) => ({ ...f, amount: '', phone_number: '' }))
      if (!walletCode.trim() || walletCode.trim().toLowerCase() === code.toLowerCase()) {
        setWalletCode(code)
        await loadWallet(code)
      }
      await loadWithdrawals(withdrawStatus, getRange('month'))
    } catch (err) {
      setWalletB2CError(err instanceof Error ? err.message : 'Withdrawal failed')
      setWalletB2CMsg('')
    }
  }

  async function submitWalletBank() {
    const code = walletBankForm.wallet_code.trim()
    const amount = parseAmountInput(walletBankForm.amount)
    const bankName = walletBankForm.bank_name.trim()
    const bankAccountNumber = walletBankForm.bank_account_number.trim()
    const bankAccountName = walletBankForm.bank_account_name.trim()
    const feePercent = normalizeFeePercentInput(walletBankForm.fee_percent)
    if (!code) {
      setWalletBankError('Wallet code is required')
      setWalletBankMsg('')
      return
    }
    if (!amount || amount <= 0) {
      setWalletBankError('Amount must be greater than 0')
      setWalletBankMsg('')
      return
    }
    if (!bankName || !bankAccountNumber || !bankAccountName) {
      setWalletBankError('Bank name, account number, and account name are required')
      setWalletBankMsg('')
      return
    }
    if (walletBankForm.fee_percent.trim() && feePercent === null) {
      setWalletBankError('Fee percent must be a number')
      setWalletBankMsg('')
      return
    }
    setWalletBankMsg('Submitting bank withdrawal...')
    setWalletBankError(null)
    try {
      const payload: Record<string, unknown> = {
        amount,
        bankName,
        bankBranch: walletBankForm.bank_branch.trim() || null,
        bankAccountNumber,
        bankAccountName,
      }
      if (feePercent !== null) payload.feePercent = feePercent
      const res = await sendJson<{ message?: string }>(
        `/wallets/${encodeURIComponent(code)}/withdraw/bank`,
        'POST',
        payload,
      )
      setWalletBankMsg(res?.message || 'Bank withdrawal created')
      setWalletBankForm((f) => ({ ...f, amount: '' }))
      if (!walletCode.trim() || walletCode.trim().toLowerCase() === code.toLowerCase()) {
        setWalletCode(code)
        await loadWallet(code)
      }
      await loadWithdrawals(withdrawStatus, getRange('month'))
    } catch (err) {
      setWalletBankError(err instanceof Error ? err.message : 'Bank withdrawal failed')
      setWalletBankMsg('')
    }
  }

  function updateWithdrawInline(id: string, patch: Partial<WithdrawalInlineEdit>) {
    setWithdrawInlineEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), ...patch },
    }))
  }

  async function submitWithdrawInline(row: WithdrawalRow) {
    const id = row.id || ''
    if (!id) return
    const current = withdrawInlineEdits[id] || {}
    const status = String(current.status || row.status || '').toUpperCase()
    if (!status || !WITHDRAW_STATUS_OPTIONS.includes(status)) {
      updateWithdrawInline(id, { error: 'Invalid status', msg: '' })
      return
    }
    updateWithdrawInline(id, { busy: true, error: '', msg: '' })
    try {
      await sendJson(
        `/api/admin/withdrawals/${encodeURIComponent(id)}/status`,
        'POST',
        { status, internalNote: current.note?.trim() || null },
      )
      updateWithdrawInline(id, { busy: false, error: '', msg: 'Saved' })
      await loadWithdrawals(withdrawStatus, getRange('month'))
    } catch (err) {
      updateWithdrawInline(id, {
        busy: false,
        error: err instanceof Error ? err.message : 'Update failed',
        msg: '',
      })
    }
  }

  function exportC2bCsv() {
    const headers: CsvHeader[] = [
      { key: 'id', label: 'ID' },
      { key: 'mpesa_receipt', label: 'M-Pesa Receipt' },
      { key: 'phone_number', label: 'Phone' },
      { key: 'amount', label: 'Amount' },
      { key: 'paybill_number', label: 'Paybill' },
      { key: 'account_reference', label: 'Account' },
      { key: 'transaction_timestamp', label: 'Transaction Time' },
      { key: 'processed', label: 'Processed' },
      { key: 'processed_at', label: 'Processed At' },
    ]
    const rows: CsvRow[] = c2bRows.map((row) => ({
      id: row.id || '',
      mpesa_receipt: row.mpesa_receipt || '',
      phone_number: row.phone_number || '',
      amount: row.amount ?? 0,
      paybill_number: row.paybill_number || '',
      account_reference: row.account_reference || '',
      transaction_timestamp: row.transaction_timestamp || '',
      processed: row.processed ? 'true' : 'false',
      processed_at: row.processed_at || '',
    }))
    const csv = buildCsv(headers, rows)
    downloadFile('c2b-payments.csv', csv, 'text/csv;charset=utf-8;')
  }

  function exportC2bJson() {
    downloadJson('c2b-payments.json', c2bRows)
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
      prefix: ussdAssignForm.prefix || '',
      tier: ussdAssignForm.tier || null,
      level: ussdAssignForm.level,
      sacco_id: ussdAssignForm.level === 'SACCO' ? ussdAssignForm.sacco_id || null : null,
      matatu_id: ussdAssignForm.level === 'MATATU' ? ussdAssignForm.matatu_id || null : null,
    }
    if (!payload.sacco_id && !payload.matatu_id) {
      setUssdMsg('Select a SACCO or Matatu for allocation')
      return
    }
    try {
      const res = await sendJson<{ success?: boolean; error?: string; ussd_code?: string }>(
        '/api/admin/ussd/pool/assign-next',
        'POST',
        payload,
      )
      if (res?.success === false) {
        setUssdMsg(res.error || 'No available codes')
        return
      }
      setUssdMsg(`Assigned ${res?.ussd_code || 'next USSD code'}`)
      await loadUssd()
      await refreshOverview()
    } catch (err) {
      setUssdMsg(err instanceof Error ? err.message : 'Assign failed')
    }
  }

  async function bindUssdCode() {
    setUssdMsg('Binding...')
    let code = ussdBindForm.ussd_code.trim()
    if (ussdBindForm.mode === 'base') {
      if (ussdBindBaseValue === null || ussdBindCheckDigit === null) {
        setUssdMsg('Enter a base code between 1 and 999')
        return
      }
      if (ussdBindBaseValue < 1 || ussdBindBaseValue > 999) {
        setUssdMsg('Base code must be between 1 and 999')
        return
      }
      code = ussdBindFullFromBase
    } else if (code && /^\d+$/.test(code) && code.length >= 2) {
      const expected = ussdDigitalRoot(code.slice(0, -1))
      const given = code.slice(-1)
      if (expected === null || String(expected) !== given) {
        setUssdMsg('Checksum mismatch for the full code')
        return
      }
    }
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
      setUssdBindForm((f) => ({ ...f, ussd_code: '', base_code: '' }))
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
      const inputMode = ussdImportForm.mode || 'short_full'
      const payload: Record<string, unknown> = {
        raw,
        input_mode: inputMode,
      }
      if (inputMode === 'legacy') {
        payload.prefix = ussdImportForm.prefix || '*001*'
      }
      const res = await sendJson<{ ok?: boolean; inserted?: number; skipped?: number; errors?: string[] }>(
        '/api/admin/ussd/pool/import',
        'POST',
        payload,
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
      if (digits && (full === digits || row.code === digits)) {
        return true
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
    setPaybillForm((f) => ({ ...f, paybill_account: '', ussd_code: '' }))
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

  async function loadSmsSettings() {
    try {
      const data = await fetchJson<{ settings?: SmsSettings | null }>('/api/admin/sms/settings')
      const settings = data?.settings || {}
      setSmsSettingsForm({ ...smsSettingsDefaults, ...settings })
      setSmsSettingsError(null)
    } catch (err) {
      setSmsSettingsError(err instanceof Error ? err.message : String(err))
    }
  }

  async function loadSmsTemplates() {
    try {
      const rows = await fetchList<SmsTemplateRow>('/api/admin/sms/templates')
      setSmsTemplates(rows)
      setSmsTemplatesError(null)
    } catch (err) {
      setSmsTemplates([])
      setSmsTemplatesError(err instanceof Error ? err.message : String(err))
    }
  }

  function updateSmsTemplate(code: string | undefined, patch: Partial<SmsTemplateRow>) {
    if (!code) return
    setSmsTemplates((rows) => rows.map((row) => (row.code === code ? { ...row, ...patch } : row)))
  }

  async function saveSmsSettings() {
    setSmsSettingsMsg('Saving...')
    try {
      const payload = { ...smsSettingsForm }
      const res = await sendJson<{ settings?: SmsSettings }>('/api/admin/sms/settings', 'PATCH', payload)
      setSmsSettingsForm({ ...smsSettingsDefaults, ...(res?.settings || payload) })
      setSmsSettingsMsg('SMS settings saved')
    } catch (err) {
      setSmsSettingsMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function saveSmsTemplate(code?: string) {
    if (!code) return
    const row = smsTemplates.find((item) => item.code === code)
    if (!row) return
    setSmsTemplatesMsg(`Saving ${code}...`)
    try {
      const res = await sendJson<{ template?: SmsTemplateRow }>(
        `/api/admin/sms/templates/${encodeURIComponent(code)}`,
        'PATCH',
        {
          label: row.label || '',
          body: row.body || '',
          is_active: row.is_active ?? true,
        },
      )
      if (res?.template) {
        setSmsTemplates((items) => items.map((item) => (item.code === code ? res.template || item : item)))
      }
      setSmsTemplatesMsg(`Saved ${code}`)
    } catch (err) {
      setSmsTemplatesMsg(err instanceof Error ? err.message : 'Save failed')
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

  async function loadShuttles() {
    try {
      const rows = await fetchList<ShuttleRow>('/api/admin/shuttles')
      setShuttles(rows)
      setShuttlesError(null)
    } catch (err) {
      setShuttles([])
      setShuttlesError(err instanceof Error ? err.message : String(err))
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
      await loadC2bPayments()
      await loadUssd()
      await loadSms('')
      await loadSmsSettings()
      await loadSmsTemplates()
      await loadRouteUsage()
      await loadRoutes()
      await loadShuttles()
      await loadLogins()
    }
    void bootstrap()
  }, [])

  const counts = overview?.counts || {}
  const pool = overview?.ussd_pool || {}

  const renderShuttlesTab = () => {
    const selectedOperatorLabel = shuttleOperatorFilter
      ? shuttleOperatorSummary.find((row) => row.id === shuttleOperatorFilter)?.label ||
        operatorOptions.find((row) => row.id === shuttleOperatorFilter)?.label ||
        shuttleOperatorFilter
      : 'All operators'
    const normalizedType = normalizeShuttleType(shuttleForm.vehicle_type)
    const showSeatCapacity = shouldShowSeatCapacity(normalizedType) || normalizedType === 'OTHER'
    const showLoadCapacity = shouldShowLoadCapacity(normalizedType) || normalizedType === 'OTHER'
    const shuttlesTableColSpan = 12
    return (
      <>
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Register Shuttle</h3>
          <div className="grid g2">
            <div className="card" style={{ margin: 0, boxShadow: 'none' }}>
              <h4 style={{ margin: '0 0 8px' }}>Owner Information</h4>
              <div className="grid g2">
                <label className="muted small">
                  Full name *
                  <input
                    className="input"
                    value={shuttleOwnerForm.full_name}
                    onChange={(e) => setShuttleOwnerForm((f) => ({ ...f, full_name: e.target.value }))}
                    placeholder="Owner full name"
                  />
                </label>
                <label className="muted small">
                  ID number *
                  <input
                    className="input"
                    value={shuttleOwnerForm.id_number}
                    onChange={(e) => setShuttleOwnerForm((f) => ({ ...f, id_number: e.target.value }))}
                    placeholder="National ID"
                  />
                </label>
                <label className="muted small">
                  KRA PIN
                  <input
                    className="input"
                    value={shuttleOwnerForm.kra_pin}
                    onChange={(e) => setShuttleOwnerForm((f) => ({ ...f, kra_pin: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Phone number *
                  <input
                    className="input"
                    value={shuttleOwnerForm.phone}
                    onChange={(e) => setShuttleOwnerForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="07xx..."
                  />
                </label>
                <label className="muted small">
                  Email address
                  <input
                    className="input"
                    value={shuttleOwnerForm.email}
                    onChange={(e) => setShuttleOwnerForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Physical address
                  <input
                    className="input"
                    value={shuttleOwnerForm.address}
                    onChange={(e) => setShuttleOwnerForm((f) => ({ ...f, address: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Occupation
                  <input
                    className="input"
                    value={shuttleOwnerForm.occupation}
                    onChange={(e) => setShuttleOwnerForm((f) => ({ ...f, occupation: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Location (town/area)
                  <input
                    className="input"
                    value={shuttleOwnerForm.location}
                    onChange={(e) => setShuttleOwnerForm((f) => ({ ...f, location: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Date of birth
                  <input
                    className="input"
                    type="date"
                    value={shuttleOwnerForm.date_of_birth}
                    onChange={(e) => setShuttleOwnerForm((f) => ({ ...f, date_of_birth: e.target.value }))}
                  />
                </label>
              </div>
            </div>

            <div className="card" style={{ margin: 0, boxShadow: 'none' }}>
              <h4 style={{ margin: '0 0 8px' }}>Shuttle Information</h4>
              <div className="grid g2">
                <label className="muted small">
                  Plate number / identifier *
                  <input
                    className="input"
                    value={shuttleForm.plate}
                    onChange={(e) => setShuttleForm((f) => ({ ...f, plate: e.target.value }))}
                    placeholder="KDA123A"
                  />
                </label>
                <label className="muted small">
                  Make
                  <input
                    className="input"
                    value={shuttleForm.make}
                    onChange={(e) => setShuttleForm((f) => ({ ...f, make: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Model
                  <input
                    className="input"
                    value={shuttleForm.model}
                    onChange={(e) => setShuttleForm((f) => ({ ...f, model: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Year of manufacture
                  <input
                    className="input"
                    type="number"
                    value={shuttleForm.year}
                    onChange={(e) => setShuttleForm((f) => ({ ...f, year: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Shuttle type / vehicle type *
                  <select
                    value={shuttleForm.vehicle_type}
                    onChange={(e) => {
                      const nextType = e.target.value
                      const normalized = normalizeShuttleType(nextType)
                      setShuttleForm((f) => ({
                        ...f,
                        vehicle_type: nextType,
                        vehicle_type_other: normalized === 'OTHER' ? f.vehicle_type_other : '',
                        seat_capacity: shouldShowSeatCapacity(normalized) || normalized === 'OTHER' ? f.seat_capacity : '',
                        load_capacity_kg:
                          shouldShowLoadCapacity(normalized) || normalized === 'OTHER' ? f.load_capacity_kg : '',
                      }))
                    }}
                    style={{ padding: 10 }}
                  >
                    <option value="">Select type</option>
                    {SHUTTLE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {normalizedType === 'OTHER' ? (
                  <label className="muted small">
                    Other type (optional)
                    <input
                      className="input"
                      value={shuttleForm.vehicle_type_other}
                      onChange={(e) => setShuttleForm((f) => ({ ...f, vehicle_type_other: e.target.value }))}
                      placeholder="Describe type"
                    />
                  </label>
                ) : null}
                {showSeatCapacity ? (
                  <label className="muted small">
                    Seat capacity {shouldShowSeatCapacity(normalizedType) ? '*' : ''}
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={shuttleForm.seat_capacity}
                      onChange={(e) => setShuttleForm((f) => ({ ...f, seat_capacity: e.target.value }))}
                      placeholder="Number of seats"
                    />
                  </label>
                ) : null}
                {showLoadCapacity ? (
                  <label className="muted small">
                    Load capacity (kg) {shouldShowLoadCapacity(normalizedType) ? '*' : ''}
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={shuttleForm.load_capacity_kg}
                      onChange={(e) => setShuttleForm((f) => ({ ...f, load_capacity_kg: e.target.value }))}
                      placeholder="Weight in kg"
                    />
                  </label>
                ) : null}
                <label className="muted small">
                  Operator *
                  <select
                    value={shuttleForm.operator_id}
                    onChange={(e) => setShuttleForm((f) => ({ ...f, operator_id: e.target.value }))}
                    style={{ padding: 10 }}
                  >
                    <option value="">Select operator</option>
                    {operatorOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="muted small">
                  TLB / License number
                  <input
                    className="input"
                    value={shuttleForm.tlb_license}
                    onChange={(e) => setShuttleForm((f) => ({ ...f, tlb_license: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Till number *
                  <input
                    className="input"
                    value={shuttleForm.till_number}
                    onChange={(e) => setShuttleForm((f) => ({ ...f, till_number: e.target.value }))}
                    placeholder="Till or paybill"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" type="button" onClick={submitShuttle}>
              Register Shuttle
            </button>
            <span className="muted small">{shuttleMsg}</span>
          </div>
        </section>

        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Shuttles</h3>
            {shuttleOperatorFilter ? (
              <button
                className="btn ghost"
                type="button"
                onClick={() => setShuttleOperatorFilter('')}
              >
                Clear filter
              </button>
            ) : null}
          </div>
          {shuttlesError ? <div className="err">Shuttles load error: {shuttlesError}</div> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Operator</th>
                  <th>Number of shuttles</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {shuttleOperatorSummary.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No shuttles registered yet.
                    </td>
                  </tr>
                ) : (
                  shuttleOperatorSummary.map((row) => (
                    <tr key={row.id}>
                      <td>{row.label}</td>
                      <td>{row.count}</td>
                      <td>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => {
                            setShuttleOperatorFilter(row.id)
                            requestAnimationFrame(() => {
                              shuttlesTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                            })
                          }}
                          disabled={shuttleOperatorFilter === row.id}
                        >
                          {shuttleOperatorFilter === row.id ? 'Viewing' : 'View'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" ref={shuttlesTableRef}>
          <div className="topline">
            <h3 style={{ margin: 0 }}>{shuttleOperatorFilter ? `Shuttles • ${selectedOperatorLabel}` : 'Shuttles'}</h3>
            <span className="muted small">
              Showing {filteredShuttles.length} record{filteredShuttles.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Owner name</th>
                  <th>Owner phone</th>
                  <th>Make</th>
                  <th>Model</th>
                  <th>Year</th>
                  <th>Type</th>
                  <th>Capacity</th>
                  <th>Operator</th>
                  <th>TLB/License</th>
                  <th>Till</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredShuttles.length === 0 ? (
                  <tr>
                    <td colSpan={shuttlesTableColSpan} className="muted">
                      No shuttles found.
                    </td>
                  </tr>
                ) : (
                  filteredShuttles.map((row) => {
                    const isEditing = shuttleEditId && row.id === shuttleEditId
                    const rowType = normalizeShuttleType(row.vehicle_type) || 'MINIBUS'
                    const rowTypeLabel =
                      rowType === 'OTHER' ? `OTHER${row.vehicle_type_other ? ` (${row.vehicle_type_other})` : ''}` : rowType
                    // TODO: Use capacity data for fleet analysis, revenue per seat/kg, utilization, and operator comparisons.
                    const capacityLabel = row.seat_capacity
                      ? `${row.seat_capacity} seats`
                      : row.load_capacity_kg
                        ? `${row.load_capacity_kg} kg`
                        : '-'
                    const editType = normalizeShuttleType(shuttleEditForm.vehicle_type)
                    const showSeatEdit = shouldShowSeatCapacity(editType) || editType === 'OTHER'
                    const showLoadEdit = shouldShowLoadCapacity(editType) || editType === 'OTHER'
                    return (
                      <Fragment key={row.id || row.plate}>
                        <tr>
                          <td>{row.plate || '-'}</td>
                          <td>{row.owner?.full_name || '-'}</td>
                          <td>{row.owner?.phone || '-'}</td>
                          <td>{row.make || '-'}</td>
                          <td>{row.model || '-'}</td>
                          <td>{row.year || '-'}</td>
                          <td>{rowTypeLabel}</td>
                          <td>{capacityLabel}</td>
                          <td>{operatorLabelFor(row)}</td>
                          <td>{row.tlb_license || '-'}</td>
                          <td>{row.till_number || '-'}</td>
                          <td>
                            <button className="btn ghost" type="button" onClick={() => startShuttleEdit(row)}>
                              {isEditing ? 'Close' : 'Edit'}
                            </button>
                          </td>
                        </tr>
                        {isEditing ? (
                          <tr>
                            <td colSpan={shuttlesTableColSpan}>
                              <div className="card" style={{ margin: '6px 0' }}>
                                <div className="topline">
                                  <h3 style={{ margin: 0 }}>Edit shuttle</h3>
                                  <span className="muted small">{row.plate || row.id}</span>
                                </div>
                                {shuttleEditError ? <div className="err">Update error: {shuttleEditError}</div> : null}
                                <div className="grid g2">
                                  <div>
                                    <h4 style={{ margin: '6px 0' }}>Owner Information</h4>
                                    <div className="grid g2">
                                      <label className="muted small">
                                        Full name *
                                        <input
                                          className="input"
                                          value={shuttleEditOwnerForm.full_name}
                                          onChange={(e) =>
                                            setShuttleEditOwnerForm((f) => ({ ...f, full_name: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        ID number *
                                        <input
                                          className="input"
                                          value={shuttleEditOwnerForm.id_number}
                                          onChange={(e) =>
                                            setShuttleEditOwnerForm((f) => ({ ...f, id_number: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        KRA PIN
                                        <input
                                          className="input"
                                          value={shuttleEditOwnerForm.kra_pin}
                                          onChange={(e) =>
                                            setShuttleEditOwnerForm((f) => ({ ...f, kra_pin: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Phone number *
                                        <input
                                          className="input"
                                          value={shuttleEditOwnerForm.phone}
                                          onChange={(e) =>
                                            setShuttleEditOwnerForm((f) => ({ ...f, phone: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Email address
                                        <input
                                          className="input"
                                          value={shuttleEditOwnerForm.email}
                                          onChange={(e) =>
                                            setShuttleEditOwnerForm((f) => ({ ...f, email: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Physical address
                                        <input
                                          className="input"
                                          value={shuttleEditOwnerForm.address}
                                          onChange={(e) =>
                                            setShuttleEditOwnerForm((f) => ({ ...f, address: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Occupation
                                        <input
                                          className="input"
                                          value={shuttleEditOwnerForm.occupation}
                                          onChange={(e) =>
                                            setShuttleEditOwnerForm((f) => ({ ...f, occupation: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Location
                                        <input
                                          className="input"
                                          value={shuttleEditOwnerForm.location}
                                          onChange={(e) =>
                                            setShuttleEditOwnerForm((f) => ({ ...f, location: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Date of birth
                                        <input
                                          className="input"
                                          type="date"
                                          value={shuttleEditOwnerForm.date_of_birth}
                                          onChange={(e) =>
                                            setShuttleEditOwnerForm((f) => ({
                                              ...f,
                                              date_of_birth: e.target.value,
                                            }))
                                          }
                                        />
                                      </label>
                                    </div>
                                  </div>

                                  <div>
                                    <h4 style={{ margin: '6px 0' }}>Shuttle Information</h4>
                                    <div className="grid g2">
                                      <label className="muted small">
                                        Plate *
                                        <input
                                          className="input"
                                          value={shuttleEditForm.plate}
                                          onChange={(e) =>
                                            setShuttleEditForm((f) => ({ ...f, plate: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Make
                                        <input
                                          className="input"
                                          value={shuttleEditForm.make}
                                          onChange={(e) =>
                                            setShuttleEditForm((f) => ({ ...f, make: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Model
                                        <input
                                          className="input"
                                          value={shuttleEditForm.model}
                                          onChange={(e) =>
                                            setShuttleEditForm((f) => ({ ...f, model: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Year
                                        <input
                                          className="input"
                                          type="number"
                                          value={shuttleEditForm.year}
                                          onChange={(e) =>
                                            setShuttleEditForm((f) => ({ ...f, year: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Shuttle type / vehicle type *
                                        <select
                                          value={shuttleEditForm.vehicle_type}
                                          onChange={(e) => {
                                            const nextType = e.target.value
                                            const normalized = normalizeShuttleType(nextType)
                                            setShuttleEditForm((f) => ({
                                              ...f,
                                              vehicle_type: nextType,
                                              vehicle_type_other: normalized === 'OTHER' ? f.vehicle_type_other : '',
                                              seat_capacity:
                                                shouldShowSeatCapacity(normalized) || normalized === 'OTHER'
                                                  ? f.seat_capacity
                                                  : '',
                                              load_capacity_kg:
                                                shouldShowLoadCapacity(normalized) || normalized === 'OTHER'
                                                  ? f.load_capacity_kg
                                                  : '',
                                            }))
                                          }}
                                          style={{ padding: 10 }}
                                        >
                                          <option value="">Select type</option>
                                          {SHUTTLE_TYPE_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                              {option.label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                      {editType === 'OTHER' ? (
                                        <label className="muted small">
                                          Other type (optional)
                                          <input
                                            className="input"
                                            value={shuttleEditForm.vehicle_type_other}
                                            onChange={(e) =>
                                              setShuttleEditForm((f) => ({
                                                ...f,
                                                vehicle_type_other: e.target.value,
                                              }))
                                            }
                                          />
                                        </label>
                                      ) : null}
                                      {showSeatEdit ? (
                                        <label className="muted small">
                                          Seat capacity {shouldShowSeatCapacity(editType) ? '*' : ''}
                                          <input
                                            className="input"
                                            type="number"
                                            min={1}
                                            value={shuttleEditForm.seat_capacity}
                                            onChange={(e) =>
                                              setShuttleEditForm((f) => ({ ...f, seat_capacity: e.target.value }))
                                            }
                                          />
                                        </label>
                                      ) : null}
                                      {showLoadEdit ? (
                                        <label className="muted small">
                                          Load capacity (kg) {shouldShowLoadCapacity(editType) ? '*' : ''}
                                          <input
                                            className="input"
                                            type="number"
                                            min={1}
                                            value={shuttleEditForm.load_capacity_kg}
                                            onChange={(e) =>
                                              setShuttleEditForm((f) => ({ ...f, load_capacity_kg: e.target.value }))
                                            }
                                          />
                                        </label>
                                      ) : null}
                                      <label className="muted small">
                                        Operator *
                                        <select
                                          value={shuttleEditForm.operator_id}
                                          onChange={(e) =>
                                            setShuttleEditForm((f) => ({ ...f, operator_id: e.target.value }))
                                          }
                                          style={{ padding: 10 }}
                                        >
                                          <option value="">Select operator</option>
                                          {operatorOptions.map((option) => (
                                            <option key={option.id} value={option.id}>
                                              {option.label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                      <label className="muted small">
                                        TLB / License number
                                        <input
                                          className="input"
                                          value={shuttleEditForm.tlb_license}
                                          onChange={(e) =>
                                            setShuttleEditForm((f) => ({ ...f, tlb_license: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Till number *
                                        <input
                                          className="input"
                                          value={shuttleEditForm.till_number}
                                          onChange={(e) =>
                                            setShuttleEditForm((f) => ({ ...f, till_number: e.target.value }))
                                          }
                                        />
                                      </label>
                                    </div>
                                  </div>
                                </div>
                                <div className="row" style={{ marginTop: 8 }}>
                                  <button className="btn" type="button" onClick={saveShuttleEdit}>
                                    Save changes
                                  </button>
                                  <button className="btn ghost" type="button" onClick={resetShuttleEditState}>
                                    Close
                                  </button>
                                  <span className="muted small">{shuttleEditMsg}</span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </>
    )
  }

  const renderVehicleTab = (meta: { label: string; plural: string; type: VehicleKind }) => {
    const rows = vehiclesFor(meta.type)
    const editActive = vehicleEditId && vehicleEditKind === meta.type
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
                  {s.display_name || s.name || s.sacco_name || s.sacco_id}
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
                  const msg = err instanceof Error ? err.message : 'Create failed'
                  if (/created but wallet failed/i.test(msg)) {
                    setMatatuMsg(msg)
                    setMatatuForm({ plate: '', owner: '', phone: '', till: '', sacco: '', body: meta.type })
                    await fetchList<VehicleRow>('/api/admin/matatus')
                      .then((rows) => setMatatus(rows))
                      .catch((loadErr) => setVehiclesError(loadErr instanceof Error ? loadErr.message : String(loadErr)))
                    return
                  }
                  setMatatuMsg(msg)
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No vehicles yet.
                    </td>
                  </tr>
                  ) : (
                  rows.map((v) => {
                    const isEditing = !!v.id && editActive && v.id === vehicleEditId
                    return (
                      <Fragment key={v.id || v.plate || v.registration}>
                        <tr>
                          <td>{v.plate || v.number_plate || v.registration || '-'}</td>
                          <td>{v.owner_name || '-'}</td>
                          <td>{v.owner_phone || '-'}</td>
                          <td>{v.sacco_name || v.sacco || '-'}</td>
                          <td>{normalizeVehicleType(v.vehicle_type || v.body_type || v.type) || '-'}</td>
                          <td>
                            <button className="btn ghost" type="button" onClick={() => startVehicleEdit(v, meta.type)}>
                              {isEditing ? 'Close' : 'Edit'}
                            </button>
                          </td>
                        </tr>
                        {isEditing ? (
                          <tr>
                            <td colSpan={6}>
                              <div className="card" style={{ margin: '6px 0' }}>
                                <div className="topline">
                                  <h3 style={{ margin: 0 }}>Edit {meta.label}</h3>
                                  <span className="muted small">
                                    {formatVehicleLabel(v)} | ID: {vehicleEditId}
                                  </span>
                                </div>
                                {vehicleEditError ? <div className="err">Update error: {vehicleEditError}</div> : null}
                                <div className="grid g2">
                                  <label className="muted small">
                                    Plate
                                    <input
                                      className="input"
                                      value={vehicleEditForm.number_plate}
                                      onChange={(e) => setVehicleEditForm((f) => ({ ...f, number_plate: e.target.value }))}
                                    />
                                  </label>
                                  <label className="muted small">
                                    Owner name
                                    <input
                                      className="input"
                                      value={vehicleEditForm.owner_name}
                                      onChange={(e) => setVehicleEditForm((f) => ({ ...f, owner_name: e.target.value }))}
                                    />
                                  </label>
                                  <label className="muted small">
                                    Owner phone
                                    <input
                                      className="input"
                                      value={vehicleEditForm.owner_phone}
                                      onChange={(e) => setVehicleEditForm((f) => ({ ...f, owner_phone: e.target.value }))}
                                    />
                                  </label>
                                  <label className="muted small">
                                    {meta.type === 'MATATU' ? 'SACCO' : 'SACCO (optional)'}
                                    <select
                                      value={vehicleEditForm.sacco_id}
                                      onChange={(e) => setVehicleEditForm((f) => ({ ...f, sacco_id: e.target.value }))}
                                      style={{ padding: 10 }}
                                    >
                                      <option value="">Select SACCO</option>
                                      {saccos.map((s) => (
                                        <option key={s.id || s.sacco_id} value={s.id || s.sacco_id || ''}>
                                          {s.display_name || s.name || s.sacco_name || s.sacco_id}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="muted small">
                                    TLB number
                                    <input
                                      className="input"
                                      value={vehicleEditForm.tlb_number}
                                      onChange={(e) => setVehicleEditForm((f) => ({ ...f, tlb_number: e.target.value }))}
                                    />
                                  </label>
                                  <label className="muted small">
                                    Till number
                                    <input
                                      className="input"
                                      value={vehicleEditForm.till_number}
                                      onChange={(e) => setVehicleEditForm((f) => ({ ...f, till_number: e.target.value }))}
                                    />
                                  </label>
                                </div>
                                <div className="row" style={{ marginTop: 8 }}>
                                  <button className="btn" type="button" onClick={saveVehicleEdit}>
                                    Save changes
                                  </button>
                                  <button
                                    className="btn ghost"
                                    type="button"
                                    onClick={() => {
                                      setVehicleEditId('')
                                      setVehicleEditKind('')
                                      setVehicleEditMsg('')
                                      setVehicleEditError(null)
                                    }}
                                  >
                                    Close
                                  </button>
                                  <span className="muted small">{vehicleEditMsg}</span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })
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
            <h3 style={{ marginTop: 0 }}>Register Operator</h3>

            <h4 style={{ margin: '10px 0 6px' }}>Operator basic details</h4>
            <div className="grid g2">
              <label className="muted small">
                Operator display name
                <input
                  className="input"
                  value={saccoForm.display_name}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, display_name: e.target.value }))}
                  placeholder="e.g., Metro Fleet"
                />
              </label>
              <label className="muted small">
                Operator type
                <select
                  value={saccoForm.operator_type}
                  onChange={(e) => {
                    const nextType = e.target.value as OperatorType
                    const defaults = buildOperatorDefaults(nextType)
                    setSaccoForm((f) => ({
                      ...f,
                      operator_type: defaults.operator_type,
                      fee_label: defaults.fee_label,
                      routes_enabled: defaults.routes_enabled,
                    }))
                  }}
                >
                  {operatorTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="muted small">
                Legal name (optional)
                <input
                  className="input"
                  value={saccoForm.legal_name}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, legal_name: e.target.value }))}
                  placeholder="Registered legal name"
                />
              </label>
              <label className="muted small">
                Registration number (optional)
                <input
                  className="input"
                  value={saccoForm.registration_no}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, registration_no: e.target.value }))}
                  placeholder="Company/SACCO reg no"
                />
              </label>
              <label className="muted small">
                Status
                <select
                  value={saccoForm.status}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                </select>
              </label>
            </div>

            <h4 style={{ margin: '16px 0 6px' }}>Contact &amp; settlement</h4>
            <div className="grid g2">
              <label className="muted small">
                Contact person name
                <input
                  className="input"
                  value={saccoForm.contact_name}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, contact_name: e.target.value }))}
                  placeholder="Contact person"
                />
              </label>
              <label className="muted small">
                Official phone number
                <input
                  className="input"
                  value={saccoForm.contact_phone}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, contact_phone: e.target.value }))}
                  placeholder="07xx..."
                />
              </label>
              <label className="muted small">
                Official email
                <input
                  className="input"
                  value={saccoForm.contact_email}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, contact_email: e.target.value }))}
                  placeholder="finance@operator.co.ke"
                />
              </label>
              <label className="muted small">
                Contact account number (optional)
                <input
                  className="input"
                  value={saccoForm.contact_account_number}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, contact_account_number: e.target.value }))}
                  placeholder="Account number"
                />
              </label>
              <label className="muted small">
                Settlement till / paybill
                <input
                  className="input"
                  value={saccoForm.default_till}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, default_till: e.target.value }))}
                  placeholder="Paybill or till number"
                />
              </label>
              <label className="muted small">
                Settlement method
                <select
                  value={saccoForm.settlement_method}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, settlement_method: e.target.value }))}
                >
                  <option value="MPESA">M-PESA</option>
                  <option value="BANK">Bank</option>
                </select>
              </label>
              <label className="muted small">
                Settlement bank name (optional)
                <input
                  className="input"
                  value={saccoForm.settlement_bank_name}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, settlement_bank_name: e.target.value }))}
                  placeholder="Bank name"
                />
              </label>
              <label className="muted small">
                Settlement bank account number (optional)
                <input
                  className="input"
                  value={saccoForm.settlement_bank_account_number}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, settlement_bank_account_number: e.target.value }))}
                  placeholder="Account number"
                />
              </label>
            </div>

            <h4 style={{ margin: '16px 0 6px' }}>Business rules / defaults</h4>
            <div className="grid g2">
              <label className="muted small">
                Default fee label
                <input
                  className="input"
                  value={saccoForm.fee_label}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, fee_label: e.target.value }))}
                  placeholder="Daily Fee"
                />
              </label>
              <div className="muted small" style={{ display: 'flex', alignItems: 'center' }}>
                Auto-filled by operator type, override if needed.
              </div>
            </div>
            <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
              <label className="muted small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={saccoForm.savings_enabled}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, savings_enabled: e.target.checked }))}
                />
                Savings enabled
              </label>
              <label className="muted small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={saccoForm.loans_enabled}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, loans_enabled: e.target.checked }))}
                />
                Loans enabled
              </label>
              <label className="muted small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={saccoForm.routes_enabled}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, routes_enabled: e.target.checked }))}
                />
                Routes enabled
              </label>
            </div>

            <h4 style={{ margin: '16px 0 6px' }}>System access</h4>
            <div className="grid g2">
              <label className="muted small">
                Admin user email
                <input
                  className="input"
                  value={saccoForm.admin_email}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, admin_email: e.target.value }))}
                  placeholder="admin@operator.co.ke"
                />
              </label>
              <label className="muted small">
                Admin user phone
                <input
                  className="input"
                  value={saccoForm.admin_phone}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, admin_phone: e.target.value }))}
                  placeholder="07xx..."
                />
              </label>
              <label className="muted small">
                Role
                <input className="input" value="OPERATOR_ADMIN" disabled />
              </label>
            </div>

            <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  const displayName = saccoForm.display_name.trim()
                  const operatorTypeRaw = saccoForm.operator_type
                  const operatorType = normalizeOperatorType(operatorTypeRaw)
                  const contactName = saccoForm.contact_name.trim()
                  const contactPhone = normalizePhoneInput(saccoForm.contact_phone)
                  const contactEmail = saccoForm.contact_email.trim()
                  const contactAccountNumber = saccoForm.contact_account_number.trim()
                  const defaultTill = saccoForm.default_till.trim()
                  const settlementMethod = saccoForm.settlement_method
                  const settlementBankName = saccoForm.settlement_bank_name.trim()
                  const settlementBankAccountNumber = saccoForm.settlement_bank_account_number.trim()
                  const adminEmail = saccoForm.admin_email.trim()
                  const adminPhone = normalizePhoneInput(saccoForm.admin_phone)
                  const feeLabel = saccoForm.fee_label.trim() || buildOperatorDefaults(operatorType).fee_label
                  const status = saccoForm.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE'

                  const errors: string[] = []
                  if (!displayName) errors.push('Operator display name is required')
                  if (!operatorTypeRaw) errors.push('Operator type is required')
                  if (!defaultTill) errors.push('Settlement till/paybill is required')
                  if (!adminEmail || !isValidEmail(adminEmail)) errors.push('Valid admin email is required')
                  if (!adminPhone || !isValidKenyanPhone(adminPhone)) errors.push('Admin phone must be Kenyan format')
                  if (contactPhone && !isValidKenyanPhone(contactPhone)) errors.push('Official phone must be Kenyan format')
                  if (contactEmail && !isValidEmail(contactEmail)) errors.push('Official email must be valid')
                  if (settlementMethod === 'BANK') {
                    if (!settlementBankName) errors.push('Settlement bank name is required for bank settlement')
                    if (!settlementBankAccountNumber) {
                      errors.push('Settlement bank account number is required for bank settlement')
                    }
                  }

                  if (errors.length) {
                    setSaccoMsg(errors[0])
                    return
                  }

                  setSaccoMsg('Saving...')
                  try {
                    const data = await sendJson<any>('/api/admin/register-sacco', 'POST', {
                      name: displayName,
                      display_name: displayName,
                      operator_type: operatorType,
                      legal_name: saccoForm.legal_name.trim() || null,
                      registration_no: saccoForm.registration_no.trim() || null,
                      status,
                      contact_name: contactName || null,
                      contact_phone: contactPhone || null,
                      contact_email: contactEmail || null,
                      contact_account_number: contactAccountNumber || null,
                      default_till: defaultTill,
                      fee_label: feeLabel,
                      savings_enabled: saccoForm.savings_enabled,
                      loans_enabled: saccoForm.loans_enabled,
                      routes_enabled: saccoForm.routes_enabled,
                      settlement_bank_name: settlementBankName || null,
                      settlement_bank_account_number: settlementBankAccountNumber || null,
                      admin_email: adminEmail,
                      admin_phone: adminPhone,
                      settlement_method: settlementMethod,
                      // TODO: Persist settlement_method when backend adds support.
                    })
                    const createdUser = data?.created_user || null
                    let msg = 'Operator created'
                    if (createdUser?.note) msg = `${msg}. ${createdUser.note}`
                    if (data?.staff_profile_error) msg = `${msg}. ${data.staff_profile_error}`
                    setSaccoMsg(msg)
                    setSaccoForm(createOperatorForm(operatorType))
                    await fetchList<SaccoRow>('/api/admin/saccos')
                      .then((rows) => setSaccos(rows))
                      .catch((err) => setSaccosError(err instanceof Error ? err.message : String(err)))
                    if (createdUser?.temp_password) {
                      window.alert(
                        `Operator created.\nAdmin login: ${createdUser.email || adminEmail}\nTemp password: ${createdUser.temp_password}`,
                      )
                    }
                    navigate('/sacco')
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Create failed'
                    if (/created but wallet failed/i.test(msg)) {
                      setSaccoMsg(msg)
                      setSaccoForm(createOperatorForm(operatorType))
                      await fetchList<SaccoRow>('/api/admin/saccos')
                        .then((rows) => setSaccos(rows))
                        .catch((loadErr) => setSaccosError(loadErr instanceof Error ? loadErr.message : String(loadErr)))
                      return
                    }
                    setSaccoMsg(msg)
                  }
                }}
              >
                Register Operator
              </button>
              <span className="muted small">{saccoMsg}</span>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Operators</h3>
              <span className="muted small">
                Showing {saccos.length} record{saccos.length === 1 ? '' : 's'}
              </span>
            </div>
            {saccosError ? <div className="err">Operator load error: {saccosError}</div> : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Operator</th>
                    <th>Type</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Settlement</th>
                    <th>Status</th>
                    <th>ID</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {saccos.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="muted">
                        No operators yet.
                      </td>
                    </tr>
                  ) : (
                    saccos.map((sacco) => {
                      const saccoId = sacco.id || sacco.sacco_id || ''
                      const isEditing = !!saccoId && saccoEditId === saccoId
                      return (
                        <Fragment key={sacco.id || sacco.sacco_id || sacco.email}>
                          <tr>
                            <td>{sacco.display_name || sacco.name || sacco.sacco_name || '-'}</td>
                            <td>{formatOperatorTypeLabel(sacco.operator_type || sacco.org_type || null)}</td>
                            <td>{sacco.phone || sacco.contact_phone || '-'}</td>
                            <td>{sacco.email || sacco.contact_email || '-'}</td>
                            <td>{sacco.default_till || '-'}</td>
                            <td>{sacco.status || 'ACTIVE'}</td>
                            <td>{saccoId || '-'}</td>
                            <td>
                              <button className="btn ghost" type="button" onClick={() => startSaccoEdit(sacco)}>
                                {isEditing ? 'Close' : 'Edit'}
                              </button>
                            </td>
                          </tr>
                          {isEditing ? (
                            <tr>
                              <td colSpan={8}>
                                <div className="card" style={{ margin: '6px 0' }}>
                                  <div className="topline">
                                    <h3 style={{ margin: 0 }}>Edit Operator</h3>
                                    <span className="muted small">ID: {saccoEditId}</span>
                                  </div>
                                  {saccoEditError ? <div className="err">Update error: {saccoEditError}</div> : null}
                                  <div className="grid g2">
                                    <label className="muted small">
                                      Display name
                                      <input
                                        className="input"
                                        value={saccoEditForm.name}
                                        onChange={(e) => setSaccoEditForm((f) => ({ ...f, name: e.target.value }))}
                                      />
                                    </label>
                                    <label className="muted small">
                                      Contact person
                                      <input
                                        className="input"
                                        value={saccoEditForm.contact_name}
                                        onChange={(e) => setSaccoEditForm((f) => ({ ...f, contact_name: e.target.value }))}
                                      />
                                    </label>
                                    <label className="muted small">
                                      Contact phone
                                      <input
                                        className="input"
                                        value={saccoEditForm.contact_phone}
                                        onChange={(e) => setSaccoEditForm((f) => ({ ...f, contact_phone: e.target.value }))}
                                      />
                                    </label>
                                    <label className="muted small">
                                      Contact email
                                      <input
                                        className="input"
                                        value={saccoEditForm.contact_email}
                                        onChange={(e) => setSaccoEditForm((f) => ({ ...f, contact_email: e.target.value }))}
                                      />
                                    </label>
                                    <label className="muted small">
                                      Settlement till / paybill
                                      <input
                                        className="input"
                                        value={saccoEditForm.default_till}
                                        onChange={(e) => setSaccoEditForm((f) => ({ ...f, default_till: e.target.value }))}
                                      />
                                    </label>
                                  </div>
                                  <div className="row" style={{ marginTop: 8 }}>
                                    <button className="btn" type="button" onClick={saveSaccoEdit}>
                                      Save changes
                                    </button>
                                    <button
                                      className="btn ghost"
                                      type="button"
                                      onClick={() => {
                                        setSaccoEditId('')
                                        setSaccoEditMsg('')
                                        setSaccoEditError(null)
                                      }}
                                    >
                                      Close
                                    </button>
                                    <span className="muted small">{saccoEditMsg}</span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {activeTab === 'matatu' ? renderShuttlesTab() : null}
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
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No withdrawals found.
                    </td>
                  </tr>
                ) : (
                  withdrawals.map((row) => {
                    const rowId = row.id || ''
                    const inline = rowId ? withdrawInlineEdits[rowId] : null
                    const statusValue = String(inline?.status || row.status || 'PENDING').toUpperCase()
                    const noteValue = inline?.note || ''
                    const busy = inline?.busy
                    return (
                      <tr key={rowId || row.created_at}>
                        <td className="mono">{row.created_at ? new Date(row.created_at).toLocaleString() : ''}</td>
                        <td>{row.matatu_plate || row.sacco_name || '-'}</td>
                        <td>{row.phone || ''}</td>
                        <td>{formatKes(row.amount)}</td>
                        <td>
                          <select
                            value={statusValue}
                            onChange={(e) => rowId && updateWithdrawInline(rowId, { status: e.target.value, msg: '', error: '' })}
                            disabled={!rowId || !!busy}
                            style={{ padding: 6, minWidth: 120 }}
                          >
                            {WITHDRAW_STATUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div style={{ display: 'grid', gap: 6 }}>
                            <input
                              className="input"
                              value={noteValue}
                              onChange={(e) => rowId && updateWithdrawInline(rowId, { note: e.target.value, msg: '', error: '' })}
                              placeholder="Note (optional)"
                              disabled={!rowId || !!busy}
                            />
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => submitWithdrawInline(row)}
                              disabled={!rowId || !!busy}
                            >
                              {busy ? 'Saving...' : 'Save'}
                            </button>
                          </div>
                          {inline?.msg ? <div className="muted small">{inline.msg}</div> : null}
                          {inline?.error ? <div className="err">Update error: {inline.error}</div> : null}
                        </td>
                      </tr>
                    )
                  })
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
      <section className="grid g2">
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3 style={{ marginTop: 0 }}>Wallet actions</h3>

          <h4 style={{ margin: '8px 0' }}>Manual credit</h4>
          <div className="grid g2">
            <label className="muted small">
              Wallet code
              <input
                className="input"
                value={walletCreditForm.wallet_code}
                onChange={(e) => setWalletCreditForm((f) => ({ ...f, wallet_code: e.target.value }))}
                placeholder="MAT0021"
              />
            </label>
            <label className="muted small">
              Amount (KES)
              <input
                className="input"
                inputMode="numeric"
                value={walletCreditForm.amount}
                onChange={(e) => setWalletCreditForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="500"
              />
            </label>
            <label className="muted small">
              Reference (optional)
              <input
                className="input"
                value={walletCreditForm.reference}
                onChange={(e) => setWalletCreditForm((f) => ({ ...f, reference: e.target.value }))}
                placeholder="ADJ-2025-01"
              />
            </label>
            <label className="muted small">
              Description (optional)
              <input
                className="input"
                value={walletCreditForm.description}
                onChange={(e) => setWalletCreditForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Manual adjustment"
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" type="button" onClick={submitWalletCredit}>
              Credit wallet
            </button>
            <span className="muted small">{walletCreditMsg}</span>
          </div>
          {walletCreditError ? <div className="err">Credit error: {walletCreditError}</div> : null}

          <h4 style={{ margin: '16px 0 8px' }}>B2C withdrawal</h4>
          <div className="grid g2">
            <label className="muted small">
              Wallet code
              <input
                className="input"
                value={walletB2CForm.wallet_code}
                onChange={(e) => setWalletB2CForm((f) => ({ ...f, wallet_code: e.target.value }))}
                placeholder="MAT0021"
              />
            </label>
            <label className="muted small">
              Amount (KES)
              <input
                className="input"
                inputMode="numeric"
                value={walletB2CForm.amount}
                onChange={(e) => setWalletB2CForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="1500"
              />
            </label>
            <label className="muted small">
              Phone number
              <input
                className="input"
                inputMode="numeric"
                value={walletB2CForm.phone_number}
                onChange={(e) => setWalletB2CForm((f) => ({ ...f, phone_number: e.target.value }))}
                placeholder="2547XXXXXXXX"
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" type="button" onClick={submitWalletB2C}>
              Send B2C
            </button>
            <span className="muted small">{walletB2CMsg}</span>
          </div>
          {walletB2CError ? <div className="err">B2C error: {walletB2CError}</div> : null}

          <h4 style={{ margin: '16px 0 8px' }}>Bank withdrawal request</h4>
          <div className="grid g2">
            <label className="muted small">
              Wallet code
              <input
                className="input"
                value={walletBankForm.wallet_code}
                onChange={(e) => setWalletBankForm((f) => ({ ...f, wallet_code: e.target.value }))}
                placeholder="MAT0021"
              />
            </label>
            <label className="muted small">
              Amount (KES)
              <input
                className="input"
                inputMode="numeric"
                value={walletBankForm.amount}
                onChange={(e) => setWalletBankForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="5000"
              />
            </label>
            <label className="muted small">
              Bank name
              <input
                className="input"
                value={walletBankForm.bank_name}
                onChange={(e) => setWalletBankForm((f) => ({ ...f, bank_name: e.target.value }))}
                placeholder="KCB"
              />
            </label>
            <label className="muted small">
              Bank branch (optional)
              <input
                className="input"
                value={walletBankForm.bank_branch}
                onChange={(e) => setWalletBankForm((f) => ({ ...f, bank_branch: e.target.value }))}
                placeholder="Nairobi"
              />
            </label>
            <label className="muted small">
              Account number
              <input
                className="input"
                inputMode="numeric"
                value={walletBankForm.bank_account_number}
                onChange={(e) => setWalletBankForm((f) => ({ ...f, bank_account_number: e.target.value }))}
                placeholder="0012345678"
              />
            </label>
            <label className="muted small">
              Account name
              <input
                className="input"
                value={walletBankForm.bank_account_name}
                onChange={(e) => setWalletBankForm((f) => ({ ...f, bank_account_name: e.target.value }))}
                placeholder="SACCO Main"
              />
            </label>
            <label className="muted small">
              Fee percent (optional)
              <input
                className="input"
                inputMode="numeric"
                value={walletBankForm.fee_percent}
                onChange={(e) => setWalletBankForm((f) => ({ ...f, fee_percent: e.target.value }))}
                placeholder="1"
              />
            </label>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            Fee percent accepts 1 for 1%.
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" type="button" onClick={submitWalletBank}>
              Create bank withdrawal
            </button>
            <span className="muted small">{walletBankMsg}</span>
          </div>
          {walletBankError ? <div className="err">Bank withdrawal error: {walletBankError}</div> : null}
        </div>
      </section>
        </>
      ) : null}

      {activeTab === 'c2b' ? (
        <>
      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>C2B payments log</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" type="button" onClick={() => loadC2bPayments()}>
              Refresh
            </button>
          </div>
        </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="muted small">
              Period:{' '}
              <select
                value={c2bRange}
                onChange={(e) =>
                  loadC2bPayments({
                    rangeKey: (e.target.value as 'today' | 'week' | 'month') || 'week',
                    page: 1,
                  })
                }
              >
                <option value="today">Today</option>
                <option value="week">This week</option>
                <option value="month">This month</option>
              </select>
            </label>
            <label className="muted small">
              Status:{' '}
              <select
                value={c2bStatus}
                onChange={(e) => loadC2bPayments({ status: e.target.value, page: 1 })}
              >
                <option value="">Any</option>
                <option value="pending">Pending</option>
                <option value="processed">Processed</option>
              </select>
            </label>
            <input
              className="input"
              placeholder="Search receipt, phone, paybill, account"
              value={c2bSearch}
              onChange={(e) => setC2bSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void loadC2bPayments({ search: (e.currentTarget as HTMLInputElement).value, page: 1 })
                }
              }}
              style={{ maxWidth: 260 }}
            />
          <button className="btn ghost" type="button" onClick={() => loadC2bPayments({ search: c2bSearch, page: 1 })}>
            Apply
          </button>
          <button className="btn ghost" type="button" onClick={exportC2bCsv}>
            Export CSV
          </button>
          <button className="btn ghost" type="button" onClick={exportC2bJson}>
            Export JSON
          </button>
          <span className="muted small">
            {c2bTotal ? `Showing ${(c2bPage - 1) * c2bLimit + 1}-${Math.min(c2bTotal, c2bPage * c2bLimit)} of ${c2bTotal}` : '0 rows'}
          </span>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn ghost"
            type="button"
            onClick={() => loadC2bPayments({ page: Math.max(1, c2bPage - 1) })}
            disabled={c2bPage <= 1}
          >
            Prev
          </button>
          <span className="muted small">
            Page {c2bPage} of {Math.max(1, Math.ceil(c2bTotal / c2bLimit || 1))}
          </span>
          <button
            className="btn ghost"
            type="button"
            onClick={() =>
              loadC2bPayments({
                page: Math.min(Math.max(1, Math.ceil(c2bTotal / c2bLimit || 1)), c2bPage + 1),
              })
            }
            disabled={c2bPage >= Math.max(1, Math.ceil(c2bTotal / c2bLimit || 1))}
          >
            Next
          </button>
          <label className="muted small">
            Page size:{' '}
            <select
              value={c2bLimit}
              onChange={(e) => loadC2bPayments({ limit: Number(e.target.value), page: 1 })}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </label>
        </div>
        {c2bError ? <div className="err">C2B error: {c2bError}</div> : null}
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Receipt</th>
                <th>Phone</th>
                <th>Amount</th>
                <th>Paybill</th>
                <th>Account</th>
                <th>Status</th>
                <th>Processed at</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {c2bRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">
                    No C2B payments found.
                  </td>
                </tr>
              ) : (
                c2bRows.map((row) => {
                  const id = row.id || ''
                  const action = id ? c2bActions[id] : null
                  const rawState = id ? c2bRawState[id] : null
                  const processed = !!row.processed
                  const open = !!rawState?.open
                  return (
                    <Fragment key={id || row.mpesa_receipt || row.transaction_timestamp}>
                      <tr>
                        <td className="mono">
                          {row.transaction_timestamp ? new Date(row.transaction_timestamp).toLocaleString() : '-'}
                        </td>
                        <td className="mono">{row.mpesa_receipt || row.id || '-'}</td>
                        <td>{row.phone_number || '-'}</td>
                        <td>{formatKes(row.amount)}</td>
                        <td>{row.paybill_number || '-'}</td>
                        <td className="mono">{row.account_reference || '-'}</td>
                        <td>{processed ? 'Processed' : 'Pending'}</td>
                        <td className="mono">
                          {row.processed_at ? new Date(row.processed_at).toLocaleString() : '-'}
                        </td>
                        <td>
                          <div style={{ display: 'grid', gap: 6 }}>
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => {
                                if (!id) return
                                toggleC2bRaw(id)
                                if (!open) ensureC2bRaw(id)
                              }}
                              disabled={!id || !!rawState?.loading}
                            >
                              {open ? 'Hide raw' : 'View raw'}
                            </button>
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => reprocessC2b(row)}
                              disabled={!id || processed || !!action?.busy}
                            >
                              {action?.busy ? 'Reprocessing...' : 'Reprocess'}
                            </button>
                            {action?.msg ? <span className="muted small">{action.msg}</span> : null}
                            {action?.error ? <span className="err">Reprocess error: {action.error}</span> : null}
                          </div>
                        </td>
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={9}>
                            {rawState?.loading ? (
                              <div className="muted small">Loading raw payload...</div>
                            ) : rawState?.error ? (
                              <div className="err">Raw payload error: {rawState.error}</div>
                            ) : (
                              <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
                                {rawState?.payload || ''}
                              </pre>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
        </>
      ) : null}

      {activeTab === 'payouts' ? <PayoutHistory /> : null}

      {activeTab === 'worker_monitor' ? <WorkerMonitor /> : null}

      {activeTab === 'ussd' ? (
        <>
      <section className="card" style={{ background: '#f8fafc' }}>
        <h3 style={{ marginTop: 0 }}>USSD short code rules</h3>
        <ul className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
          <li>Base code is 1 to 999, check digit is the digital root of the base.</li>
          <li>Full code = base + check digit (ex: 11 -&gt; 112, 99 -&gt; 999, 999 -&gt; 9999).</li>
          <li>Tier A: 1-199, Tier B: 200-699, Tier C: 700-999.</li>
          <li>USSD codes are for USSD flow; PayBill fallback uses plate number only.</li>
        </ul>
      </section>

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
            Tier
            <select
              value={ussdAssignForm.tier}
              onChange={(e) => setUssdAssignForm((f) => ({ ...f, tier: e.target.value }))}
              style={{ padding: 10 }}
            >
              <option value="">Any tier</option>
              <option value="A">Tier A (1-199)</option>
              <option value="B">Tier B (200-699)</option>
              <option value="C">Tier C (700-999)</option>
            </select>
          </label>
          <label className="muted small">
            Prefix (legacy)
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
                    {s.display_name || s.name || s.sacco_name || s.sacco_id}
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
            Code input
            <select
              value={ussdBindForm.mode}
              onChange={(e) =>
                setUssdBindForm((f) => ({
                  ...f,
                  mode: e.target.value,
                  ussd_code: '',
                  base_code: '',
                }))
              }
              style={{ padding: 10 }}
            >
              <option value="full">Full code (base + check digit)</option>
              <option value="base">Base code (1-999)</option>
            </select>
          </label>
          {ussdBindForm.mode === 'base' ? (
            <label className="muted small">
              Base code
              <input
                className="input"
                value={ussdBindForm.base_code}
                onChange={(e) => setUssdBindForm((f) => ({ ...f, base_code: e.target.value }))}
                placeholder="11"
              />
            </label>
          ) : (
          <label className="muted small">
            USSD code
            <input
              className="input"
              value={ussdBindForm.ussd_code}
              onChange={(e) => setUssdBindForm((f) => ({ ...f, ussd_code: e.target.value }))}
              placeholder="112"
            />
          </label>
          )}
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
                    {s.display_name || s.name || s.sacco_name || s.sacco_id}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {ussdBindForm.mode === 'base' ? (
          <div className="muted small" style={{ marginTop: 8 }}>
            Check digit: {ussdBindCheckDigit ?? '-'} | Full code: {ussdBindFullFromBase || '-'} | Tier:{' '}
            {ussdBindTier ? `Tier ${ussdBindTier}` : '-'}
          </div>
        ) : ussdBindFullMeta.valid !== null ? (
          <div className="muted small" style={{ marginTop: 8 }}>
            Checksum {ussdBindFullMeta.valid ? 'ok' : 'invalid'} (expected{' '}
            {ussdBindFullMeta.expected ?? '-'})
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Import USSD pool</h3>
          <button className="btn" type="button" onClick={importUssdPool}>
            Import
          </button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label className="muted small">
            Format
            <select
              value={ussdImportForm.mode}
              onChange={(e) => setUssdImportForm((f) => ({ ...f, mode: e.target.value }))}
              style={{ padding: 10 }}
            >
              <option value="short_full">Short codes (full code)</option>
              <option value="short_base">Short codes (base only)</option>
              <option value="legacy">Legacy *001* codes</option>
            </select>
          </label>
          {ussdImportForm.mode === 'legacy' ? (
            <input
              className="input"
              placeholder="Legacy prefix"
              value={ussdImportForm.prefix}
              onChange={(e) => setUssdImportForm((f) => ({ ...f, prefix: e.target.value }))}
              style={{ maxWidth: 200 }}
            />
          ) : null}
          <span className="muted small">{ussdImportMsg}</span>
        </div>
        <textarea
          className="input"
          style={{ minHeight: 120, width: '100%' }}
          placeholder={ussdImportPlaceholder}
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
            <select
              value={ussdTierFilter}
              onChange={(e) => setUssdTierFilter(e.target.value)}
              style={{ padding: 10 }}
            >
              <option value="">All tiers</option>
              <option value="A">Tier A (1-199)</option>
              <option value="B">Tier B (200-699)</option>
              <option value="C">Tier C (700-999)</option>
            </select>
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
                  <th>Tier</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredUssdAvailable.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No available codes.
                    </td>
                  </tr>
                ) : (
                  filteredUssdAvailable.map((row, idx) => (
                    <tr key={row.id || row.full_code || row.code || idx}>
                      <td>{formatUssdCode(row)}</td>
                      <td>{ussdTierFromBase(row.base) || '-'}</td>
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
                  <th>Tier</th>
                  <th>Allocated to</th>
                  <th>Assigned</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredUssdAllocated.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No allocated codes.
                    </td>
                  </tr>
                ) : (
                  filteredUssdAllocated.map((row, idx) => (
                    <tr key={row.id || row.full_code || row.code || idx}>
                      <td>{formatUssdCode(row)}</td>
                      <td>{ussdTierFromBase(row.base) || '-'}</td>
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
                    {s.display_name || s.name || s.sacco_name || s.sacco_id}
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
              placeholder="112 or *001*11013#"
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
      <section className="card" style={{ background: '#f8fafc' }}>
        <div className="topline">
          <h3 style={{ margin: 0 }}>SMS settings</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" type="button" onClick={() => void loadSmsSettings()}>
              Refresh
            </button>
            <button className="btn" type="button" onClick={saveSmsSettings}>
              Save settings
            </button>
          </div>
        </div>
        {smsSettingsError ? <div className="err">SMS settings error: {smsSettingsError}</div> : null}
        <div className="grid g2">
          <label className="muted small">
            Sender ID
            <input
              className="input"
              value={smsSettingsForm.sender_id || ''}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, sender_id: e.target.value }))}
              placeholder="TEKETEKE"
            />
          </label>
          <label className="muted small">
            Quiet hours start
            <input
              className="input"
              value={smsSettingsForm.quiet_hours_start || ''}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, quiet_hours_start: e.target.value }))}
              placeholder="22:00"
            />
          </label>
          <label className="muted small">
            Quiet hours end
            <input
              className="input"
              value={smsSettingsForm.quiet_hours_end || ''}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, quiet_hours_end: e.target.value }))}
              placeholder="06:00"
            />
          </label>
        </div>
        <div className="grid g2" style={{ marginTop: 10 }}>
          <label className="muted small">
            <input
              type="checkbox"
              checked={!!smsSettingsForm.fee_paid_enabled}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, fee_paid_enabled: e.target.checked }))}
              style={{ marginRight: 6 }}
            />
            Daily fee paid
          </label>
          <label className="muted small">
            <input
              type="checkbox"
              checked={!!smsSettingsForm.fee_failed_enabled}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, fee_failed_enabled: e.target.checked }))}
              style={{ marginRight: 6 }}
            />
            Daily fee failed
          </label>
          <label className="muted small">
            <input
              type="checkbox"
              checked={!!smsSettingsForm.balance_enabled}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, balance_enabled: e.target.checked }))}
              style={{ marginRight: 6 }}
            />
            Balance request
          </label>
          <label className="muted small">
            <input
              type="checkbox"
              checked={!!smsSettingsForm.eod_enabled}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, eod_enabled: e.target.checked }))}
              style={{ marginRight: 6 }}
            />
            End of day summary
          </label>
          <label className="muted small">
            <input
              type="checkbox"
              checked={!!smsSettingsForm.payout_paid_enabled}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, payout_paid_enabled: e.target.checked }))}
              style={{ marginRight: 6 }}
            />
            Payout paid
          </label>
          <label className="muted small">
            <input
              type="checkbox"
              checked={!!smsSettingsForm.payout_failed_enabled}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, payout_failed_enabled: e.target.checked }))}
              style={{ marginRight: 6 }}
            />
            Payout failed
          </label>
          <label className="muted small">
            <input
              type="checkbox"
              checked={!!smsSettingsForm.savings_paid_enabled}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, savings_paid_enabled: e.target.checked }))}
              style={{ marginRight: 6 }}
            />
            Savings paid
          </label>
          <label className="muted small">
            <input
              type="checkbox"
              checked={!!smsSettingsForm.savings_balance_enabled}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, savings_balance_enabled: e.target.checked }))}
              style={{ marginRight: 6 }}
            />
            Savings balance request
          </label>
          <label className="muted small">
            <input
              type="checkbox"
              checked={!!smsSettingsForm.loan_paid_enabled}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, loan_paid_enabled: e.target.checked }))}
              style={{ marginRight: 6 }}
            />
            Loan paid
          </label>
          <label className="muted small">
            <input
              type="checkbox"
              checked={!!smsSettingsForm.loan_failed_enabled}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, loan_failed_enabled: e.target.checked }))}
              style={{ marginRight: 6 }}
            />
            Loan failed
          </label>
          <label className="muted small">
            <input
              type="checkbox"
              checked={!!smsSettingsForm.loan_balance_enabled}
              onChange={(e) => setSmsSettingsForm((f) => ({ ...f, loan_balance_enabled: e.target.checked }))}
              style={{ marginRight: 6 }}
            />
            Loan balance request
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted small">{smsSettingsMsg}</span>
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          Cost control: keep fee/savings/loan paid off and rely on EOD, send balance only on request, keep templates
          under 160 characters.
        </div>
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>SMS templates</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" type="button" onClick={() => void loadSmsTemplates()}>
              Refresh
            </button>
            <span className="muted small">{smsTemplatesMsg}</span>
          </div>
        </div>
        {smsTemplatesError ? <div className="err">SMS templates error: {smsTemplatesError}</div> : null}
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>Template</th>
                <th>Active</th>
                <th>Body</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {smsTemplates.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No templates yet.
                  </td>
                </tr>
              ) : (
                smsTemplates.map((row, idx) => (
                  <tr key={row.code || row.label || idx}>
                    <td>
                      <div>{row.label || row.code || '-'}</div>
                      <div className="muted small mono">{row.code || '-'}</div>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.is_active ?? true}
                        onChange={(e) => updateSmsTemplate(row.code, { is_active: e.target.checked })}
                      />
                    </td>
                    <td>
                      <textarea
                        className="input"
                        style={{ minHeight: 90 }}
                        value={row.body || ''}
                        onChange={(e) => updateSmsTemplate(row.code, { body: e.target.value })}
                      />
                      {row.code && smsTemplateHints[row.code] ? (
                        <div className="muted small" style={{ marginTop: 6 }}>
                          {smsTemplateHints[row.code]}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <button className="btn ghost" type="button" onClick={() => saveSmsTemplate(row.code)}>
                        Save
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

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
                  {s.display_name || s.name || s.sacco_name || s.sacco_id}
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
