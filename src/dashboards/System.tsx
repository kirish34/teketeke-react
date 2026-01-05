import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import DashboardShell from '../components/DashboardShell'
import PaybillCodeCard from '../components/PaybillCodeCard'
import PaybillHeader from '../components/PaybillHeader'
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
  receipt?: string
  msisdn?: string
  amount?: number
  paybill_number?: string
  account_reference?: string
  status?: string
  created_at?: string
}

type PaybillAliasRow = {
  wallet_id?: string
  entity_type?: string
  entity_id?: string
  wallet_kind?: string
  alias?: string
  alias_type?: string
}

type ReconciliationPaybillRow = {
  id?: string
  date?: string
  paybill_number?: string
  credited_total?: number
  credited_count?: number
  quarantined_total?: number
  quarantined_count?: number
  rejected_total?: number
  rejected_count?: number
  created_at?: string
  updated_at?: string
}

type ReconciliationChannelRow = {
  id?: string
  date?: string
  channel?: 'C2B' | 'STK' | string
  paybill_number?: string
  credited_total?: number
  credited_count?: number
  quarantined_total?: number
  quarantined_count?: number
  rejected_total?: number
  rejected_count?: number
  created_at?: string
  updated_at?: string
}

type ReconciliationCombinedRow = {
  date?: string
  credited_total?: number
  credited_count?: number
  quarantined_total?: number
  quarantined_count?: number
  rejected_total?: number
  rejected_count?: number
}

type QuarantineRow = {
  id?: string
  receipt?: string
  msisdn?: string
  amount?: number
  paybill_number?: string
  account_reference?: string
  status?: string
  risk_level?: string
  risk_score?: number
  risk_flags?: Record<string, unknown>
  created_at?: string
}

type OpsAlertRow = {
  id?: string
  created_at?: string
  type?: string
  severity?: string
  entity_type?: string
  entity_id?: string
  payment_id?: string
  message?: string
  meta?: Record<string, unknown>
}

type PayoutBatchRow = {
  id?: string
  sacco_id?: string
  sacco_name?: string
  date_from?: string
  date_to?: string
  status?: string
  total_amount?: number
  currency?: string
  created_at?: string
  updated_at?: string
  meta?: Record<string, any>
}

type PayoutItemRow = {
  id?: string
  wallet_kind?: string
  amount?: number
  wallet_balance?: number
  destination_type?: string
  destination_ref?: string
  status?: string
  block_reason?: string | null
  provider_receipt?: string | null
  failure_reason?: string | null
  ledger_entry_id?: string | null
  created_at?: string
}

type PayoutEventRow = {
  id?: string
  event_type?: string
  message?: string | null
  created_at?: string
  meta?: Record<string, unknown>
}

type ReadinessCheck = {
  pass?: boolean
  reason?: string
  details?: Record<string, unknown>
}

type ReadinessIssue = {
  code?: string
  level?: 'WARN' | 'BLOCK' | string
  message?: string
  hint?: string | null
  details?: Record<string, unknown>
}

type BatchReadiness = {
  batch?: { id?: string; status?: string; sacco_id?: string; date_from?: string; date_to?: string; total_amount?: number }
  checks?: {
    can_submit?: ReadinessCheck
    can_approve?: ReadinessCheck
    can_process?: ReadinessCheck
  }
  items_summary?: {
    pending_count?: number
    blocked_count?: number
    sent_count?: number
    confirmed_count?: number
    failed_count?: number
    blocked_reasons?: Array<{ reason?: string; count?: number }>
  }
  issues?: ReadinessIssue[]
  unverified_destinations?: Array<{ destination_ref?: string; destination_type?: string }>
}
type C2bActionState = {
  busy?: boolean
  error?: string
  msg?: string
}

type QuarantineActionState = {
  wallet_id?: string
  note?: string
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

type LoginInlineEdit = {
  email?: string
  password?: string
}

type SystemTabId =
  | 'overview'
  | 'analytics'
  | 'finance'
  | 'c2b'
  | 'reconciliation'
  | 'quarantine'
  | 'alerts'
  | 'payouts'
  | 'payout_approvals'
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
  tlb_expiry_date?: string | null
  insurance_expiry_date?: string | null
  inspection_expiry_date?: string | null
  till_number?: string | null
  owner_id?: string | null
  created_at?: string
  owner?: ShuttleOwnerRow | null
  operator?: ShuttleOperatorRow | null
}

type TaxiOwnerRow = {
  id?: string
  full_name?: string
  id_number?: string
  phone?: string
  email?: string | null
  address?: string | null
  license_no?: string | null
  date_of_birth?: string | null
  created_at?: string
}

type TaxiRow = {
  id?: string
  plate?: string
  make?: string | null
  model?: string | null
  year?: number | null
  operator_id?: string | null
  till_number?: string | null
  seat_capacity?: number | null
  insurance_expiry_date?: string | null
  psv_badge_expiry_date?: string | null
  category?: string | null
  category_other?: string | null
  owner_id?: string | null
  created_at?: string
  owner?: TaxiOwnerRow | null
  operator?: ShuttleOperatorRow | null
}

type BodaRiderRow = {
  id?: string
  full_name?: string
  id_number?: string
  phone?: string
  email?: string | null
  address?: string | null
  stage?: string | null
  town?: string | null
  license_expiry_date?: string | null
  date_of_birth?: string | null
  created_at?: string
}

type BodaBikeRow = {
  id?: string
  identifier?: string
  make?: string | null
  model?: string | null
  year?: number | null
  operator_id?: string | null
  till_number?: string | null
  license_no?: string | null
  has_helmet?: boolean | null
  has_reflector?: boolean | null
  insurance_expiry_date?: string | null
  rider_id?: string | null
  created_at?: string
  rider?: BodaRiderRow | null
  operator?: ShuttleOperatorRow | null
}

type StaffProfileRow = {
  id?: string
  user_id?: string | null
  name?: string
  email?: string | null
  phone?: string | null
  role?: string | null
  sacco_id?: string | null
}

type MaintenanceLogRow = {
  id?: string
  asset_type?: string | null
  asset_id?: string | null
  shuttle_id?: string | null
  operator_id?: string | null
  created_by_user_id?: string | null
  handled_by_user_id?: string | null
  reported_by_staff_id?: string | null
  handled_by_staff_id?: string | null
  issue_category?: string | null
  issue_tags?: string[] | null
  issue_description?: string | null
  parts_used?: Array<{
    part_name?: string | null
    part_category?: string | null
    qty?: number | null
    unit_cost?: number | null
    name?: string | null
    cost?: number | null
  }> | null
  total_cost_kes?: number | null
  downtime_days?: number | null
  priority?: string | null
  status?: string | null
  occurred_at?: string | null
  resolved_at?: string | null
  next_service_due?: string | null
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
  shuttle?: { id?: string; plate?: string | null; operator_id?: string | null } | null
  operator?: ShuttleOperatorRow | null
  reported_by?: StaffProfileRow | null
  handled_by?: StaffProfileRow | null
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

function formatPayoutKind(kind?: string) {
  const k = (kind || '').toUpperCase()
  if (k === 'SACCO_FEE' || k === 'FEE' || k === 'SACCO_DAILY_FEE') return 'Daily Fee'
  if (k === 'SACCO_LOAN' || k === 'LOAN') return 'Loan'
  if (k === 'SACCO_SAVINGS' || k === 'SAVINGS') return 'Savings'
  return k || '-'
}

function findIssue(readiness: BatchReadiness | null | undefined, code: string) {
  return readiness?.issues?.find((issue) => issue.code === code) || null
}

function buildReadinessChip(readiness: BatchReadiness | null | undefined) {
  if (!readiness) return { label: 'CHECKING', tone: 'muted' }
  if (findIssue(readiness, 'QUARANTINES_PRESENT')) return { label: 'BLOCKED: QUARANTINES', tone: 'bad' }
  if (findIssue(readiness, 'DESTINATION_NOT_VERIFIED')) return { label: 'BLOCKED: DESTINATION', tone: 'bad' }
  if (readiness.checks?.can_process?.pass) return { label: 'READY: PROCESS', tone: 'good' }
  if (readiness.checks?.can_approve?.pass) return { label: 'READY: APPROVE', tone: 'good' }
  if (readiness.checks?.can_submit?.pass) return { label: 'READY: SUBMIT', tone: 'good' }
  return { label: 'NEEDS REVIEW', tone: 'muted' }
}

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
    default_till: '',
    settlement_method: 'MPESA',
    settlement_bank_name: '',
    settlement_bank_account_number: '',
    fee_label: defaults.fee_label,
    savings_enabled: true,
    loans_enabled: true,
    routes_enabled: defaults.routes_enabled,
    admin_name: '',
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
    till_number: '',
  }
}

const TAXI_CATEGORY_OPTIONS = [
  { value: 'STANDARD', label: 'STANDARD' },
  { value: 'EXECUTIVE', label: 'EXECUTIVE' },
  { value: 'SUV', label: 'SUV' },
  { value: 'VAN_TAXI', label: 'VAN_TAXI' },
  { value: 'OTHER', label: 'OTHER' },
]

function normalizeTaxiCategory(value?: string | null) {
  return String(value || '').trim().toUpperCase()
}

function createTaxiOwnerForm() {
  return {
    full_name: '',
    id_number: '',
    phone: '',
    email: '',
    address: '',
    license_no: '',
    date_of_birth: '',
  }
}

function createTaxiForm() {
  return {
    plate: '',
    make: '',
    model: '',
    year: '',
    operator_id: '',
    till_number: '',
    seat_capacity: '4',
    category: '',
    category_other: '',
  }
}

function createBodaRiderForm() {
  return {
    full_name: '',
    id_number: '',
    phone: '',
    email: '',
    address: '',
    stage: '',
    town: '',
    date_of_birth: '',
  }
}

function createBodaBikeForm() {
  return {
    identifier: '',
    make: '',
    model: '',
    year: '',
    operator_id: '',
    till_number: '',
    license_no: '',
    has_helmet: false,
    has_reflector: false,
  }
}


function normalizePhoneInput(value: string) {
  return String(value || '').replace(/\s+/g, '')
}

function normalizePlateInput(value: string) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '')
}

function isValidPlateInput(value: string) {
  return /^[A-Z]{3}\d{3}[A-Z]$/.test(value)
}

function normalizeDigitsInput(value: string) {
  return String(value || '').replace(/\D/g, '')
}

function isValidManualAccountCode(value: string) {
  return /^\d{7}$/.test(value)
}

function isValidPaybillOrTill(value: string) {
  return /^\d{5,7}$/.test(value)
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

type ExpiryStatus = 'unknown' | 'expired' | 'due_soon' | 'warning' | 'ok'

function getVehicleAge(year?: number | null) {
  if (!Number.isFinite(year)) return null
  const currentYear = new Date().getFullYear()
  const age = currentYear - Number(year)
  if (!Number.isFinite(age) || age < 0) return null
  return age
}

function getRiskScoreForAge(age?: number | null) {
  if (age === null || age === undefined) return 50
  if (age <= 3) return 10
  if (age <= 6) return 25
  if (age <= 10) return 45
  if (age <= 15) return 70
  return 90
}

function getRiskLabel(score: number) {
  if (score <= 25) return 'Low'
  if (score <= 50) return 'Medium'
  if (score <= 75) return 'High'
  return 'Critical'
}

function getExpiryStatus(value?: string | null): { status: ExpiryStatus; daysRemaining: number | null } {
  if (!value) return { status: 'unknown', daysRemaining: null }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return { status: 'unknown', daysRemaining: null }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(parsed)
  expiry.setHours(0, 0, 0, 0)
  const diffMs = expiry.getTime() - today.getTime()
  const daysRemaining = Math.ceil(diffMs / 86400000)
  if (daysRemaining < 0) return { status: 'expired', daysRemaining }
  if (daysRemaining <= 30) return { status: 'due_soon', daysRemaining }
  if (daysRemaining <= 60) return { status: 'warning', daysRemaining }
  return { status: 'ok', daysRemaining }
}

function formatExpiryStatusLabel(status: ExpiryStatus) {
  if (status === 'expired') return 'Expired'
  if (status === 'due_soon') return 'Due soon'
  if (status === 'warning') return 'Warning'
  if (status === 'ok') return 'OK'
  return 'Unknown'
}

function formatExpiryDate(value?: string | null) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('en-KE')
}

function riskBadgeStyle(score: number) {
  if (score <= 25) return { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' }
  if (score <= 50) return { background: '#fef9c3', color: '#854d0e', border: '1px solid #fde047' }
  if (score <= 75) return { background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }
  return { background: '#fecaca', color: '#7f1d1d', border: '1px solid #fca5a5' }
}

function expiryBadgeStyle(status: ExpiryStatus) {
  if (status === 'expired') return { background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }
  if (status === 'due_soon') return { background: '#ffedd5', color: '#9a3412', border: '1px solid #fed7aa' }
  if (status === 'warning') return { background: '#fef9c3', color: '#854d0e', border: '1px solid #fde047' }
  if (status === 'ok') return { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' }
  return { background: '#e2e8f0', color: '#475569', border: '1px solid #cbd5e1' }
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
  const [paybillAliases, setPaybillAliases] = useState<PaybillAliasRow[]>([])

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

  const [reconFrom, setReconFrom] = useState(getRange('week').from)
  const [reconTo, setReconTo] = useState(getRange('week').to)
  const [reconPaybillRows, setReconPaybillRows] = useState<ReconciliationPaybillRow[]>([])
  const [reconChannelRows, setReconChannelRows] = useState<ReconciliationChannelRow[]>([])
  const [reconCombinedRows, setReconCombinedRows] = useState<ReconciliationCombinedRow[]>([])
  const [reconView, setReconView] = useState<'combined' | 'c2b' | 'stk'>('combined')
  const [reconError, setReconError] = useState<string | null>(null)

  const [quarantineRiskLevel, setQuarantineRiskLevel] = useState('')
  const [quarantineFlag, setQuarantineFlag] = useState('')
  const [quarantineSearch, setQuarantineSearch] = useState('')
  const [quarantinePage, setQuarantinePage] = useState(1)
  const [quarantineLimit, setQuarantineLimit] = useState(50)
  const [quarantineTotal, setQuarantineTotal] = useState(0)
  const [quarantineRows, setQuarantineRows] = useState<QuarantineRow[]>([])
  const [quarantineError, setQuarantineError] = useState<string | null>(null)
  const [quarantineActions, setQuarantineActions] = useState<Record<string, QuarantineActionState>>({})

  const [alertsSeverity, setAlertsSeverity] = useState('')
  const [alertsType, setAlertsType] = useState('')
  const [alertsPage, setAlertsPage] = useState(1)
  const [alertsLimit, setAlertsLimit] = useState(50)
  const [alertsTotal, setAlertsTotal] = useState(0)
  const [alertsRows, setAlertsRows] = useState<OpsAlertRow[]>([])
  const [alertsError, setAlertsError] = useState<string | null>(null)

  const [payoutApprovalStatus, setPayoutApprovalStatus] = useState('SUBMITTED')
  const [payoutApprovalRows, setPayoutApprovalRows] = useState<PayoutBatchRow[]>([])
  const [payoutApprovalError, setPayoutApprovalError] = useState<string | null>(null)
  const [payoutApprovalMsg, setPayoutApprovalMsg] = useState('')
  const [payoutApprovalSelected, setPayoutApprovalSelected] = useState('')
  const [payoutApprovalDetail, setPayoutApprovalDetail] = useState<PayoutBatchRow | null>(null)
  const [payoutApprovalItems, setPayoutApprovalItems] = useState<PayoutItemRow[]>([])
  const [payoutApprovalEvents, setPayoutApprovalEvents] = useState<PayoutEventRow[]>([])
  const [payoutReadinessMap, setPayoutReadinessMap] = useState<Record<string, BatchReadiness | null>>({})
  const [payoutApprovalReadiness, setPayoutApprovalReadiness] = useState<BatchReadiness | null>(null)

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
  const taxiTableRef = useRef<HTMLDivElement | null>(null)
  const bodaTableRef = useRef<HTMLDivElement | null>(null)

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
  const [analyticsOperatorFilter, setAnalyticsOperatorFilter] = useState('')
  const [analyticsTypeFilter, setAnalyticsTypeFilter] = useState('')
  const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceLogRow[]>([])
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null)
  const [systemStaff, setSystemStaff] = useState<StaffProfileRow[]>([])

  const [taxis, setTaxis] = useState<TaxiRow[]>([])
  const [taxisError, setTaxisError] = useState<string | null>(null)
  const [taxiOwnerForm, setTaxiOwnerForm] = useState(() => createTaxiOwnerForm())
  const [taxiForm, setTaxiForm] = useState(() => createTaxiForm())
  const [taxiMsg, setTaxiMsg] = useState('')
  const [taxiOperatorFilter, setTaxiOperatorFilter] = useState('')
  const [taxiEditId, setTaxiEditId] = useState('')
  const [taxiEditOwnerId, setTaxiEditOwnerId] = useState('')
  const [taxiEditOwnerForm, setTaxiEditOwnerForm] = useState(() => createTaxiOwnerForm())
  const [taxiEditForm, setTaxiEditForm] = useState(() => createTaxiForm())
  const [taxiEditMsg, setTaxiEditMsg] = useState('')
  const [taxiEditError, setTaxiEditError] = useState<string | null>(null)

  const [bodaBikes, setBodaBikes] = useState<BodaBikeRow[]>([])
  const [bodaError, setBodaError] = useState<string | null>(null)
  const [bodaRiderForm, setBodaRiderForm] = useState(() => createBodaRiderForm())
  const [bodaBikeForm, setBodaBikeForm] = useState(() => createBodaBikeForm())
  const [bodaMsg, setBodaMsg] = useState('')
  const [bodaOperatorFilter, setBodaOperatorFilter] = useState('')
  const [bodaEditId, setBodaEditId] = useState('')
  const [bodaEditRiderId, setBodaEditRiderId] = useState('')
  const [bodaEditRiderForm, setBodaEditRiderForm] = useState(() => createBodaRiderForm())
  const [bodaEditForm, setBodaEditForm] = useState(() => createBodaBikeForm())
  const [bodaEditMsg, setBodaEditMsg] = useState('')
  const [bodaEditError, setBodaEditError] = useState<string | null>(null)

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
  const [loginInlineEdits, setLoginInlineEdits] = useState<Record<string, LoginInlineEdit>>({})
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
    role: 'SACCO',
    operator_id: '',
    vehicle_type: '',
    vehicle_id: '',
  })
  const [loginMsg, setLoginMsg] = useState('')

  const [activeTab, setActiveTab] = useState<SystemTabId>('overview')
  const navigate = useNavigate()
  const location = useLocation()

  const tabs: Array<{ id: SystemTabId; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'registry', label: 'System Registry' },
    { id: 'finance', label: 'Finance' },
    { id: 'c2b', label: 'C2B Payments' },
    { id: 'reconciliation', label: 'Reconciliation' },
    { id: 'quarantine', label: 'Quarantine' },
    { id: 'alerts', label: 'Alerts' },
    { id: 'payouts', label: 'B2C Payouts' },
    { id: 'payout_approvals', label: 'Payout Approvals' },
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

  const loginVehicleOptions = useMemo(() => {
    const operatorId = loginForm.operator_id
    const type = loginForm.vehicle_type
    if (!type) return []
    const matchesOperator = (value?: string | null) => {
      if (!operatorId) return true
      return String(value || '') === String(operatorId)
    }
    if (type === 'SHUTTLE') {
      return shuttles
        .filter((row) => matchesOperator(row.operator_id || row.operator?.id || ''))
        .map((row) => ({
          id: row.id || '',
          label: row.plate || row.id || '',
        }))
        .filter((row) => row.id && row.label)
        .sort((a, b) => a.label.localeCompare(b.label))
    }
    if (type === 'TAXI') {
      return taxis
        .filter((row) => matchesOperator(row.operator_id || row.operator?.id || ''))
        .map((row) => ({
          id: row.id || '',
          label: row.plate || row.id || '',
        }))
        .filter((row) => row.id && row.label)
        .sort((a, b) => a.label.localeCompare(b.label))
    }
    if (type === 'BODA') {
      return bodaBikes
        .filter((row) => matchesOperator(row.operator_id || row.operator?.id || ''))
        .map((row) => ({
          id: row.id || '',
          label: row.identifier || row.id || '',
        }))
        .filter((row) => row.id && row.label)
        .sort((a, b) => a.label.localeCompare(b.label))
    }
    return []
  }, [bodaBikes, loginForm.operator_id, loginForm.vehicle_type, shuttles, taxis])

  const shuttlesById = useMemo(() => {
    const map = new Map<string, ShuttleRow>()
    shuttles.forEach((row) => {
      if (row.id) map.set(row.id, row)
    })
    return map
  }, [shuttles])

  const taxisById = useMemo(() => {
    const map = new Map<string, TaxiRow>()
    taxis.forEach((row) => {
      if (row.id) map.set(row.id, row)
    })
    return map
  }, [taxis])

  const bodaById = useMemo(() => {
    const map = new Map<string, BodaBikeRow>()
    bodaBikes.forEach((row) => {
      if (row.id) map.set(row.id, row)
    })
    return map
  }, [bodaBikes])

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

  const maintenanceCountsByShuttle = useMemo(() => {
    const map = new Map<string, number>()
    const since = new Date()
    since.setDate(since.getDate() - 30)
    maintenanceLogs.forEach((row) => {
      const shuttleId = row.shuttle_id || row.shuttle?.id || ''
      if (!shuttleId) return
      const occurredAt = row.occurred_at ? new Date(row.occurred_at) : null
      if (!occurredAt || Number.isNaN(occurredAt.getTime())) return
      if (occurredAt < since) return
      map.set(shuttleId, (map.get(shuttleId) || 0) + 1)
    })
    return map
  }, [maintenanceLogs])

  const complianceAlerts = useMemo(() => {
    const alerts: Array<{
      id: string
      plate: string
      operatorLabel: string
      expiryType: string
      expiryDate: string
      daysRemaining: number
      status: ExpiryStatus
    }> = []

    const pushAlert = (
      key: string,
      plate: string,
      operatorLabel: string,
      expiryType: string,
      expiryDate?: string | null,
    ) => {
      const info = getExpiryStatus(expiryDate)
      if (info.status === 'expired' || info.status === 'due_soon') {
        alerts.push({
          id: `${key}-${expiryType}`,
          plate,
          operatorLabel,
          expiryType,
          expiryDate: expiryDate || '',
          daysRemaining: info.daysRemaining ?? 0,
          status: info.status,
        })
      }
    }

    shuttles.forEach((row) => {
      const operatorId = row.operator_id || row.operator?.id || ''
      const operatorLabel = operatorLabelFromParts(operatorId, row.operator || null)
      const plate = row.plate || row.id || '-'
      pushAlert(row.id || row.plate || operatorId || plate, plate, operatorLabel, 'TLB', row.tlb_expiry_date)
      pushAlert(row.id || row.plate || operatorId || plate, plate, operatorLabel, 'Insurance', row.insurance_expiry_date)
      pushAlert(row.id || row.plate || operatorId || plate, plate, operatorLabel, 'Inspection', row.inspection_expiry_date)
    })

    taxis.forEach((row) => {
      const operatorId = row.operator_id || row.operator?.id || ''
      const operatorLabel = operatorLabelFromParts(operatorId, row.operator || null)
      const plate = row.plate || row.id || '-'
      pushAlert(row.id || row.plate || operatorId || plate, plate, operatorLabel, 'Insurance', row.insurance_expiry_date)
      pushAlert(row.id || row.plate || operatorId || plate, plate, operatorLabel, 'PSV Badge', row.psv_badge_expiry_date)
    })

    bodaBikes.forEach((row) => {
      const operatorId = row.operator_id || row.operator?.id || ''
      const operatorLabel = operatorLabelFromParts(operatorId, row.operator || null)
      const plate = row.identifier || row.id || '-'
      pushAlert(row.id || row.identifier || operatorId || plate, plate, operatorLabel, 'Insurance', row.insurance_expiry_date)
      pushAlert(row.id || row.identifier || operatorId || plate, plate, operatorLabel, 'License', row.rider?.license_expiry_date)
    })

    return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining)
  }, [shuttles, taxis, bodaBikes, saccoById])

  const analyticsShuttles = useMemo(() => {
    return shuttles.filter((row) => {
      if (analyticsOperatorFilter && (row.operator_id || row.operator?.id || '') !== analyticsOperatorFilter) {
        return false
      }
      if (analyticsTypeFilter) {
        const rowType = normalizeShuttleType(row.vehicle_type)
        if (rowType !== analyticsTypeFilter) return false
      }
      return true
    })
  }, [shuttles, analyticsOperatorFilter, analyticsTypeFilter])

  const analyticsSummary = useMemo(() => {
    let totalSeats = 0
    let totalLoad = 0
    let missingCapacity = 0
    let highRisk = 0
    analyticsShuttles.forEach((row) => {
      const seat = row.seat_capacity || 0
      const load = row.load_capacity_kg || 0
      if (seat > 0) totalSeats += seat
      if (load > 0) totalLoad += load
      if (seat <= 0 && load <= 0) missingCapacity += 1
      const age = getVehicleAge(row.year)
      const riskScore = getRiskScoreForAge(age)
      if (riskScore >= 70) highRisk += 1
    })
    return { totalSeats, totalLoad, missingCapacity, highRisk }
  }, [analyticsShuttles])

  const analyticsByType = useMemo(() => {
    const map = new Map<string, { type: string; count: number }>()
    analyticsShuttles.forEach((row) => {
      const type = normalizeShuttleType(row.vehicle_type) || 'UNKNOWN'
      const existing = map.get(type) || { type, count: 0 }
      existing.count += 1
      map.set(type, existing)
    })
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [analyticsShuttles])

  const analyticsSeatsByOperator = useMemo(() => {
    const map = new Map<string, { id: string; label: string; seats: number; count: number }>()
    analyticsShuttles.forEach((row) => {
      const seat = row.seat_capacity || 0
      if (seat <= 0) return
      const id = row.operator_id || row.operator?.id || ''
      if (!id) return
      const label = operatorLabelFromParts(id, row.operator || null)
      const existing = map.get(id) || { id, label, seats: 0, count: 0 }
      existing.seats += seat
      existing.count += 1
      if (label && existing.label !== label) existing.label = label
      map.set(id, existing)
    })
    return [...map.values()].sort((a, b) => b.seats - a.seats)
  }, [analyticsShuttles])

  const analyticsLoadByOperator = useMemo(() => {
    const map = new Map<string, { id: string; label: string; load: number; count: number }>()
    analyticsShuttles.forEach((row) => {
      const load = row.load_capacity_kg || 0
      if (load <= 0) return
      const id = row.operator_id || row.operator?.id || ''
      if (!id) return
      const label = operatorLabelFromParts(id, row.operator || null)
      const existing = map.get(id) || { id, label, load: 0, count: 0 }
      existing.load += load
      existing.count += 1
      if (label && existing.label !== label) existing.label = label
      map.set(id, existing)
    })
    return [...map.values()].sort((a, b) => b.load - a.load)
  }, [analyticsShuttles])

  const analyticsTopMakes = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>()
    analyticsShuttles.forEach((row) => {
      const label = (row.make || '').trim() || 'Unknown'
      const existing = map.get(label) || { label, count: 0 }
      existing.count += 1
      map.set(label, existing)
    })
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [analyticsShuttles])

  const analyticsTopModels = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>()
    analyticsShuttles.forEach((row) => {
      const label = (row.model || '').trim() || 'Unknown'
      const existing = map.get(label) || { label, count: 0 }
      existing.count += 1
      map.set(label, existing)
    })
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [analyticsShuttles])

  const analyticsMakeModelStats = useMemo(() => {
    const map = new Map<
      string,
      { make: string; model: string; count: number; riskSum: number; ageCounts: Map<string, number> }
    >()
    analyticsShuttles.forEach((row) => {
      const make = (row.make || '').trim() || 'Unknown'
      const model = (row.model || '').trim() || 'Unknown'
      const key = `${make}||${model}`
      const age = getVehicleAge(row.year)
      const riskScore = getRiskScoreForAge(age)
      const existing =
        map.get(key) || {
          make,
          model,
          count: 0,
          riskSum: 0,
          ageCounts: new Map<string, number>(),
        }
      existing.count += 1
      existing.riskSum += riskScore
      const ageKey = age === null ? 'Unknown' : String(age)
      existing.ageCounts.set(ageKey, (existing.ageCounts.get(ageKey) || 0) + 1)
      map.set(key, existing)
    })
    const rows = [...map.values()].map((entry) => {
      let topAge = 'Unknown'
      let topAgeCount = 0
      entry.ageCounts.forEach((count, ageKey) => {
        if (count > topAgeCount) {
          topAge = ageKey
          topAgeCount = count
        }
      })
      const avgRisk = entry.count ? entry.riskSum / entry.count : 0
      return {
        make: entry.make,
        model: entry.model,
        count: entry.count,
        avgRisk,
        commonAge: topAge,
        commonAgeCount: topAgeCount,
      }
    })
    return rows.sort((a, b) => b.avgRisk - a.avgRisk)
  }, [analyticsShuttles])



  const resolveMaintenanceAsset = (row: MaintenanceLogRow) => {
    const rawType = (row.asset_type || (row.shuttle_id ? 'SHUTTLE' : '')).toString().toUpperCase()
    const assetType = rawType || 'SHUTTLE'
    const assetId = row.asset_id || row.shuttle_id || row.shuttle?.id || ''
    let label = assetId || '-'
    let operatorId = row.operator_id || row.operator?.id || ''

    if (assetType === 'SHUTTLE') {
      const shuttle = assetId ? shuttlesById.get(assetId) || null : null
      label = row.shuttle?.plate || shuttle?.plate || label
      operatorId = operatorId || shuttle?.operator_id || row.shuttle?.operator_id || ''
    } else if (assetType === 'TAXI') {
      const taxi = assetId ? taxisById.get(assetId) || null : null
      label = taxi?.plate || label
      operatorId = operatorId || taxi?.operator_id || taxi?.operator?.id || ''
    } else if (assetType === 'BODA') {
      const bike = assetId ? bodaById.get(assetId) || null : null
      label = bike?.identifier || label
      operatorId = operatorId || bike?.operator_id || bike?.operator?.id || ''
    }

    const operatorLabel = operatorId ? operatorLabelFromParts(operatorId, row.operator || null) : '-'
    const assetKey = assetId ? `${assetType}:${assetId}` : ''
    return { assetType, assetId, label, operatorId, operatorLabel, assetKey }
  }

  const maintenanceIssuesThisMonth = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const map = new Map<string, number>()
    maintenanceLogs.forEach((row) => {
      const occurredAt = row.occurred_at ? new Date(row.occurred_at) : null
      if (!occurredAt || Number.isNaN(occurredAt.getTime())) return
      if (occurredAt < monthStart) return
      const category = (row.issue_category || 'UNKNOWN').toUpperCase()
      map.set(category, (map.get(category) || 0) + 1)
    })
    return [...map.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count)
  }, [maintenanceLogs])

  const maintenancePartsSummary = useMemo(() => {
    const map = new Map<string, { part: string; count: number; cost: number }>()
    maintenanceLogs.forEach((row) => {
      const parts = Array.isArray(row.parts_used) ? row.parts_used : []
      parts.forEach((part) => {
        const label = (part?.part_name || part?.name || '').trim() || 'Unknown'
        const qty = Number(part?.qty || 0) || 0
        const unitCost = Number(part?.unit_cost || part?.cost || 0) || 0
        const cost = qty ? unitCost * qty : unitCost
        const existing = map.get(label) || { part: label, count: 0, cost: 0 }
        existing.count += qty || 1
        existing.cost += cost
        map.set(label, existing)
      })
    })
    return [...map.values()].sort((a, b) => b.cost - a.cost || b.count - a.count)
  }, [maintenanceLogs])

  const maintenanceCostByAsset = useMemo(() => {
    const map = new Map<
      string,
      { assetKey: string; assetType: string; assetId: string; label: string; operatorLabel: string; cost: number; count: number }
    >()
    maintenanceLogs.forEach((row) => {
      const info = resolveMaintenanceAsset(row)
      if (!info.assetKey) return
      const cost = Number(row.total_cost_kes || 0) || 0
      const existing = map.get(info.assetKey) || {
        assetKey: info.assetKey,
        assetType: info.assetType,
        assetId: info.assetId,
        label: info.label,
        operatorLabel: info.operatorLabel,
        cost: 0,
        count: 0,
      }
      existing.cost += cost
      existing.count += 1
      map.set(info.assetKey, existing)
    })
    return [...map.values()].sort((a, b) => b.cost - a.cost)
  }, [maintenanceLogs, shuttlesById, taxisById, bodaById, saccoById])

  const maintenanceCostByOperator = useMemo(() => {
    const map = new Map<string, { operatorId: string; label: string; cost: number; count: number }>()
    maintenanceLogs.forEach((row) => {
      const info = resolveMaintenanceAsset(row)
      const operatorId = info.operatorId || ''
      if (!operatorId) return
      const existing = map.get(operatorId) || { operatorId, label: info.operatorLabel, cost: 0, count: 0 }
      existing.cost += Number(row.total_cost_kes || 0) || 0
      existing.count += 1
      map.set(operatorId, existing)
    })
    return [...map.values()].sort((a, b) => b.cost - a.cost)
  }, [maintenanceLogs, shuttlesById, taxisById, bodaById, saccoById])

  const maintenanceDowntimeByAsset = useMemo(() => {
    const map = new Map<
      string,
      { assetKey: string; assetType: string; assetId: string; label: string; downtime: number; count: number }
    >()
    maintenanceLogs.forEach((row) => {
      const info = resolveMaintenanceAsset(row)
      if (!info.assetKey) return
      const downtime = Number(row.downtime_days || 0) || 0
      const existing = map.get(info.assetKey) || {
        assetKey: info.assetKey,
        assetType: info.assetType,
        assetId: info.assetId,
        label: info.label,
        downtime: 0,
        count: 0,
      }
      existing.downtime += downtime
      existing.count += 1
      map.set(info.assetKey, existing)
    })
    return [...map.values()].sort((a, b) => b.downtime - a.downtime)
  }, [maintenanceLogs, shuttlesById, taxisById, bodaById, saccoById])

  const maintenanceStaffPerformance = useMemo(() => {
    const map = new Map<
      string,
      { staffId: string; label: string; count: number; totalDays: number; resolvedCount: number }
    >()
    maintenanceLogs.forEach((row) => {
      const staffId = row.handled_by_user_id || row.handled_by_staff_id || row.handled_by?.id || ''
      if (!staffId) return
      const staffLabel =
        row.handled_by?.name ||
        systemStaff.find((s) => s.user_id === staffId || s.id === staffId)?.name ||
        staffId
      const existing = map.get(staffId) || {
        staffId,
        label: staffLabel,
        count: 0,
        totalDays: 0,
        resolvedCount: 0,
      }
      existing.count += 1
      const occurredAt = row.occurred_at ? new Date(row.occurred_at) : null
      const resolvedAt = row.resolved_at ? new Date(row.resolved_at) : null
      if (occurredAt && resolvedAt && !Number.isNaN(occurredAt.getTime()) && !Number.isNaN(resolvedAt.getTime())) {
        const diffMs = resolvedAt.getTime() - occurredAt.getTime()
        const days = diffMs / 86400000
        if (Number.isFinite(days) && days >= 0) {
          existing.totalDays += days
          existing.resolvedCount += 1
        }
      }
      map.set(staffId, existing)
    })
    return [...map.values()].map((row) => ({
      staffId: row.staffId,
      label: row.label,
      count: row.count,
      avgResolutionDays: row.resolvedCount ? row.totalDays / row.resolvedCount : null,
    }))
  }, [maintenanceLogs, systemStaff])

  const maintenanceRepeatAssets = useMemo(() => {
    const map = new Map<string, { assetKey: string; assetType: string; assetId: string; label: string; count: number }>()
    maintenanceLogs.forEach((row) => {
      const info = resolveMaintenanceAsset(row)
      if (!info.assetKey) return
      const existing = map.get(info.assetKey) || {
        assetKey: info.assetKey,
        assetType: info.assetType,
        assetId: info.assetId,
        label: info.label,
        count: 0,
      }
      existing.count += 1
      map.set(info.assetKey, existing)
    })
    return [...map.values()].filter((row) => row.count >= 2).sort((a, b) => b.count - a.count)
  }, [maintenanceLogs, shuttlesById, taxisById, bodaById, saccoById])


  const taxiOperatorSummary = useMemo(() => {
    const map = new Map<string, { id: string; label: string; count: number }>()
    taxis.forEach((row) => {
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
  }, [taxis, saccoById])

  const filteredTaxis = useMemo(() => {
    if (!taxiOperatorFilter) return taxis
    return taxis.filter((row) => (row.operator_id || row.operator?.id || '') === taxiOperatorFilter)
  }, [taxis, taxiOperatorFilter])

  const bodaOperatorSummary = useMemo(() => {
    const map = new Map<string, { id: string; label: string; count: number }>()
    bodaBikes.forEach((row) => {
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
  }, [bodaBikes, saccoById])

  const filteredBodaBikes = useMemo(() => {
    if (!bodaOperatorFilter) return bodaBikes
    return bodaBikes.filter((row) => (row.operator_id || row.operator?.id || '') === bodaOperatorFilter)
  }, [bodaBikes, bodaOperatorFilter])

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

  const paybillCodesBySaccoId = useMemo(() => {
    const map = new Map<string, { fee?: string; loan?: string; savings?: string }>()
    paybillAliases.forEach((row) => {
      if (String(row.entity_type || '').toUpperCase() !== 'SACCO') return
      if (row.alias_type !== 'PAYBILL_CODE') return
      const id = row.entity_id || ''
      if (!id) return
      const entry = map.get(id) || {}
      const kind = String(row.wallet_kind || '').toUpperCase()
      if (kind === 'SACCO_DAILY_FEE') entry.fee = row.alias || ''
      if (kind === 'SACCO_LOAN') entry.loan = row.alias || ''
      if (kind === 'SACCO_SAVINGS') entry.savings = row.alias || ''
      map.set(id, entry)
    })
    return map
  }, [paybillAliases])

  const paybillCodesByMatatuId = useMemo(() => {
    const map = new Map<string, { owner?: string; vehicle?: string; plate?: string }>()
    paybillAliases.forEach((row) => {
      if (String(row.entity_type || '').toUpperCase() !== 'MATATU') return
      const id = row.entity_id || ''
      if (!id) return
      const entry = map.get(id) || {}
      const kind = String(row.wallet_kind || '').toUpperCase()
      const aliasType = String(row.alias_type || '').toUpperCase()
      if (aliasType === 'PAYBILL_CODE') {
        if (kind === 'MATATU_OWNER') entry.owner = row.alias || ''
        if (kind === 'MATATU_VEHICLE') entry.vehicle = row.alias || ''
      }
      if (aliasType === 'PLATE' && kind === 'MATATU_VEHICLE') {
        entry.plate = row.alias || ''
      }
      map.set(id, entry)
    })
    return map
  }, [paybillAliases])

  const paybillMatatuIdByPlate = useMemo(() => {
    const map = new Map<string, string>()
    paybillAliases.forEach((row) => {
      if (String(row.alias_type || '').toUpperCase() !== 'PLATE') return
      const plate = normalizePlateInput(row.alias || '')
      const entityId = row.entity_id || ''
      if (!plate || !entityId) return
      map.set(plate, entityId)
    })
    return map
  }, [paybillAliases])

  const paybillCodesByTaxiId = useMemo(() => {
    const map = new Map<string, { code?: string }>()
    paybillAliases.forEach((row) => {
      if (String(row.entity_type || '').toUpperCase() !== 'TAXI') return
      if (String(row.alias_type || '').toUpperCase() !== 'PAYBILL_CODE') return
      const id = row.entity_id || ''
      if (!id) return
      map.set(id, { code: row.alias || '' })
    })
    return map
  }, [paybillAliases])

  const paybillCodesByBodaId = useMemo(() => {
    const map = new Map<string, { code?: string }>()
    paybillAliases.forEach((row) => {
      const entityType = String(row.entity_type || '').toUpperCase()
      if (entityType !== 'BODA' && entityType !== 'BODABODA') return
      if (String(row.alias_type || '').toUpperCase() !== 'PAYBILL_CODE') return
      const id = row.entity_id || ''
      if (!id) return
      map.set(id, { code: row.alias || '' })
    })
    return map
  }, [paybillAliases])

  const paybillRows = useMemo(() => {
    const rows: Array<{
      type: 'MATATU' | 'SACCO'
      id: string
      label: string
      paybill_account: string
      ussd_code: string
      ussd_assigned_at: string
      parent: string
      owner_code?: string
      vehicle_code?: string
      plate_alias?: string
      fee_code?: string
      loan_code?: string
      savings_code?: string
    }> = []

    matatus.forEach((row) => {
      if (!row.id) return
      const ussdRow = ussdByMatatuId.get(row.id)
      const codes = paybillCodesByMatatuId.get(row.id)
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
        owner_code: codes?.owner || '',
        vehicle_code: codes?.vehicle || '',
        plate_alias: codes?.plate || '',
      })
    })

    saccos.forEach((row) => {
      const id = row.id || row.sacco_id
      if (!id) return
      const ussdRow = ussdBySaccoId.get(id)
      const codes = paybillCodesBySaccoId.get(id)
      rows.push({
        type: 'SACCO',
        id,
        label: row.display_name || row.name || row.sacco_name || id,
        paybill_account: row.default_till || '',
        ussd_code: ussdRow ? formatUssdCode(ussdRow) : '',
        ussd_assigned_at: ussdRow?.allocated_at || '',
        parent: '',
        fee_code: codes?.fee || '',
        loan_code: codes?.loan || '',
        savings_code: codes?.savings || '',
      })
    })

    return rows
  }, [matatus, saccos, saccoById, ussdByMatatuId, ussdBySaccoId, paybillCodesByMatatuId, paybillCodesBySaccoId])

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

  async function deleteSacco(row: SaccoRow) {
    const id = row.id || row.sacco_id
    if (!id) return
    const label = row.display_name || row.name || row.sacco_name || row.sacco_id || row.id || id
    if (!confirm(`Delete operator ${label}? This cannot be undone.`)) return
    setSaccosError(null)
    try {
      await deleteJson(`/api/admin/delete-sacco/${encodeURIComponent(id)}`)
      if (saccoEditId === id) {
        setSaccoEditId('')
        setSaccoEditMsg('')
        setSaccoEditError(null)
      }
      const rows = await fetchList<SaccoRow>('/api/admin/saccos')
      setSaccos(rows)
    } catch (err) {
      setSaccosError(err instanceof Error ? err.message : 'Delete failed')
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

  function operatorLabelFromParts(operatorId?: string | null, operator?: ShuttleOperatorRow | null) {
    const id = operatorId || ''
    const operatorRow = id ? saccoById.get(id) : null
    return (
      operator?.display_name ||
      operator?.name ||
      operator?.sacco_name ||
      operatorRow?.display_name ||
      operatorRow?.name ||
      id ||
      '-'
    )
  }

  function operatorLabelFor(row?: ShuttleRow | null) {
    if (!row) return '-'
    return operatorLabelFromParts(row.operator_id || row.operator?.id || '', row.operator || null)
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
    const plate = normalizePlateInput(shuttleForm.plate)
    if (!plate) {
      setShuttleMsg('Shuttle plate/identifier is required')
      return
    }
    if (!isValidPlateInput(plate)) {
      setShuttleMsg('Plate must match format ABC123D')
      return
    }
    const shuttlePayload = {
      plate,
      make: shuttleForm.make.trim() || null,
      model: shuttleForm.model.trim() || null,
      year: parseYearInput(shuttleForm.year),
      vehicle_type: vehicleType || null,
      vehicle_type_other: vehicleType === 'OTHER' ? shuttleForm.vehicle_type_other.trim() || null : null,
      seat_capacity: shouldShowSeatCapacity(vehicleType) || vehicleType === 'OTHER' ? seatCapacity : null,
      load_capacity_kg: shouldShowLoadCapacity(vehicleType) || vehicleType === 'OTHER' ? loadCapacity : null,
      operator_id: shuttleForm.operator_id || null,
      till_number: shuttleForm.till_number.trim() || null,
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
    setShuttleMsg('Saving...')
    try {
      await sendJson('/api/admin/register-shuttle', 'POST', {
        owner: ownerPayload,
        shuttle: shuttlePayload,
      })
      setShuttleMsg('Shuttle registered')
      resetShuttleFormState()
      await loadShuttles()
      await loadPaybillAliases()
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
    const plate = normalizePlateInput(shuttleEditForm.plate)
    if (!plate) {
      setShuttleEditMsg('Shuttle plate/identifier is required')
      return
    }
    if (!isValidPlateInput(plate)) {
      setShuttleEditMsg('Plate must match format ABC123D')
      return
    }
    const shuttlePayload = {
      plate,
      make: shuttleEditForm.make.trim() || null,
      model: shuttleEditForm.model.trim() || null,
      year: parseYearInput(shuttleEditForm.year),
      vehicle_type: vehicleType || null,
      vehicle_type_other: vehicleType === 'OTHER' ? shuttleEditForm.vehicle_type_other.trim() || null : null,
      seat_capacity: shouldShowSeatCapacity(vehicleType) || vehicleType === 'OTHER' ? seatCapacity : null,
      load_capacity_kg: shouldShowLoadCapacity(vehicleType) || vehicleType === 'OTHER' ? loadCapacity : null,
      operator_id: shuttleEditForm.operator_id || null,
      till_number: shuttleEditForm.till_number.trim() || null,
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
      await loadPaybillAliases()
    } catch (err) {
      setShuttleEditMsg('')
      setShuttleEditError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function deleteShuttle(row: ShuttleRow) {
    const id = row.id
    if (!id) return
    const label = row.plate || id
    if (!confirm(`Delete shuttle ${label}? This cannot be undone.`)) return
    setShuttlesError(null)
    try {
      await deleteJson(`/api/admin/delete-shuttle/${encodeURIComponent(id)}`)
      if (shuttleEditId === id) {
        resetShuttleEditState()
      }
      await loadShuttles()
    } catch (err) {
      setShuttlesError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  function resetTaxiFormState() {
    setTaxiOwnerForm(createTaxiOwnerForm())
    setTaxiForm(createTaxiForm())
  }

  function resetTaxiEditState() {
    setTaxiEditId('')
    setTaxiEditOwnerId('')
    setTaxiEditOwnerForm(createTaxiOwnerForm())
    setTaxiEditForm(createTaxiForm())
    setTaxiEditMsg('')
    setTaxiEditError(null)
  }

  function startTaxiEdit(row: TaxiRow) {
    const id = row.id
    if (!id) return
    if (taxiEditId === id) {
      resetTaxiEditState()
      return
    }
    const owner = row.owner || {}
    setTaxiEditId(id)
    setTaxiEditOwnerId(row.owner_id || row.owner?.id || '')
    setTaxiEditOwnerForm({
      full_name: owner.full_name || '',
      id_number: owner.id_number || '',
      phone: owner.phone || '',
      email: owner.email || '',
      address: owner.address || '',
      license_no: owner.license_no || '',
      date_of_birth: formatDateInput(owner.date_of_birth),
    })
    setTaxiEditForm({
      plate: row.plate || '',
      make: row.make || '',
      model: row.model || '',
      year: row.year ? String(row.year) : '',
      operator_id: row.operator_id || row.operator?.id || '',
      till_number: row.till_number || '',
      seat_capacity: row.seat_capacity ? String(row.seat_capacity) : '',
      category: normalizeTaxiCategory(row.category) || '',
      category_other: row.category_other || '',
    })
    setTaxiEditMsg('')
    setTaxiEditError(null)
  }

  async function submitTaxi() {
    const ownerPayload = {
      full_name: taxiOwnerForm.full_name.trim(),
      id_number: taxiOwnerForm.id_number.trim(),
      phone: normalizePhoneInput(taxiOwnerForm.phone),
      email: taxiOwnerForm.email.trim() || null,
      address: taxiOwnerForm.address.trim() || null,
      license_no: taxiOwnerForm.license_no.trim() || null,
      date_of_birth: taxiOwnerForm.date_of_birth || null,
    }
    const category = normalizeTaxiCategory(taxiForm.category)
    const seatCapacityInput = taxiForm.seat_capacity.trim()
    const seatCapacity = parsePositiveIntInput(seatCapacityInput)
    const plate = normalizePlateInput(taxiForm.plate)
    if (!plate) {
      setTaxiMsg('Taxi plate/identifier is required')
      return
    }
    if (!isValidPlateInput(plate)) {
      setTaxiMsg('Plate must match format ABC123D')
      return
    }
    const taxiPayload = {
      plate,
      make: taxiForm.make.trim() || null,
      model: taxiForm.model.trim() || null,
      year: parseYearInput(taxiForm.year),
      operator_id: taxiForm.operator_id || null,
      till_number: taxiForm.till_number.trim() || null,
      seat_capacity: seatCapacityInput ? seatCapacity : null,
      category: category || null,
      category_other: category === 'OTHER' ? taxiForm.category_other.trim() || null : null,
    }
    if (!ownerPayload.full_name) {
      setTaxiMsg('Driver/owner full name is required')
      return
    }
    if (!ownerPayload.id_number) {
      setTaxiMsg('Driver/owner ID number is required')
      return
    }
    if (!ownerPayload.phone) {
      setTaxiMsg('Driver/owner phone number is required')
      return
    }
    if (!isValidKenyanPhone(ownerPayload.phone)) {
      setTaxiMsg('Enter a valid Kenyan phone number')
      return
    }
    if (!taxiPayload.operator_id) {
      setTaxiMsg('Operator is required')
      return
    }
    if (!category) {
      setTaxiMsg('Taxi category is required')
      return
    }
    if (seatCapacityInput && !seatCapacity) {
      setTaxiMsg('Seat capacity must be a positive integer')
      return
    }
    setTaxiMsg('Saving...')
    try {
      await sendJson('/api/admin/register-taxi', 'POST', {
        owner: ownerPayload,
        taxi: taxiPayload,
      })
      setTaxiMsg('Taxi registered')
      resetTaxiFormState()
      await loadTaxis()
      await loadPaybillAliases()
    } catch (err) {
      setTaxiMsg(err instanceof Error ? err.message : 'Create failed')
    }
  }

  async function saveTaxiEdit() {
    if (!taxiEditId) return
    const ownerPayload = {
      full_name: taxiEditOwnerForm.full_name.trim(),
      id_number: taxiEditOwnerForm.id_number.trim(),
      phone: normalizePhoneInput(taxiEditOwnerForm.phone),
      email: taxiEditOwnerForm.email.trim() || null,
      address: taxiEditOwnerForm.address.trim() || null,
      license_no: taxiEditOwnerForm.license_no.trim() || null,
      date_of_birth: taxiEditOwnerForm.date_of_birth || null,
    }
    const category = normalizeTaxiCategory(taxiEditForm.category)
    const seatCapacityInput = taxiEditForm.seat_capacity.trim()
    const seatCapacity = parsePositiveIntInput(seatCapacityInput)
    const plate = normalizePlateInput(taxiEditForm.plate)
    if (!plate) {
      setTaxiEditMsg('Taxi plate/identifier is required')
      return
    }
    if (!isValidPlateInput(plate)) {
      setTaxiEditMsg('Plate must match format ABC123D')
      return
    }
    const taxiPayload = {
      plate,
      make: taxiEditForm.make.trim() || null,
      model: taxiEditForm.model.trim() || null,
      year: parseYearInput(taxiEditForm.year),
      operator_id: taxiEditForm.operator_id || null,
      till_number: taxiEditForm.till_number.trim() || null,
      seat_capacity: seatCapacityInput ? seatCapacity : null,
      category: category || null,
      category_other: category === 'OTHER' ? taxiEditForm.category_other.trim() || null : null,
    }
    if (!ownerPayload.full_name) {
      setTaxiEditMsg('Driver/owner full name is required')
      return
    }
    if (!ownerPayload.id_number) {
      setTaxiEditMsg('Driver/owner ID number is required')
      return
    }
    if (!ownerPayload.phone) {
      setTaxiEditMsg('Driver/owner phone number is required')
      return
    }
    if (!isValidKenyanPhone(ownerPayload.phone)) {
      setTaxiEditMsg('Enter a valid Kenyan phone number')
      return
    }
    if (!taxiPayload.operator_id) {
      setTaxiEditMsg('Operator is required')
      return
    }
    if (!category) {
      setTaxiEditMsg('Taxi category is required')
      return
    }
    if (seatCapacityInput && !seatCapacity) {
      setTaxiEditMsg('Seat capacity must be a positive integer')
      return
    }
    setTaxiEditMsg('Saving...')
    setTaxiEditError(null)
    try {
      await sendJson('/api/admin/update-taxi', 'POST', {
        id: taxiEditId,
        owner_id: taxiEditOwnerId || null,
        owner: ownerPayload,
        taxi: taxiPayload,
      })
      setTaxiEditMsg('Taxi updated')
      resetTaxiEditState()
      await loadTaxis()
    } catch (err) {
      setTaxiEditMsg('')
      setTaxiEditError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function deleteTaxi(row: TaxiRow) {
    const id = row.id
    if (!id) return
    const label = row.plate || id
    if (!confirm(`Delete taxi ${label}? This cannot be undone.`)) return
    setTaxisError(null)
    try {
      await deleteJson(`/api/admin/delete-taxi/${encodeURIComponent(id)}`)
      if (taxiEditId === id) {
        resetTaxiEditState()
      }
      await loadTaxis()
    } catch (err) {
      setTaxisError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  function resetBodaFormState() {
    setBodaRiderForm(createBodaRiderForm())
    setBodaBikeForm(createBodaBikeForm())
  }

  function resetBodaEditState() {
    setBodaEditId('')
    setBodaEditRiderId('')
    setBodaEditRiderForm(createBodaRiderForm())
    setBodaEditForm(createBodaBikeForm())
    setBodaEditMsg('')
    setBodaEditError(null)
  }

  function startBodaEdit(row: BodaBikeRow) {
    const id = row.id
    if (!id) return
    if (bodaEditId === id) {
      resetBodaEditState()
      return
    }
    const rider = row.rider || {}
    setBodaEditId(id)
    setBodaEditRiderId(row.rider_id || row.rider?.id || '')
    setBodaEditRiderForm({
      full_name: rider.full_name || '',
      id_number: rider.id_number || '',
      phone: rider.phone || '',
      email: rider.email || '',
      address: rider.address || '',
      stage: rider.stage || '',
      town: rider.town || '',
      date_of_birth: formatDateInput(rider.date_of_birth),
    })
    setBodaEditForm({
      identifier: row.identifier || '',
      make: row.make || '',
      model: row.model || '',
      year: row.year ? String(row.year) : '',
      operator_id: row.operator_id || row.operator?.id || '',
      till_number: row.till_number || '',
      license_no: row.license_no || '',
      has_helmet: Boolean(row.has_helmet),
      has_reflector: Boolean(row.has_reflector),
    })
    setBodaEditMsg('')
    setBodaEditError(null)
  }

  async function submitBoda() {
    const riderPayload = {
      full_name: bodaRiderForm.full_name.trim(),
      id_number: bodaRiderForm.id_number.trim(),
      phone: normalizePhoneInput(bodaRiderForm.phone),
      email: bodaRiderForm.email.trim() || null,
      address: bodaRiderForm.address.trim() || null,
      stage: bodaRiderForm.stage.trim() || null,
      town: bodaRiderForm.town.trim() || null,
      date_of_birth: bodaRiderForm.date_of_birth || null,
    }
    const bikePayload = {
      identifier: bodaBikeForm.identifier.trim(),
      make: bodaBikeForm.make.trim() || null,
      model: bodaBikeForm.model.trim() || null,
      year: parseYearInput(bodaBikeForm.year),
      operator_id: bodaBikeForm.operator_id || null,
      till_number: bodaBikeForm.till_number.trim() || null,
      license_no: bodaBikeForm.license_no.trim() || null,
      has_helmet: Boolean(bodaBikeForm.has_helmet),
      has_reflector: Boolean(bodaBikeForm.has_reflector),
    }
    if (!riderPayload.full_name) {
      setBodaMsg('Rider full name is required')
      return
    }
    if (!riderPayload.id_number) {
      setBodaMsg('Rider ID number is required')
      return
    }
    if (!riderPayload.phone) {
      setBodaMsg('Rider phone number is required')
      return
    }
    if (!isValidKenyanPhone(riderPayload.phone)) {
      setBodaMsg('Enter a valid Kenyan phone number')
      return
    }
    if (!bikePayload.identifier) {
      setBodaMsg('Bike identifier is required')
      return
    }
    if (!bikePayload.operator_id) {
      setBodaMsg('Operator is required')
      return
    }
    setBodaMsg('Saving...')
    try {
      await sendJson('/api/admin/register-boda', 'POST', {
        rider: riderPayload,
        bike: bikePayload,
      })
      setBodaMsg('Boda registered')
      resetBodaFormState()
      await loadBodaBikes()
      await loadPaybillAliases()
    } catch (err) {
      setBodaMsg(err instanceof Error ? err.message : 'Create failed')
    }
  }

  async function saveBodaEdit() {
    if (!bodaEditId) return
    const riderPayload = {
      full_name: bodaEditRiderForm.full_name.trim(),
      id_number: bodaEditRiderForm.id_number.trim(),
      phone: normalizePhoneInput(bodaEditRiderForm.phone),
      email: bodaEditRiderForm.email.trim() || null,
      address: bodaEditRiderForm.address.trim() || null,
      stage: bodaEditRiderForm.stage.trim() || null,
      town: bodaEditRiderForm.town.trim() || null,
      date_of_birth: bodaEditRiderForm.date_of_birth || null,
    }
    const bikePayload = {
      identifier: bodaEditForm.identifier.trim(),
      make: bodaEditForm.make.trim() || null,
      model: bodaEditForm.model.trim() || null,
      year: parseYearInput(bodaEditForm.year),
      operator_id: bodaEditForm.operator_id || null,
      till_number: bodaEditForm.till_number.trim() || null,
      license_no: bodaEditForm.license_no.trim() || null,
      has_helmet: Boolean(bodaEditForm.has_helmet),
      has_reflector: Boolean(bodaEditForm.has_reflector),
    }
    if (!riderPayload.full_name) {
      setBodaEditMsg('Rider full name is required')
      return
    }
    if (!riderPayload.id_number) {
      setBodaEditMsg('Rider ID number is required')
      return
    }
    if (!riderPayload.phone) {
      setBodaEditMsg('Rider phone number is required')
      return
    }
    if (!isValidKenyanPhone(riderPayload.phone)) {
      setBodaEditMsg('Enter a valid Kenyan phone number')
      return
    }
    if (!bikePayload.identifier) {
      setBodaEditMsg('Bike identifier is required')
      return
    }
    if (!bikePayload.operator_id) {
      setBodaEditMsg('Operator is required')
      return
    }
    setBodaEditMsg('Saving...')
    setBodaEditError(null)
    try {
      await sendJson('/api/admin/update-boda', 'POST', {
        id: bodaEditId,
        rider_id: bodaEditRiderId || null,
        rider: riderPayload,
        bike: bikePayload,
      })
      setBodaEditMsg('Boda updated')
      resetBodaEditState()
      await loadBodaBikes()
    } catch (err) {
      setBodaEditMsg('')
      setBodaEditError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function deleteBoda(row: BodaBikeRow) {
    const id = row.id
    if (!id) return
    const label = row.identifier || id
    if (!confirm(`Delete boda bike ${label}? This cannot be undone.`)) return
    setBodaError(null)
    try {
      await deleteJson(`/api/admin/delete-boda/${encodeURIComponent(id)}`)
      if (bodaEditId === id) {
        resetBodaEditState()
      }
      await loadBodaBikes()
    } catch (err) {
      setBodaError(err instanceof Error ? err.message : 'Delete failed')
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

  async function loadReconciliation({
    from,
    to,
  }: {
    from?: string
    to?: string
  } = {}) {
    const fromValue = from ?? reconFrom
    const toValue = to ?? reconTo
    if (from !== undefined) setReconFrom(fromValue)
    if (to !== undefined) setReconTo(toValue)
    try {
      const params = new URLSearchParams()
      if (fromValue) params.set('from', fromValue)
      if (toValue) params.set('to', toValue)
      const res = await fetchJson<{
        paybill_c2b?: ReconciliationPaybillRow[]
        channels?: ReconciliationChannelRow[]
        combined?: ReconciliationCombinedRow[]
      }>(
        `/api/admin/reconciliation?${params.toString()}`,
      )
      setReconPaybillRows(res.paybill_c2b || [])
      setReconChannelRows(res.channels || [])
      setReconCombinedRows(res.combined || [])
      setReconError(null)
    } catch (err) {
      setReconPaybillRows([])
      setReconChannelRows([])
      setReconCombinedRows([])
      setReconError(err instanceof Error ? err.message : String(err))
    }
  }

  const reconC2bMap = useMemo(() => {
    const map: Record<string, ReconciliationPaybillRow> = {}
    reconPaybillRows.forEach((row) => {
      if (!row.date) return
      map[row.date] = row
    })
    return map
  }, [reconPaybillRows])

  const reconStkMap = useMemo(() => {
    const map: Record<string, ReconciliationChannelRow> = {}
    reconChannelRows.forEach((row) => {
      if (!row.date || row.channel !== 'STK') return
      map[row.date] = row
    })
    return map
  }, [reconChannelRows])

  const reconCombinedMap = useMemo(() => {
    const map: Record<string, ReconciliationCombinedRow> = {}
    reconCombinedRows.forEach((row) => {
      if (!row.date) return
      map[row.date] = row
    })
    return map
  }, [reconCombinedRows])

  const reconDates = useMemo(() => {
    const set = new Set<string>()
    reconCombinedRows.forEach((row) => {
      if (row.date) set.add(row.date)
    })
    reconPaybillRows.forEach((row) => {
      if (row.date) set.add(row.date)
    })
    reconChannelRows.forEach((row) => {
      if (row.date && row.channel === 'STK') set.add(row.date)
    })
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1))
  }, [reconCombinedRows, reconPaybillRows, reconChannelRows])

  function updateQuarantineAction(id: string, patch: Partial<QuarantineActionState>) {
    setQuarantineActions((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), ...patch },
    }))
  }

  async function loadQuarantine({
    page,
    limit,
    riskLevel,
    flag,
    search,
  }: {
    page?: number
    limit?: number
    riskLevel?: string
    flag?: string
    search?: string
  } = {}) {
    const pageValue = page !== undefined ? page : quarantinePage
    const limitValue = limit !== undefined ? limit : quarantineLimit
    const riskValue = riskLevel !== undefined ? riskLevel : quarantineRiskLevel
    const flagValue = flag !== undefined ? flag : quarantineFlag
    const searchValue = search !== undefined ? search : quarantineSearch

    if (page !== undefined) setQuarantinePage(pageValue)
    if (limit !== undefined) setQuarantineLimit(limitValue)
    if (riskLevel !== undefined) setQuarantineRiskLevel(riskValue)
    if (flag !== undefined) setQuarantineFlag(flagValue)
    if (search !== undefined) setQuarantineSearch(searchValue)

    try {
      const params = new URLSearchParams()
      params.set('status', 'QUARANTINED')
      if (riskValue) params.set('risk_level', riskValue)
      if (flagValue) params.set('flag', flagValue)
      if (searchValue.trim()) params.set('q', searchValue.trim())
      params.set('limit', String(limitValue))
      params.set('offset', String(Math.max(0, (pageValue - 1) * limitValue)))
      const res = await fetchJson<{ items?: QuarantineRow[]; total?: number }>(
        `/api/admin/c2b/quarantine?${params.toString()}`,
      )
      setQuarantineRows(res.items || [])
      setQuarantineTotal(res.total || 0)
      setQuarantineError(null)
    } catch (err) {
      setQuarantineRows([])
      setQuarantineTotal(0)
      setQuarantineError(err instanceof Error ? err.message : String(err))
    }
  }

  async function resolveQuarantine(id: string, action: 'CREDIT' | 'REJECT') {
    if (!id) return
    const current = quarantineActions[id] || {}
    updateQuarantineAction(id, { busy: true, error: '', msg: '' })
    try {
      const payload: Record<string, unknown> = {
        action,
        note: current.note?.trim() || null,
      }
      if (current.wallet_id?.trim()) payload.wallet_id = current.wallet_id.trim()
      const res = await sendJson<{ message?: string }>(
        `/api/admin/c2b/${encodeURIComponent(id)}/resolve`,
        'POST',
        payload,
      )
      updateQuarantineAction(id, { busy: false, error: '', msg: res?.message || 'Resolved' })
      await loadQuarantine({ page: quarantinePage })
    } catch (err) {
      updateQuarantineAction(id, {
        busy: false,
        error: err instanceof Error ? err.message : 'Resolve failed',
        msg: '',
      })
    }
  }

  async function loadAlerts({
    page,
    limit,
    severity,
    type,
  }: {
    page?: number
    limit?: number
    severity?: string
    type?: string
  } = {}) {
    const pageValue = page !== undefined ? page : alertsPage
    const limitValue = limit !== undefined ? limit : alertsLimit
    const severityValue = severity !== undefined ? severity : alertsSeverity
    const typeValue = type !== undefined ? type : alertsType

    if (page !== undefined) setAlertsPage(pageValue)
    if (limit !== undefined) setAlertsLimit(limitValue)
    if (severity !== undefined) setAlertsSeverity(severityValue)
    if (type !== undefined) setAlertsType(typeValue)

    try {
      const params = new URLSearchParams()
      if (severityValue) params.set('severity', severityValue)
      if (typeValue) params.set('type', typeValue)
      params.set('limit', String(limitValue))
      params.set('offset', String(Math.max(0, (pageValue - 1) * limitValue)))
      const res = await fetchJson<{ items?: OpsAlertRow[]; total?: number }>(
        `/api/admin/ops-alerts?${params.toString()}`,
      )
      setAlertsRows(res.items || [])
      setAlertsTotal(res.total || 0)
      setAlertsError(null)
    } catch (err) {
      setAlertsRows([])
      setAlertsTotal(0)
      setAlertsError(err instanceof Error ? err.message : String(err))
    }
  }

  async function loadPayoutApprovals(status?: string) {
    const nextStatus = status !== undefined ? status : payoutApprovalStatus
    if (status !== undefined) setPayoutApprovalStatus(nextStatus)
    try {
      const params = new URLSearchParams()
      if (nextStatus) params.set('status', nextStatus)
      const res = await fetchJson<{ batches?: PayoutBatchRow[] }>(
        `/api/admin/payout-batches?${params.toString()}`,
      )
      setPayoutApprovalRows(res.batches || [])
      setPayoutApprovalError(null)
      const batches = res.batches || []
      batches.forEach((row) => {
        if (row.id && !payoutReadinessMap[row.id]) {
          void loadBatchReadiness(row.id)
        }
      })
    } catch (err) {
      setPayoutApprovalRows([])
      setPayoutApprovalError(err instanceof Error ? err.message : String(err))
    }
  }

  async function loadBatchReadiness(batchId: string) {
    if (!batchId) return
    try {
      const res = await fetchJson<BatchReadiness>(`/api/payout-batches/${encodeURIComponent(batchId)}/readiness`)
      setPayoutReadinessMap((prev) => ({ ...prev, [batchId]: res }))
      if (batchId === payoutApprovalSelected) {
        setPayoutApprovalReadiness(res)
      }
    } catch (err) {
      setPayoutReadinessMap((prev) => ({
        ...prev,
        [batchId]: { issues: [{ code: 'READINESS_LOAD_FAILED', level: 'WARN', message: String(err) }] },
      }))
      if (batchId === payoutApprovalSelected) {
        setPayoutApprovalReadiness(null)
      }
    }
  }

  async function loadPayoutApprovalDetail(batchId: string) {
    if (!batchId) return
    setPayoutApprovalSelected(batchId)
    setPayoutApprovalMsg('Loading batch...')
    try {
      const res = await fetchJson<{ batch?: PayoutBatchRow; items?: PayoutItemRow[]; events?: PayoutEventRow[] }>(
        `/api/admin/payout-batches/${encodeURIComponent(batchId)}`,
      )
      setPayoutApprovalDetail(res.batch || null)
      setPayoutApprovalItems(res.items || [])
      setPayoutApprovalEvents(res.events || [])
      await loadBatchReadiness(batchId)
      setPayoutApprovalMsg('')
    } catch (err) {
      setPayoutApprovalMsg(err instanceof Error ? err.message : 'Failed to load batch')
    }
  }

  async function approvePayoutBatch(batchId: string) {
    if (!batchId) return
    setPayoutApprovalMsg('Approving batch...')
    try {
      await sendJson(`/api/admin/payout-batches/${encodeURIComponent(batchId)}/approve`, 'POST', {})
      setPayoutApprovalMsg('Approved')
      await loadPayoutApprovals()
      await loadPayoutApprovalDetail(batchId)
    } catch (err) {
      setPayoutApprovalMsg(err instanceof Error ? err.message : 'Approval failed')
    }
  }

  async function processPayoutBatch(batchId: string) {
    if (!batchId) return
    setPayoutApprovalMsg('Processing batch...')
    try {
      await sendJson(`/api/admin/payout-batches/${encodeURIComponent(batchId)}/process`, 'POST', {})
      setPayoutApprovalMsg('Processing started')
      await loadPayoutApprovals()
      await loadPayoutApprovalDetail(batchId)
    } catch (err) {
      setPayoutApprovalMsg(err instanceof Error ? err.message : 'Process failed')
    }
  }

  async function copyPayoutValue(value: string, label: string) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setPayoutApprovalMsg(label)
    } catch (err) {
      setPayoutApprovalMsg(err instanceof Error ? err.message : 'Copy failed')
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
    if (activeTab === 'reconciliation') {
      void loadReconciliation()
    }
    if (activeTab === 'quarantine') {
      void loadQuarantine({ page: 1 })
    }
    if (activeTab === 'alerts') {
      void loadAlerts({ page: 1 })
    }
    if (activeTab === 'payout_approvals') {
      void loadPayoutApprovals()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      { key: 'receipt', label: 'M-Pesa Receipt' },
      { key: 'msisdn', label: 'Phone' },
      { key: 'amount', label: 'Amount' },
      { key: 'paybill_number', label: 'Paybill' },
      { key: 'account_reference', label: 'Account' },
      { key: 'status', label: 'Status' },
      { key: 'created_at', label: 'Created At' },
    ]
    const rows: CsvRow[] = c2bRows.map((row) => ({
      id: row.id || '',
      receipt: row.receipt || '',
      msisdn: row.msisdn || '',
      amount: row.amount ?? 0,
      paybill_number: row.paybill_number || '',
      account_reference: row.account_reference || '',
      status: row.status || '',
      created_at: row.created_at || '',
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
    const paybillAccount = normalizeDigitsInput(paybillForm.paybill_account)
    const ussdInput = paybillForm.ussd_code.trim()

    if (!targetId) {
      setPaybillMsg(`Select a ${level === 'MATATU' ? 'matatu' : 'SACCO'}`)
      return
    }
    if (!paybillAccount) {
      setPaybillMsg('Enter a paybill account')
      return
    }
    if (level === 'MATATU' && !isValidManualAccountCode(paybillAccount)) {
      setPaybillMsg('Manual account code must be 7 digits')
      return
    }
    if (level === 'SACCO' && !isValidPaybillOrTill(paybillAccount)) {
      setPaybillMsg('Paybill/Till must be 5-7 digits')
      return
    }

    try {
      if (level === 'MATATU') {
        await sendJson('/api/admin/update-matatu', 'POST', { id: targetId, till_number: paybillAccount })
        try {
          const rows = await fetchList<VehicleRow>('/api/admin/matatus')
          setMatatus(rows)
        } catch (err) {
          console.warn('matatu refresh failed', err)
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
    await loadPaybillAliases()
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
      console.warn('matatu refresh failed', err)
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

  async function loadPaybillAliases() {
    try {
      const rows = await fetchList<PaybillAliasRow>('/api/admin/paybill-codes')
      setPaybillAliases(rows)
    } catch (err) {
      setPaybillAliases([])
    }
  }







  async function loadMaintenanceLogs() {
    try {
      const rows = await fetchList<MaintenanceLogRow>('/api/admin/maintenance-logs')
      setMaintenanceLogs(rows)
      setMaintenanceError(null)
    } catch (err) {
      setMaintenanceLogs([])
      setMaintenanceError(err instanceof Error ? err.message : String(err))
    }
  }

  async function loadSystemStaff() {
    try {
      const rows = await fetchList<StaffProfileRow>('/api/admin/staff')
      setSystemStaff(rows)
    } catch (err) {
      setSystemStaff([])
    }
  }

  async function loadTaxis() {
    try {
      const rows = await fetchList<TaxiRow>('/api/admin/taxis')
      setTaxis(rows)
      setTaxisError(null)
    } catch (err) {
      setTaxis([])
      setTaxisError(err instanceof Error ? err.message : String(err))
    }
  }

  async function loadBodaBikes() {
    try {
      const rows = await fetchList<BodaBikeRow>('/api/admin/boda-bikes')
      setBodaBikes(rows)
      setBodaError(null)
    } catch (err) {
      setBodaBikes([])
      setBodaError(err instanceof Error ? err.message : String(err))
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
        .catch((err) => console.warn('matatu load failed', err))
      await loadPaybillAliases()
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
      await loadMaintenanceLogs()
      await loadSystemStaff()
      await loadTaxis()
      await loadBodaBikes()
      await loadLogins()
    }
    void bootstrap()
  }, [])

  const counts = overview?.counts || {}
  const pool = overview?.ussd_pool || {}

  const renderAnalyticsTab = () => {
    const totalShuttles = analyticsShuttles.length
    const selectedOperatorLabel = analyticsOperatorFilter
      ? operatorOptions.find((row) => row.id === analyticsOperatorFilter)?.label || analyticsOperatorFilter
      : 'All operators'
    const selectedTypeLabel = analyticsTypeFilter || 'All types'
    const topMakes = analyticsTopMakes.slice(0, 10)
    const topModels = analyticsTopModels.slice(0, 10)
    const makeModelRows = analyticsMakeModelStats.slice(0, 15)
    const topIssueRows = maintenanceIssuesThisMonth.slice(0, 10)
    const topPartRows = maintenancePartsSummary.slice(0, 10)
    const topCostAssets = maintenanceCostByAsset.slice(0, 10)
    const topCostOperators = maintenanceCostByOperator.slice(0, 10)
    const topDowntimeAssets = maintenanceDowntimeByAsset.slice(0, 10)
    const topStaffRows = maintenanceStaffPerformance.slice(0, 10)
    const repeatAssetRows = maintenanceRepeatAssets.slice(0, 10)
    return (
      <>
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Fleet analytics</h3>
            <span className="muted small">
              {totalShuttles} shuttle{totalShuttles === 1 ? '' : 's'}
            </span>
          </div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <label className="muted small">
              Operator
              <select
                value={analyticsOperatorFilter}
                onChange={(e) => setAnalyticsOperatorFilter(e.target.value)}
                style={{ padding: 10, minWidth: 200 }}
              >
                <option value="">All operators</option>
                {operatorOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="muted small">
              Vehicle type
              <select
                value={analyticsTypeFilter}
                onChange={(e) => setAnalyticsTypeFilter(e.target.value)}
                style={{ padding: 10, minWidth: 180 }}
              >
                <option value="">All types</option>
                {SHUTTLE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="muted small" style={{ display: 'flex', alignItems: 'center' }}>
              Showing: {selectedOperatorLabel} / {selectedTypeLabel}
            </div>
          </div>
        </section>

        <section className="card">
          <h3 style={{ margin: '0 0 8px' }}>Fleet summary</h3>
          <div className="grid metrics">
            <div className="metric">
              <div className="k">Total shuttles</div>
              <div className="v">{totalShuttles}</div>
            </div>
            <div className="metric">
              <div className="k">Total seats</div>
              <div className="v">{analyticsSummary.totalSeats.toLocaleString()}</div>
            </div>
            <div className="metric">
              <div className="k">Total load (kg)</div>
              <div className="v">{analyticsSummary.totalLoad.toLocaleString()}</div>
            </div>
            <div className="metric">
              <div className="k">Missing capacity</div>
              <div className="v">{analyticsSummary.missingCapacity}</div>
            </div>
            <div className="metric">
              <div className="k">High risk vehicles</div>
              <div className="v">{analyticsSummary.highRisk}</div>
            </div>
          </div>
        </section>

        <section className="grid g2">
          <div className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Vehicles by type</h3>
              <span className="muted small">{analyticsByType.length} type(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsByType.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="muted">
                        No vehicles to summarize.
                      </td>
                    </tr>
                  ) : (
                    analyticsByType.map((row) => (
                      <tr key={row.type}>
                        <td>{row.type}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Seats by operator</h3>
              <span className="muted small">{analyticsSeatsByOperator.length} operator(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Operator</th>
                    <th>Seats</th>
                    <th>Vehicles</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsSeatsByOperator.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No seat capacity data.
                      </td>
                    </tr>
                  ) : (
                    analyticsSeatsByOperator.map((row) => (
                      <tr key={row.id}>
                        <td>{row.label}</td>
                        <td>{row.seats.toLocaleString()}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="grid g2">
          <div className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Load capacity by operator</h3>
              <span className="muted small">{analyticsLoadByOperator.length} operator(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Operator</th>
                    <th>Load (kg)</th>
                    <th>Vehicles</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsLoadByOperator.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No load capacity data.
                      </td>
                    </tr>
                  ) : (
                    analyticsLoadByOperator.map((row) => (
                      <tr key={row.id}>
                        <td>{row.label}</td>
                        <td>{row.load.toLocaleString()}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Top makes</h3>
              <span className="muted small">Top {topMakes.length}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Make</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {topMakes.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="muted">
                        No make data.
                      </td>
                    </tr>
                  ) : (
                    topMakes.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="grid g2">
          <div className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Top models</h3>
              <span className="muted small">Top {topModels.length}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {topModels.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="muted">
                        No model data.
                      </td>
                    </tr>
                  ) : (
                    topModels.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Make & model risk</h3>
              <span className="muted small">Top {makeModelRows.length}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Make</th>
                    <th>Model</th>
                    <th>Avg risk</th>
                    <th>Common age</th>
                    <th>Vehicles</th>
                  </tr>
                </thead>
                <tbody>
                  {makeModelRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No make/model data.
                      </td>
                    </tr>
                  ) : (
                    makeModelRows.map((row) => (
                      <tr key={`${row.make}-${row.model}`}>
                        <td>{row.make}</td>
                        <td>{row.model}</td>
                        <td>{row.avgRisk.toFixed(1)}</td>
                        <td>{row.commonAge === 'Unknown' ? '-' : `${row.commonAge} yrs`}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Maintenance analytics</h3>
            <span className="muted small">
              {maintenanceLogs.length} log{maintenanceLogs.length === 1 ? '' : 's'}
            </span>
          </div>
          {maintenanceError ? <div className="err">Maintenance log error: {maintenanceError}</div> : null}
        </section>

        <section className="grid g2">
          <div className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Top issue categories (this month)</h3>
              <span className="muted small">Top {topIssueRows.length}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {topIssueRows.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="muted">
                        No maintenance activity yet.
                      </td>
                    </tr>
                  ) : (
                    topIssueRows.map((row) => (
                      <tr key={row.category}>
                        <td>{row.category}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Top parts by cost</h3>
              <span className="muted small">Top {topPartRows.length}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Count</th>
                    <th>Cost (KES)</th>
                  </tr>
                </thead>
                <tbody>
                  {topPartRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No parts logged yet.
                      </td>
                    </tr>
                  ) : (
                    topPartRows.map((row) => (
                      <tr key={row.part}>
                        <td>{row.part}</td>
                        <td>{row.count}</td>
                        <td>{row.cost.toLocaleString('en-KE')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="grid g2">
          <div className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Highest maintenance cost vehicles</h3>
              <span className="muted small">Top {topCostAssets.length}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Asset type</th>
                    <th>Operator</th>
                    <th>Logs</th>
                    <th>Cost (KES)</th>
                  </tr>
                </thead>
                <tbody>
                  {topCostAssets.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No maintenance cost data.
                      </td>
                    </tr>
                  ) : (
                    topCostAssets.map((row) => (
                      <tr key={row.assetKey}>
                        <td>{row.label}</td>
                        <td>{row.assetType}</td>
                        <td>{row.operatorLabel || '-'}</td>
                        <td>{row.count}</td>
                        <td>{row.cost.toLocaleString('en-KE')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Operators with highest maintenance costs</h3>
              <span className="muted small">Top {topCostOperators.length}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Operator</th>
                    <th>Logs</th>
                    <th>Cost (KES)</th>
                  </tr>
                </thead>
                <tbody>
                  {topCostOperators.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No operator cost data.
                      </td>
                    </tr>
                  ) : (
                    topCostOperators.map((row) => (
                      <tr key={row.operatorId}>
                        <td>{row.label}</td>
                        <td>{row.count}</td>
                        <td>{row.cost.toLocaleString('en-KE')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="grid g2">
          <div className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Highest downtime vehicles</h3>
              <span className="muted small">Top {topDowntimeAssets.length}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Asset type</th>
                    <th>Logs</th>
                    <th>Downtime (days)</th>
                  </tr>
                </thead>
                <tbody>
                  {topDowntimeAssets.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No downtime data.
                      </td>
                    </tr>
                  ) : (
                    topDowntimeAssets.map((row) => (
                      <tr key={row.assetKey}>
                        <td>{row.label}</td>
                        <td>{row.assetType}</td>
                        <td>{row.count}</td>
                        <td>{row.downtime}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Staff performance</h3>
              <span className="muted small">Top {topStaffRows.length}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Issues</th>
                    <th>Avg resolution (days)</th>
                  </tr>
                </thead>
                <tbody>
                  {topStaffRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No staff performance data.
                      </td>
                    </tr>
                  ) : (
                    topStaffRows.map((row) => (
                      <tr key={row.staffId}>
                        <td>{row.label}</td>
                        <td>{row.count}</td>
                        <td>{row.avgResolutionDays ? row.avgResolutionDays.toFixed(1) : '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Repeat issues (2+ logs)</h3>
            <span className="muted small">Top {repeatAssetRows.length}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Asset type</th>
                  <th>Logs</th>
                </tr>
              </thead>
              <tbody>
                {repeatAssetRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No repeat issues yet.
                    </td>
                  </tr>
                ) : (
                  repeatAssetRows.map((row) => (
                    <tr key={row.assetKey}>
                      <td>{row.label}</td>
                      <td>{row.assetType}</td>
                      <td>{row.count}</td>
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

  const renderShuttlesTab = () => {
    const selectedOperatorLabel = shuttleOperatorFilter
      ? shuttleOperatorSummary.find((row) => row.id === shuttleOperatorFilter)?.label ||
        operatorOptions.find((row) => row.id === shuttleOperatorFilter)?.label ||
        shuttleOperatorFilter
      : 'All operators'
    const normalizedType = normalizeShuttleType(shuttleForm.vehicle_type)
    const showSeatCapacity = shouldShowSeatCapacity(normalizedType) || normalizedType === 'OTHER'
    const showLoadCapacity = shouldShowLoadCapacity(normalizedType) || normalizedType === 'OTHER'
    const shuttlesTableColSpan = 16
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
                  Till number (optional)
                  <input
                    className="input"
                    value={shuttleForm.till_number}
                    onChange={(e) => setShuttleForm((f) => ({ ...f, till_number: e.target.value }))}
                    placeholder="Optional (TekeTeke provides)"
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
            <h3 style={{ margin: 0 }}>{shuttleOperatorFilter ? `Shuttles - ${selectedOperatorLabel}` : 'Shuttles'}</h3>
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
                  <th>Age</th>
                  <th>Risk</th>
                  <th>Type</th>
                  <th>Capacity</th>
                  <th>Compliance</th>
                  <th>Operator</th>
                  <th>TLB/License</th>
                  <th>Till</th>
                  <th>PayBill accounts</th>
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
                    const plateKey = normalizePlateInput(row.plate || '')
                    const matatuIdFromPlate = plateKey ? paybillMatatuIdByPlate.get(plateKey) : null
                    const paybillCodes = row.id ? paybillCodesByMatatuId.get(row.id) : null
                    const resolvedCodes =
                      paybillCodes || (matatuIdFromPlate ? paybillCodesByMatatuId.get(matatuIdFromPlate) : null)
                    const plateAlias = resolvedCodes?.plate || plateKey
                    const age = getVehicleAge(row.year)
                    const riskScore = getRiskScoreForAge(age)
                    const maintenanceCount = row.id ? maintenanceCountsByShuttle.get(row.id) || 0 : 0
                    const adjustedRisk = maintenanceCount >= 3 ? Math.min(100, riskScore + 15) : riskScore
                    const riskLabel = getRiskLabel(adjustedRisk)
                    const riskStyle = riskBadgeStyle(adjustedRisk)
                    const complianceItems = [
                      { label: 'TLB', value: row.tlb_expiry_date },
                      { label: 'Insurance', value: row.insurance_expiry_date },
                      { label: 'Inspection', value: row.inspection_expiry_date },
                    ]
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
                          <td>{age === null ? '-' : age}</td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span
                                style={{
                                  ...riskStyle,
                                  padding: '2px 8px',
                                  borderRadius: 999,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  width: 'fit-content',
                                }}
                              >
                                {riskLabel} {adjustedRisk}
                              </span>
                              {maintenanceCount >= 3 ? (
                                <span className="muted small">Adjusted +15</span>
                              ) : null}
                            </div>
                          </td>
                          <td>{rowTypeLabel}</td>
                          <td>{capacityLabel}</td>
                          <td>
                            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                              {complianceItems.map((item) => {
                                const info = getExpiryStatus(item.value)
                                const label = formatExpiryStatusLabel(info.status)
                                const style = expiryBadgeStyle(info.status)
                                const title = item.value
                                  ? `${item.label} expiry: ${formatExpiryDate(item.value)}`
                                  : `${item.label} expiry: Unknown`
                                return (
                                  <span
                                    key={item.label}
                                    title={title}
                                    style={{
                                      ...style,
                                      padding: '2px 6px',
                                      borderRadius: 999,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                    }}
                                  >
                                    {item.label}: {label}
                                  </span>
                                )
                              })}
                            </div>
                          </td>
                          <td>{operatorLabelFor(row)}</td>
                          <td>{row.tlb_license || '-'}</td>
                          <td>{row.till_number || '-'}</td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <PaybillCodeCard variant="inline" label="OWNER Account" code={resolvedCodes?.owner || ''} />
                            <PaybillCodeCard
                              variant="inline"
                              label="MATATU Account"
                              code={resolvedCodes?.vehicle || ''}
                            />
                            <PaybillCodeCard
                              variant="inline"
                              label="STK/USSD Reference (Plate)"
                              code={plateAlias || ''}
                            />
                          </div>
                        </td>
                          <td>
                            <div className="row" style={{ gap: 6 }}>
                              <button className="btn ghost" type="button" onClick={() => startShuttleEdit(row)}>
                                {isEditing ? 'Close' : 'Edit'}
                              </button>
                              <button
                                className="btn bad ghost"
                                type="button"
                                onClick={() => deleteShuttle(row)}
                                disabled={!row.id}
                              >
                                Delete
                              </button>
                            </div>
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
                                        Till number (optional)
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


  const renderTaxiTab = () => {
    const selectedOperatorLabel = taxiOperatorFilter
      ? taxiOperatorSummary.find((row) => row.id === taxiOperatorFilter)?.label ||
        operatorOptions.find((row) => row.id === taxiOperatorFilter)?.label ||
        taxiOperatorFilter
      : 'All operators'
    const taxiCategory = normalizeTaxiCategory(taxiForm.category)
    const taxiTableColSpan = 12
    return (
      <>
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Register Taxi</h3>
          <div className="grid g2">
            <div className="card" style={{ margin: 0, boxShadow: 'none' }}>
              <h4 style={{ margin: '0 0 8px' }}>Driver / Owner Information</h4>
              <div className="grid g2">
                <label className="muted small">
                  Full name *
                  <input
                    className="input"
                    value={taxiOwnerForm.full_name}
                    onChange={(e) => setTaxiOwnerForm((f) => ({ ...f, full_name: e.target.value }))}
                    placeholder="Driver/owner full name"
                  />
                </label>
                <label className="muted small">
                  ID number *
                  <input
                    className="input"
                    value={taxiOwnerForm.id_number}
                    onChange={(e) => setTaxiOwnerForm((f) => ({ ...f, id_number: e.target.value }))}
                  />
                </label>
                <label className="muted small">
                  Phone number *
                  <input
                    className="input"
                    value={taxiOwnerForm.phone}
                    onChange={(e) => setTaxiOwnerForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="07xx..."
                  />
                </label>
                <label className="muted small">
                  Email address
                  <input
                    className="input"
                    value={taxiOwnerForm.email}
                    onChange={(e) => setTaxiOwnerForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Physical address
                  <input
                    className="input"
                    value={taxiOwnerForm.address}
                    onChange={(e) => setTaxiOwnerForm((f) => ({ ...f, address: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Driving license no
                  <input
                    className="input"
                    value={taxiOwnerForm.license_no}
                    onChange={(e) => setTaxiOwnerForm((f) => ({ ...f, license_no: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Date of birth
                  <input
                    className="input"
                    type="date"
                    value={taxiOwnerForm.date_of_birth}
                    onChange={(e) => setTaxiOwnerForm((f) => ({ ...f, date_of_birth: e.target.value }))}
                  />
                </label>
              </div>
            </div>

            <div className="card" style={{ margin: 0, boxShadow: 'none' }}>
              <h4 style={{ margin: '0 0 8px' }}>Taxi Information</h4>
              <div className="grid g2">
                <label className="muted small">
                  Plate number / identifier *
                  <input
                    className="input"
                    value={taxiForm.plate}
                    onChange={(e) => setTaxiForm((f) => ({ ...f, plate: e.target.value }))}
                  />
                </label>
                <label className="muted small">
                  Make
                  <input
                    className="input"
                    value={taxiForm.make}
                    onChange={(e) => setTaxiForm((f) => ({ ...f, make: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Model
                  <input
                    className="input"
                    value={taxiForm.model}
                    onChange={(e) => setTaxiForm((f) => ({ ...f, model: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Year of manufacture
                  <input
                    className="input"
                    type="number"
                    value={taxiForm.year}
                    onChange={(e) => setTaxiForm((f) => ({ ...f, year: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Operator *
                  <select
                    value={taxiForm.operator_id}
                    onChange={(e) => setTaxiForm((f) => ({ ...f, operator_id: e.target.value }))}
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
                  Taxi category *
                  <select
                    value={taxiForm.category}
                    onChange={(e) => {
                      const nextCategory = e.target.value
                      const normalized = normalizeTaxiCategory(nextCategory)
                      setTaxiForm((f) => ({
                        ...f,
                        category: nextCategory,
                        category_other: normalized === 'OTHER' ? f.category_other : '',
                      }))
                    }}
                    style={{ padding: 10 }}
                  >
                    <option value="">Select category</option>
                    {TAXI_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {taxiCategory === 'OTHER' ? (
                  <label className="muted small">
                    Other category (optional)
                    <input
                      className="input"
                      value={taxiForm.category_other}
                      onChange={(e) => setTaxiForm((f) => ({ ...f, category_other: e.target.value }))}
                    />
                  </label>
                ) : null}
                <label className="muted small">
                  Seat capacity
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={taxiForm.seat_capacity}
                    onChange={(e) => setTaxiForm((f) => ({ ...f, seat_capacity: e.target.value }))}
                    placeholder="4 or 5"
                  />
                </label>
                <label className="muted small">
                  Till number
                  <input
                    className="input"
                    value={taxiForm.till_number}
                    onChange={(e) => setTaxiForm((f) => ({ ...f, till_number: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" type="button" onClick={submitTaxi}>
              Register Taxi
            </button>
            <span className="muted small">{taxiMsg}</span>
          </div>
        </section>

        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Taxis</h3>
            {taxiOperatorFilter ? (
              <button className="btn ghost" type="button" onClick={() => setTaxiOperatorFilter('')}>
                Clear filter
              </button>
            ) : null}
          </div>
          {taxisError ? <div className="err">Taxi load error: {taxisError}</div> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Operator</th>
                  <th>Number of taxis</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {taxiOperatorSummary.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No taxis registered yet.
                    </td>
                  </tr>
                ) : (
                  taxiOperatorSummary.map((row) => (
                    <tr key={row.id}>
                      <td>{row.label}</td>
                      <td>{row.count}</td>
                      <td>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => {
                            setTaxiOperatorFilter(row.id)
                            requestAnimationFrame(() => {
                              taxiTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                            })
                          }}
                          disabled={taxiOperatorFilter === row.id}
                        >
                          {taxiOperatorFilter === row.id ? 'Viewing' : 'View'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" ref={taxiTableRef}>
          <div className="topline">
            <h3 style={{ margin: 0 }}>{taxiOperatorFilter ? `Taxis - ${selectedOperatorLabel}` : 'Taxis'}</h3>
            <span className="muted small">
              Showing {filteredTaxis.length} record{filteredTaxis.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Driver/Owner</th>
                  <th>Phone</th>
                  <th>Category</th>
                  <th>Seats</th>
                  <th>Make</th>
                  <th>Model</th>
                  <th>Year</th>
                  <th>Operator</th>
                  <th>Till</th>
                  <th>PayBill account</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTaxis.length === 0 ? (
                  <tr>
                    <td colSpan={taxiTableColSpan} className="muted">
                      No taxis found.
                    </td>
                  </tr>
                ) : (
                  filteredTaxis.map((row) => {
                    const isEditing = taxiEditId && row.id === taxiEditId
                    const rowCategory = normalizeTaxiCategory(row.category)
                    const categoryLabel =
                      rowCategory === 'OTHER' ? `OTHER${row.category_other ? ` (${row.category_other})` : ''}` : rowCategory || '-'
                    // TODO: Use seat capacity for fleet analysis, revenue per seat, utilization, and operator comparisons.
                    const seatLabel = row.seat_capacity ? String(row.seat_capacity) : '-'
                    const taxiCode = row.id ? paybillCodesByTaxiId.get(row.id)?.code || '' : ''
                    return (
                      <Fragment key={row.id || row.plate}>
                        <tr>
                          <td>{row.plate || '-'}</td>
                          <td>{row.owner?.full_name || '-'}</td>
                          <td>{row.owner?.phone || '-'}</td>
                          <td>{categoryLabel}</td>
                          <td>{seatLabel}</td>
                          <td>{row.make || '-'}</td>
                          <td>{row.model || '-'}</td>
                          <td>{row.year || '-'}</td>
                          <td>{operatorLabelFromParts(row.operator_id || row.operator?.id || '', row.operator || null)}</td>
                          <td>{row.till_number || '-'}</td>
                          <td>
                            <PaybillCodeCard variant="inline" label="TAXI Account (Driver)" code={taxiCode} />
                          </td>
                          <td>
                            <div className="row" style={{ gap: 6 }}>
                              <button className="btn ghost" type="button" onClick={() => startTaxiEdit(row)}>
                                {isEditing ? 'Close' : 'Edit'}
                              </button>
                              <button
                                className="btn bad ghost"
                                type="button"
                                onClick={() => deleteTaxi(row)}
                                disabled={!row.id}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isEditing ? (
                          <tr>
                            <td colSpan={taxiTableColSpan}>
                              <div className="card" style={{ margin: '6px 0' }}>
                                <div className="topline">
                                  <h3 style={{ margin: 0 }}>Edit taxi</h3>
                                  <span className="muted small">{row.plate || row.id}</span>
                                </div>
                                {taxiEditError ? <div className="err">Update error: {taxiEditError}</div> : null}
                                <div className="grid g2">
                                  <div>
                                    <h4 style={{ margin: '6px 0' }}>Driver / Owner Information</h4>
                                    <div className="grid g2">
                                      <label className="muted small">
                                        Full name *
                                        <input
                                          className="input"
                                          value={taxiEditOwnerForm.full_name}
                                          onChange={(e) =>
                                            setTaxiEditOwnerForm((f) => ({ ...f, full_name: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        ID number *
                                        <input
                                          className="input"
                                          value={taxiEditOwnerForm.id_number}
                                          onChange={(e) =>
                                            setTaxiEditOwnerForm((f) => ({ ...f, id_number: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Phone number *
                                        <input
                                          className="input"
                                          value={taxiEditOwnerForm.phone}
                                          onChange={(e) =>
                                            setTaxiEditOwnerForm((f) => ({ ...f, phone: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Email address
                                        <input
                                          className="input"
                                          value={taxiEditOwnerForm.email}
                                          onChange={(e) =>
                                            setTaxiEditOwnerForm((f) => ({ ...f, email: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Physical address
                                        <input
                                          className="input"
                                          value={taxiEditOwnerForm.address}
                                          onChange={(e) =>
                                            setTaxiEditOwnerForm((f) => ({ ...f, address: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Driving license no
                                        <input
                                          className="input"
                                          value={taxiEditOwnerForm.license_no}
                                          onChange={(e) =>
                                            setTaxiEditOwnerForm((f) => ({ ...f, license_no: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Date of birth
                                        <input
                                          className="input"
                                          type="date"
                                          value={taxiEditOwnerForm.date_of_birth}
                                          onChange={(e) =>
                                            setTaxiEditOwnerForm((f) => ({ ...f, date_of_birth: e.target.value }))
                                          }
                                        />
                                      </label>
                                    </div>
                                  </div>

                                  <div>
                                    <h4 style={{ margin: '6px 0' }}>Taxi Information</h4>
                                    <div className="grid g2">
                                      <label className="muted small">
                                        Plate *
                                        <input
                                          className="input"
                                          value={taxiEditForm.plate}
                                          onChange={(e) => setTaxiEditForm((f) => ({ ...f, plate: e.target.value }))}
                                        />
                                      </label>
                                      <label className="muted small">
                                        Make
                                        <input
                                          className="input"
                                          value={taxiEditForm.make}
                                          onChange={(e) => setTaxiEditForm((f) => ({ ...f, make: e.target.value }))}
                                        />
                                      </label>
                                      <label className="muted small">
                                        Model
                                        <input
                                          className="input"
                                          value={taxiEditForm.model}
                                          onChange={(e) => setTaxiEditForm((f) => ({ ...f, model: e.target.value }))}
                                        />
                                      </label>
                                      <label className="muted small">
                                        Year
                                        <input
                                          className="input"
                                          type="number"
                                          value={taxiEditForm.year}
                                          onChange={(e) => setTaxiEditForm((f) => ({ ...f, year: e.target.value }))}
                                        />
                                      </label>
                                      <label className="muted small">
                                        Operator *
                                        <select
                                          value={taxiEditForm.operator_id}
                                          onChange={(e) =>
                                            setTaxiEditForm((f) => ({ ...f, operator_id: e.target.value }))
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
                                        Taxi category *
                                        <select
                                          value={taxiEditForm.category}
                                          onChange={(e) => {
                                            const nextCategory = e.target.value
                                            const normalized = normalizeTaxiCategory(nextCategory)
                                            setTaxiEditForm((f) => ({
                                              ...f,
                                              category: nextCategory,
                                              category_other: normalized === 'OTHER' ? f.category_other : '',
                                            }))
                                          }}
                                          style={{ padding: 10 }}
                                        >
                                          <option value="">Select category</option>
                                          {TAXI_CATEGORY_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                              {option.label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                      {normalizeTaxiCategory(taxiEditForm.category) === 'OTHER' ? (
                                        <label className="muted small">
                                          Other category (optional)
                                          <input
                                            className="input"
                                            value={taxiEditForm.category_other}
                                            onChange={(e) =>
                                              setTaxiEditForm((f) => ({ ...f, category_other: e.target.value }))
                                            }
                                          />
                                        </label>
                                      ) : null}
                                      <label className="muted small">
                                        Seat capacity
                                        <input
                                          className="input"
                                          type="number"
                                          min={1}
                                          value={taxiEditForm.seat_capacity}
                                          onChange={(e) =>
                                            setTaxiEditForm((f) => ({ ...f, seat_capacity: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Till number
                                        <input
                                          className="input"
                                          value={taxiEditForm.till_number}
                                          onChange={(e) => setTaxiEditForm((f) => ({ ...f, till_number: e.target.value }))}
                                        />
                                      </label>
                                    </div>
                                  </div>
                                </div>
                                <div className="row" style={{ marginTop: 8 }}>
                                  <button className="btn" type="button" onClick={saveTaxiEdit}>
                                    Save changes
                                  </button>
                                  <button className="btn ghost" type="button" onClick={resetTaxiEditState}>
                                    Close
                                  </button>
                                  <span className="muted small">{taxiEditMsg}</span>
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


  const renderBodaTab = () => {
    const selectedOperatorLabel = bodaOperatorFilter
      ? bodaOperatorSummary.find((row) => row.id === bodaOperatorFilter)?.label ||
        operatorOptions.find((row) => row.id === bodaOperatorFilter)?.label ||
        bodaOperatorFilter
      : 'All operators'
    const bodaTableColSpan = 13
    return (
      <>
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Register Boda</h3>
          <div className="grid g2">
            <div className="card" style={{ margin: 0, boxShadow: 'none' }}>
              <h4 style={{ margin: '0 0 8px' }}>Rider Information</h4>
              <div className="grid g2">
                <label className="muted small">
                  Full name *
                  <input
                    className="input"
                    value={bodaRiderForm.full_name}
                    onChange={(e) => setBodaRiderForm((f) => ({ ...f, full_name: e.target.value }))}
                  />
                </label>
                <label className="muted small">
                  ID number *
                  <input
                    className="input"
                    value={bodaRiderForm.id_number}
                    onChange={(e) => setBodaRiderForm((f) => ({ ...f, id_number: e.target.value }))}
                  />
                </label>
                <label className="muted small">
                  Phone number *
                  <input
                    className="input"
                    value={bodaRiderForm.phone}
                    onChange={(e) => setBodaRiderForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="07xx..."
                  />
                </label>
                <label className="muted small">
                  Email address
                  <input
                    className="input"
                    value={bodaRiderForm.email}
                    onChange={(e) => setBodaRiderForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </label>
                <label className="muted small">
                  Physical address
                  <input
                    className="input"
                    value={bodaRiderForm.address}
                    onChange={(e) => setBodaRiderForm((f) => ({ ...f, address: e.target.value }))}
                  />
                </label>
                <label className="muted small">
                  Stage/Base
                  <input
                    className="input"
                    value={bodaRiderForm.stage}
                    onChange={(e) => setBodaRiderForm((f) => ({ ...f, stage: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  County/Town
                  <input
                    className="input"
                    value={bodaRiderForm.town}
                    onChange={(e) => setBodaRiderForm((f) => ({ ...f, town: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Date of birth
                  <input
                    className="input"
                    type="date"
                    value={bodaRiderForm.date_of_birth}
                    onChange={(e) => setBodaRiderForm((f) => ({ ...f, date_of_birth: e.target.value }))}
                  />
                </label>
              </div>
            </div>

            <div className="card" style={{ margin: 0, boxShadow: 'none' }}>
              <h4 style={{ margin: '0 0 8px' }}>Bike Information</h4>
              <div className="grid g2">
                <label className="muted small">
                  Identifier *
                  <input
                    className="input"
                    value={bodaBikeForm.identifier}
                    onChange={(e) => setBodaBikeForm((f) => ({ ...f, identifier: e.target.value }))}
                    placeholder="Plate / sticker / bike number"
                  />
                </label>
                <label className="muted small">
                  Bike make
                  <input
                    className="input"
                    value={bodaBikeForm.make}
                    onChange={(e) => setBodaBikeForm((f) => ({ ...f, make: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Bike model
                  <input
                    className="input"
                    value={bodaBikeForm.model}
                    onChange={(e) => setBodaBikeForm((f) => ({ ...f, model: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Year of manufacture
                  <input
                    className="input"
                    type="number"
                    value={bodaBikeForm.year}
                    onChange={(e) => setBodaBikeForm((f) => ({ ...f, year: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Operator *
                  <select
                    value={bodaBikeForm.operator_id}
                    onChange={(e) => setBodaBikeForm((f) => ({ ...f, operator_id: e.target.value }))}
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
                  Till number
                  <input
                    className="input"
                    value={bodaBikeForm.till_number}
                    onChange={(e) => setBodaBikeForm((f) => ({ ...f, till_number: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label className="muted small">
                  Rider license number
                  <input
                    className="input"
                    value={bodaBikeForm.license_no}
                    onChange={(e) => setBodaBikeForm((f) => ({ ...f, license_no: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <div className="row" style={{ alignItems: 'center', marginTop: 4 }}>
                  <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={bodaBikeForm.has_helmet}
                      onChange={(e) => setBodaBikeForm((f) => ({ ...f, has_helmet: e.target.checked }))}
                    />
                    Has helmet
                  </label>
                  <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={bodaBikeForm.has_reflector}
                      onChange={(e) => setBodaBikeForm((f) => ({ ...f, has_reflector: e.target.checked }))}
                    />
                    Has reflector
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" type="button" onClick={submitBoda}>
              Register Boda
            </button>
            <span className="muted small">{bodaMsg}</span>
          </div>
        </section>

        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Boda Bodas</h3>
            {bodaOperatorFilter ? (
              <button className="btn ghost" type="button" onClick={() => setBodaOperatorFilter('')}>
                Clear filter
              </button>
            ) : null}
          </div>
          {bodaError ? <div className="err">Boda load error: {bodaError}</div> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Operator</th>
                  <th>Number of bikes</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {bodaOperatorSummary.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No boda records yet.
                    </td>
                  </tr>
                ) : (
                  bodaOperatorSummary.map((row) => (
                    <tr key={row.id}>
                      <td>{row.label}</td>
                      <td>{row.count}</td>
                      <td>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => {
                            setBodaOperatorFilter(row.id)
                            requestAnimationFrame(() => {
                              bodaTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                            })
                          }}
                          disabled={bodaOperatorFilter === row.id}
                        >
                          {bodaOperatorFilter === row.id ? 'Viewing' : 'View'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" ref={bodaTableRef}>
          <div className="topline">
            <h3 style={{ margin: 0 }}>{bodaOperatorFilter ? `Boda Bodas - ${selectedOperatorLabel}` : 'Boda Bodas'}</h3>
            <span className="muted small">
              Showing {filteredBodaBikes.length} record{filteredBodaBikes.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Identifier</th>
                  <th>Rider name</th>
                  <th>Phone</th>
                  <th>Stage</th>
                  <th>Make</th>
                  <th>Model</th>
                  <th>Year</th>
                  <th>Operator</th>
                  <th>Till</th>
                  <th>License</th>
                  <th>Compliance</th>
                  <th>PayBill account</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredBodaBikes.length === 0 ? (
                  <tr>
                    <td colSpan={bodaTableColSpan} className="muted">
                      No boda bikes found.
                    </td>
                  </tr>
                ) : (
                  filteredBodaBikes.map((row) => {
                    const isEditing = bodaEditId && row.id === bodaEditId
                    const compliance = [row.has_helmet ? 'Helmet' : '', row.has_reflector ? 'Reflector' : '']
                      .filter(Boolean)
                      .join(', ')
                    const bodaCode = row.id ? paybillCodesByBodaId.get(row.id)?.code || '' : ''
                    return (
                      <Fragment key={row.id || row.identifier}>
                        <tr>
                          <td>{row.identifier || '-'}</td>
                          <td>{row.rider?.full_name || '-'}</td>
                          <td>{row.rider?.phone || '-'}</td>
                          <td>{row.rider?.stage || '-'}</td>
                          <td>{row.make || '-'}</td>
                          <td>{row.model || '-'}</td>
                          <td>{row.year || '-'}</td>
                          <td>{operatorLabelFromParts(row.operator_id || row.operator?.id || '', row.operator || null)}</td>
                          <td>{row.till_number || '-'}</td>
                          <td>{row.license_no || '-'}</td>
                          <td>{compliance || '-'}</td>
                          <td>
                            <PaybillCodeCard variant="inline" label="BODA Account (Rider)" code={bodaCode} />
                          </td>
                          <td>
                            <div className="row" style={{ gap: 6 }}>
                              <button className="btn ghost" type="button" onClick={() => startBodaEdit(row)}>
                                {isEditing ? 'Close' : 'Edit'}
                              </button>
                              <button
                                className="btn bad ghost"
                                type="button"
                                onClick={() => deleteBoda(row)}
                                disabled={!row.id}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isEditing ? (
                          <tr>
                            <td colSpan={bodaTableColSpan}>
                              <div className="card" style={{ margin: '6px 0' }}>
                                <div className="topline">
                                  <h3 style={{ margin: 0 }}>Edit boda</h3>
                                  <span className="muted small">{row.identifier || row.id}</span>
                                </div>
                                {bodaEditError ? <div className="err">Update error: {bodaEditError}</div> : null}
                                <div className="grid g2">
                                  <div>
                                    <h4 style={{ margin: '6px 0' }}>Rider Information</h4>
                                    <div className="grid g2">
                                      <label className="muted small">
                                        Full name *
                                        <input
                                          className="input"
                                          value={bodaEditRiderForm.full_name}
                                          onChange={(e) =>
                                            setBodaEditRiderForm((f) => ({ ...f, full_name: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        ID number *
                                        <input
                                          className="input"
                                          value={bodaEditRiderForm.id_number}
                                          onChange={(e) =>
                                            setBodaEditRiderForm((f) => ({ ...f, id_number: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Phone number *
                                        <input
                                          className="input"
                                          value={bodaEditRiderForm.phone}
                                          onChange={(e) =>
                                            setBodaEditRiderForm((f) => ({ ...f, phone: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Email address
                                        <input
                                          className="input"
                                          value={bodaEditRiderForm.email}
                                          onChange={(e) =>
                                            setBodaEditRiderForm((f) => ({ ...f, email: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Physical address
                                        <input
                                          className="input"
                                          value={bodaEditRiderForm.address}
                                          onChange={(e) =>
                                            setBodaEditRiderForm((f) => ({ ...f, address: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Stage/Base
                                        <input
                                          className="input"
                                          value={bodaEditRiderForm.stage}
                                          onChange={(e) =>
                                            setBodaEditRiderForm((f) => ({ ...f, stage: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        County/Town
                                        <input
                                          className="input"
                                          value={bodaEditRiderForm.town}
                                          onChange={(e) =>
                                            setBodaEditRiderForm((f) => ({ ...f, town: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Date of birth
                                        <input
                                          className="input"
                                          type="date"
                                          value={bodaEditRiderForm.date_of_birth}
                                          onChange={(e) =>
                                            setBodaEditRiderForm((f) => ({ ...f, date_of_birth: e.target.value }))
                                          }
                                        />
                                      </label>
                                    </div>
                                  </div>

                                  <div>
                                    <h4 style={{ margin: '6px 0' }}>Bike Information</h4>
                                    <div className="grid g2">
                                      <label className="muted small">
                                        Identifier *
                                        <input
                                          className="input"
                                          value={bodaEditForm.identifier}
                                          onChange={(e) =>
                                            setBodaEditForm((f) => ({ ...f, identifier: e.target.value }))
                                          }
                                        />
                                      </label>
                                      <label className="muted small">
                                        Bike make
                                        <input
                                          className="input"
                                          value={bodaEditForm.make}
                                          onChange={(e) => setBodaEditForm((f) => ({ ...f, make: e.target.value }))}
                                        />
                                      </label>
                                      <label className="muted small">
                                        Bike model
                                        <input
                                          className="input"
                                          value={bodaEditForm.model}
                                          onChange={(e) => setBodaEditForm((f) => ({ ...f, model: e.target.value }))}
                                        />
                                      </label>
                                      <label className="muted small">
                                        Year
                                        <input
                                          className="input"
                                          type="number"
                                          value={bodaEditForm.year}
                                          onChange={(e) => setBodaEditForm((f) => ({ ...f, year: e.target.value }))}
                                        />
                                      </label>
                                      <label className="muted small">
                                        Operator *
                                        <select
                                          value={bodaEditForm.operator_id}
                                          onChange={(e) =>
                                            setBodaEditForm((f) => ({ ...f, operator_id: e.target.value }))
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
                                        Till number
                                        <input
                                          className="input"
                                          value={bodaEditForm.till_number}
                                          onChange={(e) => setBodaEditForm((f) => ({ ...f, till_number: e.target.value }))}
                                        />
                                      </label>
                                      <label className="muted small">
                                        Rider license number
                                        <input
                                          className="input"
                                          value={bodaEditForm.license_no}
                                          onChange={(e) => setBodaEditForm((f) => ({ ...f, license_no: e.target.value }))}
                                        />
                                      </label>
                                      <div className="row" style={{ alignItems: 'center', marginTop: 4 }}>
                                        <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <input
                                            type="checkbox"
                                            checked={bodaEditForm.has_helmet}
                                            onChange={(e) =>
                                              setBodaEditForm((f) => ({ ...f, has_helmet: e.target.checked }))
                                            }
                                          />
                                          Has helmet
                                        </label>
                                        <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <input
                                            type="checkbox"
                                            checked={bodaEditForm.has_reflector}
                                            onChange={(e) =>
                                              setBodaEditForm((f) => ({ ...f, has_reflector: e.target.checked }))
                                            }
                                          />
                                          Has reflector
                                        </label>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="row" style={{ marginTop: 8 }}>
                                  <button className="btn" type="button" onClick={saveBodaEdit}>
                                    Save changes
                                  </button>
                                  <button className="btn ghost" type="button" onClick={resetBodaEditState}>
                                    Close
                                  </button>
                                  <span className="muted small">{bodaEditMsg}</span>
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
        <>
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

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Compliance alerts</h3>
              <span className="muted small">
                {complianceAlerts.length} alert{complianceAlerts.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="muted small" style={{ marginTop: 6 }}>
              Expired or due soon in the next 30 days (TLB, insurance, inspection).
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Plate</th>
                    <th>Operator</th>
                    <th>Expiry type</th>
                    <th>Expiry date</th>
                    <th>Days remaining</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {complianceAlerts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        No compliance alerts.
                      </td>
                    </tr>
                  ) : (
                    complianceAlerts.map((alert) => {
                      const style = expiryBadgeStyle(alert.status)
                      const statusLabel = formatExpiryStatusLabel(alert.status)
                      const daysLabel =
                        alert.status === 'expired'
                          ? `${Math.abs(alert.daysRemaining)} overdue`
                          : `${alert.daysRemaining}`
                      return (
                        <tr key={alert.id}>
                          <td>{alert.plate}</td>
                          <td>{alert.operatorLabel}</td>
                          <td>{alert.expiryType}</td>
                          <td>{formatExpiryDate(alert.expiryDate)}</td>
                          <td>{daysLabel}</td>
                          <td>
                            <span
                              style={{
                                ...style,
                                padding: '2px 8px',
                                borderRadius: 999,
                                fontSize: 12,
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                              }}
                            >
                              {statusLabel}
                            </span>
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

      {activeTab === 'analytics' ? renderAnalyticsTab() : null}
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
                Settlement till / paybill (optional)
                <input
                  className="input"
                  value={saccoForm.default_till}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, default_till: e.target.value }))}
                  placeholder="Optional (TekeTeke provides)"
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
                Dashboard manager name
                <input
                  className="input"
                  value={saccoForm.admin_name}
                  onChange={(e) => setSaccoForm((f) => ({ ...f, admin_name: e.target.value }))}
                  placeholder="Manager full name"
                />
              </label>
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
                  const defaultTill = saccoForm.default_till.trim()
                  const settlementMethod = saccoForm.settlement_method
                  const settlementBankName = saccoForm.settlement_bank_name.trim()
                  const settlementBankAccountNumber = saccoForm.settlement_bank_account_number.trim()
                  const adminName = saccoForm.admin_name.trim()
                  const adminEmail = saccoForm.admin_email.trim()
                  const adminPhone = normalizePhoneInput(saccoForm.admin_phone)
                  const feeLabel = saccoForm.fee_label.trim() || buildOperatorDefaults(operatorType).fee_label
                  const status = saccoForm.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE'

                  const errors: string[] = []
                  if (!displayName) errors.push('Operator display name is required')
                  if (!operatorTypeRaw) errors.push('Operator type is required')
                  if (!adminName) errors.push('Dashboard manager name is required')
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
                      default_till: defaultTill || null,
                      fee_label: feeLabel,
                      savings_enabled: saccoForm.savings_enabled,
                      loans_enabled: saccoForm.loans_enabled,
                      routes_enabled: saccoForm.routes_enabled,
                      settlement_bank_name: settlementBankName || null,
                      settlement_bank_account_number: settlementBankAccountNumber || null,
                      admin_name: adminName,
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
                    await loadPaybillAliases()
                    if (createdUser?.temp_password) {
                      const loginEmail = createdUser.email || adminEmail
                      try {
                        window.sessionStorage.setItem(
                          'tt_login_prefill',
                          JSON.stringify({ email: loginEmail, password: createdUser.temp_password }),
                        )
                      } catch {
                        // ignore storage failures (private mode, permissions)
                      }
                      window.alert(
                        `Operator created.\nAdmin login: ${loginEmail}\nTemp password: ${createdUser.temp_password}\nLogin page will be prefilled in this tab.`,
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
                    <th>PayBill codes</th>
                    <th>ID</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {saccos.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="muted">
                        No operators yet.
                      </td>
                    </tr>
                  ) : (
                    saccos.map((sacco) => {
                      const saccoId = sacco.id || sacco.sacco_id || ''
                      const isEditing = !!saccoId && saccoEditId === saccoId
                      const codes = saccoId ? paybillCodesBySaccoId.get(saccoId) : null
                      return (
                        <Fragment key={sacco.id || sacco.sacco_id || sacco.email}>
                          <tr>
                            <td>{sacco.display_name || sacco.name || sacco.sacco_name || '-'}</td>
                            <td>{formatOperatorTypeLabel(sacco.operator_type || sacco.org_type || null)}</td>
                            <td>{sacco.phone || sacco.contact_phone || '-'}</td>
                            <td>{sacco.email || sacco.contact_email || '-'}</td>
                            <td>{sacco.default_till || '-'}</td>
                            <td>{sacco.status || 'ACTIVE'}</td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <PaybillCodeCard
                                  variant="inline"
                                  label="SACCO FEE Account"
                                  code={codes?.fee || ''}
                                />
                                <PaybillCodeCard
                                  variant="inline"
                                  label="SACCO LOAN Account"
                                  code={codes?.loan || ''}
                                />
                                <PaybillCodeCard
                                  variant="inline"
                                  label="SACCO SAVINGS Account"
                                  code={codes?.savings || ''}
                                />
                              </div>
                            </td>
                            <td>{saccoId || '-'}</td>
                            <td>
                              <div className="row" style={{ gap: 6 }}>
                                <button className="btn ghost" type="button" onClick={() => startSaccoEdit(sacco)}>
                                  {isEditing ? 'Close' : 'Edit'}
                                </button>
                                <button
                                  className="btn bad ghost"
                                  type="button"
                                  onClick={() => deleteSacco(sacco)}
                                  disabled={!saccoId}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isEditing ? (
                            <tr>
                              <td colSpan={9}>
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
                                      Settlement till / paybill (optional)
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
      {activeTab === 'taxis' ? renderTaxiTab() : null}
      {activeTab === 'bodabodas' ? renderBodaTab() : null}

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
                <option value="RECEIVED">Received</option>
                <option value="CREDITED">Credited</option>
                <option value="REJECTED">Rejected</option>
                <option value="QUARANTINED">Quarantined</option>
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
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {c2bRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted">
                    No C2B payments found.
                  </td>
                </tr>
              ) : (
                c2bRows.map((row) => {
                  const id = row.id || ''
                  const action = id ? c2bActions[id] : null
                  const rawState = id ? c2bRawState[id] : null
                  const processed = row.status === 'CREDITED'
                  const open = !!rawState?.open
                  return (
                    <Fragment key={id || row.receipt || row.created_at}>
                      <tr>
                        <td className="mono">
                          {row.created_at ? new Date(row.created_at).toLocaleString() : '-'}
                        </td>
                        <td className="mono">{row.receipt || row.id || '-'}</td>
                        <td>{row.msisdn || '-'}</td>
                        <td>{formatKes(row.amount)}</td>
                        <td>{row.paybill_number || '-'}</td>
                        <td className="mono">{row.account_reference || '-'}</td>
                        <td>{row.status || '-'}</td>
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
                          <td colSpan={8}>
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

      {activeTab === 'payout_approvals' ? (
        <>
          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Payout Approvals</h3>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="muted small">
                  Status
                  <select
                    value={payoutApprovalStatus}
                    onChange={(e) => loadPayoutApprovals(e.target.value)}
                    style={{ padding: 10, marginLeft: 8 }}
                  >
                    <option value="SUBMITTED">SUBMITTED</option>
                    <option value="APPROVED">APPROVED</option>
                    <option value="PROCESSING">PROCESSING</option>
                    <option value="COMPLETED">COMPLETED</option>
                    <option value="FAILED">FAILED</option>
                    <option value="CANCELLED">CANCELLED</option>
                  </select>
                </label>
                <button className="btn ghost" type="button" onClick={() => loadPayoutApprovals()}>
                  Reload
                </button>
                <span className="muted small">{payoutApprovalMsg}</span>
                {payoutApprovalError ? <span className="err">{payoutApprovalError}</span> : null}
              </div>
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              Only MSISDN payouts are automated in v1. PayBill/Till destinations require manual transfer.
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date range</th>
                    <th>SACCO</th>
                    <th>Status</th>
                    <th>Readiness</th>
                    <th>Total</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutApprovalRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted">
                        No payout batches.
                      </td>
                    </tr>
                  ) : (
                    payoutApprovalRows.map((row) => (
                      <tr
                        key={row.id}
                        style={row.id && row.id === payoutApprovalSelected ? { background: '#f1f5f9' } : undefined}
                      >
                        <td>
                          <div>
                            {row.date_from} to {row.date_to}
                            {row.meta?.auto_draft ? (
                              <span className="badge-ghost" style={{ marginLeft: 6 }}>
                                AUTO-DRAFT
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>{row.sacco_name || row.sacco_id || '-'}</td>
                        <td>{row.status}</td>
                        <td>
                          {(() => {
                            const chip = buildReadinessChip(row.id ? payoutReadinessMap[row.id] : null)
                            return (
                              <span
                                className="badge-ghost"
                                style={
                                  chip.tone === 'bad'
                                    ? { borderColor: '#ef4444', color: '#b91c1c' }
                                    : chip.tone === 'good'
                                      ? { borderColor: '#22c55e', color: '#15803d' }
                                      : undefined
                                }
                              >
                                {chip.label}
                              </span>
                            )
                          })()}
                        </td>
                        <td>{formatKes(row.total_amount)}</td>
                        <td>{row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</td>
                        <td className="row" style={{ gap: 6 }}>
                          <button
                            className="btn ghost"
                            type="button"
                            onClick={() => loadPayoutApprovalDetail(row.id || '')}
                          >
                            View
                          </button>
                          {row.status === 'SUBMITTED' ? (
                            <button
                              type="button"
                              onClick={() => approvePayoutBatch(row.id || '')}
                              disabled={!!row.id && payoutReadinessMap[row.id]?.checks?.can_approve?.pass === false}
                              title={
                                row.id && payoutReadinessMap[row.id]?.checks?.can_approve?.pass === false
                                  ? payoutReadinessMap[row.id]?.checks?.can_approve?.reason || 'Cannot approve'
                                  : ''
                              }
                            >
                              Approve
                            </button>
                          ) : null}
                          {row.status === 'APPROVED' || row.status === 'PROCESSING' ? (
                            <button
                              type="button"
                              onClick={() => processPayoutBatch(row.id || '')}
                              disabled={!!row.id && payoutReadinessMap[row.id]?.checks?.can_process?.pass === false}
                              title={
                                row.id && payoutReadinessMap[row.id]?.checks?.can_process?.pass === false
                                  ? payoutReadinessMap[row.id]?.checks?.can_process?.reason || 'Cannot process'
                                  : ''
                              }
                            >
                              Process
                            </button>
                          ) : null}
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
              <h3 style={{ margin: 0 }}>Batch detail</h3>
              <span className="muted small">
                {payoutApprovalDetail ? payoutApprovalDetail.status : 'Select a batch'}
              </span>
            </div>
            {payoutApprovalDetail ? (
              <>
                <div className="row" style={{ gap: 12, marginTop: 8 }}>
                  <div className="badge-ghost">
                    {payoutApprovalDetail.date_from} to {payoutApprovalDetail.date_to}
                  </div>
                  <div className="badge-ghost">Total: {formatKes(payoutApprovalDetail.total_amount)}</div>
                </div>
                {payoutApprovalReadiness ? (
                  <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
                    <div className="topline">
                      <h4 style={{ margin: 0 }}>Readiness</h4>
                      <div className="row" style={{ gap: 8 }}>
                        {findIssue(payoutApprovalReadiness, 'DESTINATION_NOT_VERIFIED') ? (
                          <button type="button" className="btn ghost" onClick={() => setActiveTab('saccos')}>
                            Go to Destinations Verification
                          </button>
                        ) : null}
                        {findIssue(payoutApprovalReadiness, 'QUARANTINES_PRESENT') ? (
                          <button type="button" className="btn ghost" onClick={() => setActiveTab('quarantine')}>
                            Go to Quarantine
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid g2" style={{ gap: 12 }}>
                      <div>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="badge-ghost">
                            {payoutApprovalReadiness.checks?.can_approve?.pass ? 'OK' : 'BLOCK'}
                          </span>
                          <strong>Approve</strong>
                        </div>
                        <div className="muted small">
                          {payoutApprovalReadiness.checks?.can_approve?.reason || 'Checking approve readiness...'}
                        </div>
                      </div>
                      <div>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="badge-ghost">
                            {payoutApprovalReadiness.checks?.can_process?.pass ? 'OK' : 'BLOCK'}
                          </span>
                          <strong>Process</strong>
                        </div>
                        <div className="muted small">
                          {payoutApprovalReadiness.checks?.can_process?.reason || 'Checking process readiness...'}
                        </div>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                      <div className="badge-ghost">
                        Pending: {payoutApprovalReadiness.items_summary?.pending_count || 0}
                      </div>
                      <div className="badge-ghost">
                        Blocked: {payoutApprovalReadiness.items_summary?.blocked_count || 0}
                      </div>
                      <div className="badge-ghost">
                        Sent: {payoutApprovalReadiness.items_summary?.sent_count || 0}
                      </div>
                      <div className="badge-ghost">
                        Confirmed: {payoutApprovalReadiness.items_summary?.confirmed_count || 0}
                      </div>
                      <div className="badge-ghost">
                        Failed: {payoutApprovalReadiness.items_summary?.failed_count || 0}
                      </div>
                    </div>
                    {payoutApprovalReadiness.items_summary?.blocked_reasons?.length ? (
                      <div className="muted small" style={{ marginTop: 8 }}>
                        Blocked reasons:{' '}
                        {payoutApprovalReadiness.items_summary.blocked_reasons
                          .map((r) => `${r.reason} (${r.count})`)
                          .join(', ')}
                      </div>
                    ) : null}
                    {payoutApprovalReadiness.issues?.length ? (
                      <div className="muted small" style={{ marginTop: 8 }}>
                        Issues:
                        <ul style={{ marginTop: 6 }}>
                          {payoutApprovalReadiness.issues.map((issue) => (
                            <li key={`${issue.code}-${issue.message}`}>
                              {issue.code}: {issue.message}
                              {issue.hint ? ` (${issue.hint})` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid g2" style={{ gap: 12, marginTop: 12 }}>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Wallet kind</th>
                          <th>Amount</th>
                          <th>Destination</th>
                          <th>Status</th>
                          <th>Block reason</th>
                          <th>Receipt</th>
                          <th>Ledger</th>
                          <th>Failure</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payoutApprovalItems.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="muted">
                              No items.
                            </td>
                          </tr>
                        ) : (
                          payoutApprovalItems.map((item) => (
                            <tr key={item.id}>
                              <td>{formatPayoutKind(item.wallet_kind)}</td>
                              <td>{formatKes(item.amount)}</td>
                              <td>
                                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                                  <span>{item.destination_type}</span>
                                  <span className="mono">{item.destination_ref || '-'}</span>
                                  {item.destination_ref ? (
                                    <button
                                      type="button"
                                      className="btn ghost"
                                      onClick={() => copyPayoutValue(item.destination_ref || '', 'Copied destination')}
                                    >
                                      Copy
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                              <td>{item.status}</td>
                              <td>{item.block_reason || '-'}</td>
                              <td className="mono">
                                <span>{item.provider_receipt || '-'}</span>
                                {item.provider_receipt ? (
                                  <button
                                    type="button"
                                    className="btn ghost"
                                    style={{ marginLeft: 6 }}
                                    onClick={() => copyPayoutValue(item.provider_receipt || '', 'Copied receipt')}
                                  >
                                    Copy
                                  </button>
                                ) : null}
                              </td>
                              <td className="mono">
                                {item.ledger_entry_id ? (
                                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                                    <span>{item.ledger_entry_id}</span>
                                    <button
                                      type="button"
                                      className="btn ghost"
                                      onClick={() => copyPayoutValue(item.ledger_entry_id || '', 'Copied ledger id')}
                                    >
                                      Copy
                                    </button>
                                  </div>
                                ) : (
                                  <span className="muted">-</span>
                                )}
                              </td>
                              <td>{item.failure_reason || '-'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Event</th>
                          <th>Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payoutApprovalEvents.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="muted">
                              No events.
                            </td>
                          </tr>
                        ) : (
                          payoutApprovalEvents.map((event) => (
                            <tr key={event.id}>
                              <td>{event.created_at ? new Date(event.created_at).toLocaleString() : ''}</td>
                              <td>{event.event_type}</td>
                              <td>{event.message || '-'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="muted small" style={{ marginTop: 8 }}>
                Pick a batch to view details and events.
              </div>
            )}
          </section>
        </>
      ) : null}

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

      {activeTab === 'reconciliation' ? (
        <>
      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Daily reconciliation</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" type="button" onClick={() => loadReconciliation()}>
              Refresh
            </button>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <label className="muted small">
            From
            <input
              type="date"
              value={reconFrom}
              onChange={(e) => setReconFrom(e.target.value)}
              style={{ padding: 8, marginLeft: 6 }}
            />
          </label>
          <label className="muted small">
            To
            <input
              type="date"
              value={reconTo}
              onChange={(e) => setReconTo(e.target.value)}
              style={{ padding: 8, marginLeft: 6 }}
            />
          </label>
          <button className="btn ghost" type="button" onClick={() => loadReconciliation({ from: reconFrom, to: reconTo })}>
            Apply
          </button>
          <label className="muted small">
            View
            <select
              value={reconView}
              onChange={(e) => setReconView(e.target.value as 'combined' | 'c2b' | 'stk')}
              style={{ marginLeft: 6 }}
            >
              <option value="combined">Combined</option>
              <option value="c2b">C2B only</option>
              <option value="stk">STK only</option>
            </select>
          </label>
        </div>
        {reconError ? <div className="err">Reconciliation error: {reconError}</div> : null}
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                {reconView === 'combined' ? (
                  <>
                    <th>C2B 4814003 credited</th>
                    <th>C2B 4814003 quarantined</th>
                    <th>C2B 4814003 rejected</th>
                    <th>STK credited</th>
                    <th>STK quarantined</th>
                    <th>STK rejected</th>
                    <th>Combined credited</th>
                    <th>Combined quarantined</th>
                    <th>Combined rejected</th>
                  </>
                ) : (
                  <>
                    <th>Credited</th>
                    <th>Quarantined</th>
                    <th>Rejected</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {reconDates.length === 0 && reconView === 'combined' ? (
                <tr>
                  <td colSpan={10} className="muted">
                    No reconciliation data found.
                  </td>
                </tr>
              ) : reconView === 'c2b' && reconPaybillRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No reconciliation data found.
                  </td>
                </tr>
              ) : reconView === 'stk' && reconChannelRows.filter((row) => row.channel === 'STK').length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No reconciliation data found.
                  </td>
                </tr>
              ) : (
                <>
                  {reconView === 'combined'
                    ? reconDates.map((date) => {
                        const c2b = reconC2bMap[date] || {}
                        const stk = reconStkMap[date] || {}
                        const combined = reconCombinedMap[date] || {}
                        return (
                          <tr key={date}>
                            <td className="mono">{date}</td>
                            <td>
                              {formatKes(c2b.credited_total)} ({c2b.credited_count || 0})
                            </td>
                            <td>
                              {formatKes(c2b.quarantined_total)} ({c2b.quarantined_count || 0})
                            </td>
                            <td>
                              {formatKes(c2b.rejected_total)} ({c2b.rejected_count || 0})
                            </td>
                            <td>
                              {formatKes(stk.credited_total)} ({stk.credited_count || 0})
                            </td>
                            <td>
                              {formatKes(stk.quarantined_total)} ({stk.quarantined_count || 0})
                            </td>
                            <td>
                              {formatKes(stk.rejected_total)} ({stk.rejected_count || 0})
                            </td>
                            <td>
                              {formatKes(combined.credited_total)} ({combined.credited_count || 0})
                            </td>
                            <td>
                              {formatKes(combined.quarantined_total)} ({combined.quarantined_count || 0})
                            </td>
                            <td>
                              {formatKes(combined.rejected_total)} ({combined.rejected_count || 0})
                            </td>
                          </tr>
                        )
                      })
                    : null}
                  {reconView === 'c2b'
                    ? reconPaybillRows.map((row) => (
                        <tr key={row.id || row.date}>
                          <td className="mono">{row.date || '-'}</td>
                          <td>
                            {formatKes(row.credited_total)} ({row.credited_count || 0})
                          </td>
                          <td>
                            {formatKes(row.quarantined_total)} ({row.quarantined_count || 0})
                          </td>
                          <td>
                            {formatKes(row.rejected_total)} ({row.rejected_count || 0})
                          </td>
                        </tr>
                      ))
                    : null}
                  {reconView === 'stk'
                    ? reconChannelRows
                        .filter((row) => row.channel === 'STK')
                        .map((row) => (
                          <tr key={row.id || row.date}>
                            <td className="mono">{row.date || '-'}</td>
                            <td>
                              {formatKes(row.credited_total)} ({row.credited_count || 0})
                            </td>
                            <td>
                              {formatKes(row.quarantined_total)} ({row.quarantined_count || 0})
                            </td>
                            <td>
                              {formatKes(row.rejected_total)} ({row.rejected_count || 0})
                            </td>
                          </tr>
                        ))
                    : null}
                </>
              )}
            </tbody>
          </table>
        </div>
      </section>
        </>
      ) : null}

      {activeTab === 'quarantine' ? (
        <>
      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Quarantined payments</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" type="button" onClick={() => loadQuarantine({ page: 1 })}>
              Refresh
            </button>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <label className="muted small">
            Risk level
            <select
              value={quarantineRiskLevel}
              onChange={(e) => loadQuarantine({ riskLevel: e.target.value, page: 1 })}
              style={{ padding: 8, marginLeft: 6 }}
            >
              <option value="">Any</option>
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
            </select>
          </label>
          <label className="muted small">
            Flag
            <input
              className="input"
              value={quarantineFlag}
              onChange={(e) => setQuarantineFlag(e.target.value)}
              placeholder="e.g. PAYBILL_MISMATCH"
              style={{ maxWidth: 220 }}
            />
          </label>
          <input
            className="input"
            placeholder="Search receipt, phone, account"
            value={quarantineSearch}
            onChange={(e) => setQuarantineSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void loadQuarantine({ search: (e.currentTarget as HTMLInputElement).value, page: 1 })
              }
            }}
            style={{ maxWidth: 240 }}
          />
          <button
            className="btn ghost"
            type="button"
            onClick={() => loadQuarantine({ flag: quarantineFlag, search: quarantineSearch, page: 1 })}
          >
            Apply
          </button>
          <span className="muted small">
            {quarantineTotal ? `Total ${quarantineTotal}` : '0 rows'}
          </span>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn ghost"
            type="button"
            onClick={() => loadQuarantine({ page: Math.max(1, quarantinePage - 1) })}
            disabled={quarantinePage <= 1}
          >
            Prev
          </button>
          <span className="muted small">
            Page {quarantinePage} of {Math.max(1, Math.ceil(quarantineTotal / quarantineLimit || 1))}
          </span>
          <button
            className="btn ghost"
            type="button"
            onClick={() =>
              loadQuarantine({
                page: Math.min(Math.max(1, Math.ceil(quarantineTotal / quarantineLimit || 1)), quarantinePage + 1),
              })
            }
            disabled={quarantinePage >= Math.max(1, Math.ceil(quarantineTotal / quarantineLimit || 1))}
          >
            Next
          </button>
          <label className="muted small">
            Page size:{' '}
            <select
              value={quarantineLimit}
              onChange={(e) => loadQuarantine({ limit: Number(e.target.value), page: 1 })}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </label>
        </div>
        {quarantineError ? <div className="err">Quarantine error: {quarantineError}</div> : null}
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Receipt</th>
                <th>Phone</th>
                <th>Amount</th>
                <th>Account</th>
                <th>Risk</th>
                <th>Flags</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {quarantineRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted">
                    No quarantined payments found.
                  </td>
                </tr>
              ) : (
                quarantineRows.map((row) => {
                  const id = row.id || ''
                  const action = id ? quarantineActions[id] : null
                  const rawState = id ? c2bRawState[id] : null
                  const open = !!rawState?.open
                  const flagKeys = row.risk_flags ? Object.keys(row.risk_flags) : []
                  return (
                    <Fragment key={id || row.receipt || row.created_at}>
                      <tr>
                        <td className="mono">
                          {row.created_at ? new Date(row.created_at).toLocaleString() : '-'}
                        </td>
                        <td className="mono">{row.receipt || row.id || '-'}</td>
                        <td>{row.msisdn || '-'}</td>
                        <td>{formatKes(row.amount)}</td>
                        <td className="mono">{row.account_reference || '-'}</td>
                        <td>
                          {row.risk_level || '-'} ({row.risk_score ?? 0})
                        </td>
                        <td>{flagKeys.length ? flagKeys.join(', ') : '-'}</td>
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
                            <input
                              className="input"
                              placeholder="Wallet id (optional)"
                              value={action?.wallet_id || ''}
                              onChange={(e) =>
                                updateQuarantineAction(id, { wallet_id: e.target.value })
                              }
                            />
                            <input
                              className="input"
                              placeholder="Note"
                              value={action?.note || ''}
                              onChange={(e) => updateQuarantineAction(id, { note: e.target.value })}
                            />
                            <div className="row" style={{ gap: 6 }}>
                              <button
                                className="btn ghost"
                                type="button"
                                onClick={() => resolveQuarantine(id, 'CREDIT')}
                                disabled={!id || !!action?.busy}
                              >
                                {action?.busy ? 'Resolving...' : 'Credit'}
                              </button>
                              <button
                                className="btn ghost"
                                type="button"
                                onClick={() => resolveQuarantine(id, 'REJECT')}
                                disabled={!id || !!action?.busy}
                              >
                                {action?.busy ? 'Resolving...' : 'Reject'}
                              </button>
                            </div>
                            {action?.msg ? <span className="muted small">{action.msg}</span> : null}
                            {action?.error ? <span className="err">Resolve error: {action.error}</span> : null}
                          </div>
                        </td>
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={8}>
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

      {activeTab === 'alerts' ? (
        <>
      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Ops alerts</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" type="button" onClick={() => loadAlerts({ page: 1 })}>
              Refresh
            </button>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <label className="muted small">
            Severity
            <select
              value={alertsSeverity}
              onChange={(e) => loadAlerts({ severity: e.target.value, page: 1 })}
              style={{ padding: 8, marginLeft: 6 }}
            >
              <option value="">Any</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </label>
          <label className="muted small">
            Type
            <input
              className="input"
              value={alertsType}
              onChange={(e) => setAlertsType(e.target.value)}
              placeholder="HIGH_RISK_PAYMENT"
              style={{ maxWidth: 220 }}
            />
          </label>
          <button className="btn ghost" type="button" onClick={() => loadAlerts({ type: alertsType, page: 1 })}>
            Apply
          </button>
          <span className="muted small">
            {alertsTotal ? `Total ${alertsTotal}` : '0 rows'}
          </span>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn ghost"
            type="button"
            onClick={() => loadAlerts({ page: Math.max(1, alertsPage - 1) })}
            disabled={alertsPage <= 1}
          >
            Prev
          </button>
          <span className="muted small">
            Page {alertsPage} of {Math.max(1, Math.ceil(alertsTotal / alertsLimit || 1))}
          </span>
          <button
            className="btn ghost"
            type="button"
            onClick={() =>
              loadAlerts({ page: Math.min(Math.max(1, Math.ceil(alertsTotal / alertsLimit || 1)), alertsPage + 1) })
            }
            disabled={alertsPage >= Math.max(1, Math.ceil(alertsTotal / alertsLimit || 1))}
          >
            Next
          </button>
          <label className="muted small">
            Page size:{' '}
            <select value={alertsLimit} onChange={(e) => loadAlerts({ limit: Number(e.target.value), page: 1 })}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </label>
        </div>
        {alertsError ? <div className="err">Alerts error: {alertsError}</div> : null}
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Severity</th>
                <th>Type</th>
                <th>Entity</th>
                <th>Payment</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {alertsRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No alerts found.
                  </td>
                </tr>
              ) : (
                alertsRows.map((row) => (
                  <tr key={row.id || row.created_at}>
                    <td className="mono">
                      {row.created_at ? new Date(row.created_at).toLocaleString() : '-'}
                    </td>
                    <td>{row.severity || '-'}</td>
                    <td>{row.type || '-'}</td>
                    <td>
                      {row.entity_type || '-'} {row.entity_id || ''}
                    </td>
                    <td className="mono">{row.payment_id || '-'}</td>
                    <td>{row.message || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
              onChange={(e) =>
                setPaybillForm((f) => ({ ...f, paybill_account: normalizeDigitsInput(e.target.value) }))
              }
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
        <PaybillHeader title="PayBill Accounts (4814003)" />
        <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Search paybill or USSD"
            value={paybillSearch}
            onChange={(e) => setPaybillSearch(e.target.value)}
            style={{ maxWidth: 240 }}
          />
          <span className="muted small">{filteredPaybillRows.length} row(s)</span>
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
                <th>Generated codes</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {filteredPaybillRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted">
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
                    <td>
                      {row.type === 'MATATU' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <PaybillCodeCard variant="inline" label="OWNER Account" code={row.owner_code || ''} />
                          <PaybillCodeCard variant="inline" label="MATATU Account" code={row.vehicle_code || ''} />
                          <PaybillCodeCard
                            variant="inline"
                            label="STK/USSD Reference (Plate)"
                            code={row.plate_alias || ''}
                          />
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <PaybillCodeCard variant="inline" label="SACCO FEE Account" code={row.fee_code || ''} />
                          <PaybillCodeCard variant="inline" label="SACCO LOAN Account" code={row.loan_code || ''} />
                          <PaybillCodeCard
                            variant="inline"
                            label="SACCO SAVINGS Account"
                            code={row.savings_code || ''}
                          />
                        </div>
                      )}
                    </td>
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
        <div className="card" style={{ marginTop: 10, background: '#f8fafc' }}>
          <h4 style={{ margin: '0 0 6px' }}>Account details</h4>
          <div className="grid g3" style={{ gap: 12 }}>
            <label className="muted small">
              Email
              <input
                className="input"
                placeholder="Email"
                value={loginForm.email}
                onChange={(e) => setLoginForm((f) => ({ ...f, email: e.target.value }))}
              />
            </label>
            <label className="muted small">
              Password
              <input
                className="input"
                placeholder="Password"
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))}
              />
            </label>
            <label className="muted small">
              Role
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
            </label>
          </div>
        </div>
        <div className="card" style={{ marginTop: 10 }}>
          <h4 style={{ margin: '0 0 6px' }}>Operator and vehicle</h4>
          <div className="muted small" style={{ marginBottom: 8 }}>
            Select the operator first, then vehicle type, then the specific vehicle.
          </div>
          <div className="grid g3" style={{ gap: 12 }}>
            <label className="muted small">
              Operator
              <select
                value={loginForm.operator_id}
                onChange={(e) =>
                  setLoginForm((f) => ({
                    ...f,
                    operator_id: e.target.value,
                    vehicle_id: '',
                  }))
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
              Vehicle type
              <select
                value={loginForm.vehicle_type}
                onChange={(e) =>
                  setLoginForm((f) => ({
                    ...f,
                    vehicle_type: e.target.value,
                    vehicle_id: '',
                  }))
                }
                style={{ padding: 10 }}
                disabled={!loginForm.operator_id}
              >
                <option value="">Select type</option>
                <option value="SHUTTLE">Shuttle</option>
                <option value="TAXI">Taxi</option>
                <option value="BODA">BodaBoda</option>
              </select>
            </label>
            <label className="muted small">
              Vehicle
              <select
                value={loginForm.vehicle_id}
                onChange={(e) => setLoginForm((f) => ({ ...f, vehicle_id: e.target.value }))}
                style={{ padding: 10 }}
                disabled={!loginForm.operator_id || !loginForm.vehicle_type}
              >
                <option value="">Select vehicle</option>
                {loginVehicleOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn"
            type="button"
            onClick={async () => {
              setLoginMsg('Saving...')
              try {
                const role = loginForm.role
                const needsSacco = ['SACCO', 'SACCO_STAFF'].includes(role)
                const needsVehicle = ['OWNER', 'STAFF', 'TAXI', 'BODA'].includes(role)
                if (!loginForm.email.trim()) {
                  setLoginMsg('Email required')
                  return
                }
                if (!loginForm.password) {
                  setLoginMsg('Password required')
                  return
                }
                if (needsSacco && !loginForm.operator_id) {
                  setLoginMsg('Select operator')
                  return
                }
                if (needsVehicle) {
                  if (!loginForm.operator_id) {
                    setLoginMsg('Select operator')
                    return
                  }
                  if (!loginForm.vehicle_type) {
                    setLoginMsg('Select vehicle type')
                    return
                  }
                  if (!loginForm.vehicle_id) {
                    setLoginMsg('Select vehicle')
                    return
                  }
                }
                await sendJson('/api/admin/user-roles/create-user', 'POST', {
                  email: loginForm.email.trim(),
                  password: loginForm.password,
                  role,
                  sacco_id: loginForm.operator_id || null,
                  vehicle_id: loginForm.vehicle_id || null,
                  vehicle_type: loginForm.vehicle_type || null,
                })
                setLoginMsg('Login created')
                setLoginForm({
                  email: '',
                  password: '',
                  role: 'SACCO',
                  operator_id: '',
                  vehicle_type: '',
                  vehicle_id: '',
                })
                await loadLogins()
              } catch (err) {
                setLoginMsg(err instanceof Error ? err.message : 'Create failed')
              }
            }}
          >
            Create login
          </button>
          <span className="muted small">{loginMsg}</span>
        </div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>SACCO</th>
                <th>Vehicle</th>
                <th>Password</th>
                <th>ID</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {logins.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No logins.
                  </td>
                </tr>
              ) : (
                logins.map((row) => {
                  const rowId = row.user_id || ''
                  const inline = rowId ? loginInlineEdits[rowId] : null
                  const emailValue = (inline?.email ?? row.email ?? '').toString()
                  const passwordValue = (inline?.password ?? '').toString()
                  return (
                    <tr key={row.user_id || row.email}>
                      <td>
                        <input
                          className="input"
                          value={emailValue}
                          onChange={(e) => {
                            if (!rowId) return
                            setLoginInlineEdits((prev) => ({
                              ...prev,
                              [rowId]: { ...prev[rowId], email: e.target.value },
                            }))
                          }}
                        />
                      </td>
                      <td>{row.role || ''}</td>
                      <td>{row.sacco_id || ''}</td>
                      <td>{row.matatu_id || ''}</td>
                      <td>
                        <input
                          className="input"
                          type="password"
                          placeholder="New password"
                          value={passwordValue}
                          onChange={(e) => {
                            if (!rowId) return
                            setLoginInlineEdits((prev) => ({
                              ...prev,
                              [rowId]: { ...prev[rowId], password: e.target.value },
                            }))
                          }}
                        />
                      </td>
                      <td className="mono">{row.user_id || ''}</td>
                      <td className="row" style={{ gap: 6 }}>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={async () => {
                            if (!row.user_id) return
                            try {
                              const nextEmail = (emailValue || '').trim()
                              const nextPassword = passwordValue
                              const payload: Record<string, unknown> = {
                                user_id: row.user_id,
                                role: row.role,
                                sacco_id: row.sacco_id || null,
                                matatu_id: row.matatu_id || null,
                              }
                              if (nextEmail) payload.email = nextEmail
                              if (nextPassword) payload.password = nextPassword
                              await sendJson('/api/admin/user-roles/update', 'POST', payload)
                              await loadLogins()
                              setLoginInlineEdits((prev) => ({
                                ...prev,
                                [row.user_id || '']: { email: nextEmail, password: '' },
                              }))
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
                  )
                })
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
