import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import PaybillCodeCard from '../components/PaybillCodeCard'
import PaybillHeader from '../components/PaybillHeader'
import StickerPrintModal from '../components/StickerPrintModal'
import { authFetch } from '../lib/auth'
import { mapPaybillCodes, type PaybillAliasRow } from '../lib/paybill'
import { getOperatorConfig, normalizeOperatorType } from '../lib/operatorConfig'
import VehicleCarePage from '../modules/vehicleCare/VehicleCarePage'
import { fetchAccessGrants, saveAccessGrant, type AccessGrant } from '../modules/vehicleCare/vehicleCare.api'
import { useAuth } from '../state/auth'
import { useActiveSacco } from '../state/activeSacco'

type SaccoOption = {
  sacco_id: string
  name?: string
  display_name?: string | null
  operator_type?: string | null
  org_type?: string | null
  operatorType?: string | null
  role?: string | null
  manages_fleet?: boolean | null
}
type Matatu = {
  id?: string
  number_plate?: string
  owner_name?: string
  owner_phone?: string
  vehicle_type?: string
  tlb_number?: string
  till_number?: string
  savings_opt_in?: boolean
}

type Tx = {
  id?: string
  created_at?: string
  kind?: string
  status?: string
  matatu_id?: string
  fare_amount_kes?: number
  passenger_msisdn?: string
  notes?: string
  created_by_name?: string
  created_by_email?: string
}

type Staff = {
  id?: string
  name?: string
  phone?: string
  email?: string
  role?: string
  user_id?: string
}

type SummaryBuckets = {
  SACCO_FEE: { today: number; week: number; month: number }
  SAVINGS: { today: number; week: number; month: number }
  LOAN_REPAY: { today: number; week: number; month: number }
}

type LoanRequest = {
  id?: string
  created_at?: string
  decided_at?: string
  owner_name?: string
  matatu_id?: string
  amount_kes?: number
  model?: string
  term_months?: number
  payout_method?: string
  payout_phone?: string
  payout_account?: string
  loan_id?: string
  disbursed_at?: string
  disbursed_method?: string
  disbursed_reference?: string
  note?: string
  status?: string
  rejection_reason?: string
}

type DailyFeeRate = { vehicle_type?: string; daily_fee_kes?: number }

type SaccoRoute = {
  id?: string
  name?: string
  active?: boolean
  sacco_id?: string
  code?: string
  start_stop?: string
  end_stop?: string
  path_points?: unknown
}

type Loan = {
  id?: string
  sacco_id?: string
  matatu_id?: string
  borrower_name?: string
  principal_kes?: number
  interest_rate_pct?: number
  term_months?: number
  status?: string
  collection_model?: string
  start_date?: string
  created_at?: string
}

type LoanDue = Loan & {
  next_due_date?: string
  due_status?: string
}

type LivePosition = {
  matatu_id?: string
  route_id?: string
  lat?: number
  lng?: number
  recorded_at?: string
}

type PayoutDestination = {
  id?: string
  destination_type?: string
  destination_ref?: string
  destination_name?: string | null
  is_verified?: boolean
  created_at?: string
}

type PayoutBatch = {
  id?: string
  sacco_id?: string
  date_from?: string
  date_to?: string
  status?: string
  total_amount?: number
  currency?: string
  created_at?: string
  updated_at?: string
  meta?: Record<string, any>
}

type PayoutItem = {
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
  idempotency_key?: string
  created_at?: string
}

type PayoutEvent = {
  id?: string
  event_type?: string
  message?: string | null
  meta?: Record<string, unknown>
  created_at?: string
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

type SaccoPayoutReadiness = {
  sacco_id?: string
  date_from?: string
  date_to?: string
  checks?: {
    has_verified_msisdn_destination?: ReadinessCheck
    no_quarantines_in_window?: ReadinessCheck
    has_positive_balances?: ReadinessCheck
    b2c_env_present?: ReadinessCheck
  }
  wallet_balances?: Array<{ wallet_kind?: string; wallet_id?: string; balance?: number }>
  quarantines?: { count?: number; sample?: Array<{ id?: string; created_at?: string; account_reference?: string; reason?: string }> }
  destinations?: { total?: number; verified_msisdn_count?: number }
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
}

type LedgerRow = {
  id?: string
  wallet_id?: string
  direction?: 'CREDIT' | 'DEBIT' | string
  amount?: number
  balance_before?: number
  balance_after?: number
  entry_type?: string
  reference_type?: string
  reference_id?: string
  description?: string | null
  created_at?: string
}

type LedgerWallet = {
  wallet_id?: string
  wallet_kind?: string
  virtual_account_code?: string
  balance?: number
  total?: number
  items?: LedgerRow[]
}

type NotificationItem = {
  id: string
  message: string
  severity: 'INFO' | 'WARN' | 'CRITICAL'
  is_read?: boolean
}

const SACCO_LEDGER_KINDS = ['SACCO_FEE', 'SACCO_LOAN', 'SACCO_SAVINGS'] as const

type SaccoTabId =
  | 'overview'
  | 'members'
  | 'daily_fee'
  | 'savings'
  | 'loans'
  | 'payouts'
  | 'staff'
  | 'routes'
  | 'vehicle_care'

function fmtKES(v: number | undefined | null) {
  return `KES ${(Number(v || 0)).toLocaleString('en-KE')}`
}

function debugAuth(msg: string, payload?: Record<string, unknown>) {
  if (import.meta.env.VITE_DEBUG_AUTH === '1') {
    console.log('[sacco]', msg, payload || {})
  }
}

function formatKind(kind?: string, feeLabel = 'Daily Fee') {
  const k = (kind || '').toUpperCase()
  if (k === 'SACCO_FEE') return feeLabel
  if (k === 'SAVINGS') return 'Savings'
  if (k === 'LOAN_REPAY') return 'Loan Repay'
  return k || '-'
}

function formatPayoutKind(kind?: string, feeLabel = 'Daily Fee') {
  const k = (kind || '').toUpperCase()
  if (k === 'SACCO_FEE' || k === 'FEE' || k === 'SACCO_DAILY_FEE') return feeLabel
  if (k === 'SACCO_LOAN' || k === 'LOAN') return 'Loan'
  if (k === 'SACCO_SAVINGS' || k === 'SAVINGS') return 'Savings'
  return k || '-'
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

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function SaccoDashboard() {
  const { user } = useAuth()
const { activeSaccoId, setActiveSacco } = useActiveSacco()
  const currentSacco = activeSaccoId
  const [saccos, setSaccos] = useState<SaccoOption[]>([])
  const [statusMsg, setStatusMsg] = useState('Loading organizations...')
  const [activeTab, setActiveTab] = useState<SaccoTabId>('overview')
  const [timeLabel, setTimeLabel] = useState('')

  const [fromDate, setFromDate] = useState(todayIso())
  const [toDate, setToDate] = useState(todayIso())
  const [txStatus, setTxStatus] = useState<string>('')
  const [txSearch, setTxSearch] = useState('')
  const [txSearchApplied, setTxSearchApplied] = useState('')
  const [txKindFilter, setTxKindFilter] = useState('')
  const [txRows, setTxRows] = useState<Tx[]>([])
  const [txPage, setTxPage] = useState(1)
  const [txLimit, setTxLimit] = useState(50)
  const [txTotal, setTxTotal] = useState(0)
  const [txLoading, setTxLoading] = useState(false)
  const [txError, setTxError] = useState<string | null>(null)

  const [matatus, setMatatus] = useState<Matatu[]>([])
  const [matatuFilter, setMatatuFilter] = useState('')
  const [paybillAliases, setPaybillAliases] = useState<PaybillAliasRow[]>([])
  const [paybillError, setPaybillError] = useState<string | null>(null)
  const [showPaybillSticker, setShowPaybillSticker] = useState(false)
  const [memberMsg, setMemberMsg] = useState('')
  const [tlbEdits, setTlbEdits] = useState<Record<string, string>>({})
  const [txs, setTxs] = useState<Tx[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [staffMsg, setStaffMsg] = useState('')
  const [staffError, setStaffError] = useState<string | null>(null)
  const [staffForm, setStaffForm] = useState({
    name: '',
    phone: '',
    email: '',
    role: 'SACCO_STAFF',
    password: '',
  })
  const [staffEditId, setStaffEditId] = useState('')
  const [staffEditForm, setStaffEditForm] = useState({
    name: '',
    phone: '',
    email: '',
    role: 'SACCO_STAFF',
  })
  const [staffEditMsg, setStaffEditMsg] = useState('')
  const [staffEditError, setStaffEditError] = useState<string | null>(null)
  const [accessGrants, setAccessGrants] = useState<AccessGrant[]>([])
  const [accessGrantMsg, setAccessGrantMsg] = useState('')
  const [accessGrantError, setAccessGrantError] = useState<string | null>(null)
  const [myAccessGrants, setMyAccessGrants] = useState<AccessGrant[]>([])
  const [staffAccessForm, setStaffAccessForm] = useState({
    role: 'STAFF',
    can_manage_staff: false,
    can_manage_vehicles: false,
    can_manage_vehicle_care: false,
    can_manage_compliance: false,
    can_view_analytics: true,
    is_active: true,
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [notificationFilter, setNotificationFilter] = useState<'ALL' | 'WARN' | 'CRITICAL'>('ALL')
  const [notificationSearch, setNotificationSearch] = useState('')
  const [notificationUnreadOnly, setNotificationUnreadOnly] = useState(false)
  const [loanRequests, setLoanRequests] = useState<LoanRequest[]>([])
  const [loanReqMsg, setLoanReqMsg] = useState('')
  const [loanDisb, setLoanDisb] = useState<LoanRequest[]>([])
  const [loanDisbMsg, setLoanDisbMsg] = useState('')
  const [loanApprovals, setLoanApprovals] = useState<LoanRequest[]>([])
  const [loanApprovalsMsg, setLoanApprovalsMsg] = useState('')
  const [loanApprovalsStatus, setLoanApprovalsStatus] = useState('APPROVED,REJECTED,CANCELLED')
  const [loanDue, setLoanDue] = useState<LoanDue[]>([])
  const [loanDueMsg, setLoanDueMsg] = useState('')
  const [feeRates, setFeeRates] = useState<DailyFeeRate[]>([])
  const [feeForm, setFeeForm] = useState({ vehicle_type: '', amount: '' })
  const [feeMsg, setFeeMsg] = useState('')
  const [routes, setRoutes] = useState<SaccoRoute[]>([])
  const [routesMsg, setRoutesMsg] = useState('')
  const [stkForm, setStkForm] = useState({ code: '', amount: '', phone: '' })
  const [stkResp, setStkResp] = useState('')
  const [payoutDestinations, setPayoutDestinations] = useState<PayoutDestination[]>([])
  const [payoutDestError, setPayoutDestError] = useState<string | null>(null)
  const [payoutDestMsg, setPayoutDestMsg] = useState('')
  const [payoutDestForm, setPayoutDestForm] = useState({
    destination_type: 'MSISDN',
    destination_ref: '',
    destination_name: '',
  })
  const [payoutReadiness, setPayoutReadiness] = useState<SaccoPayoutReadiness | null>(null)
  const [payoutReadinessMsg, setPayoutReadinessMsg] = useState('')
  const [payoutReadinessError, setPayoutReadinessError] = useState<string | null>(null)
  const [payoutFrom, setPayoutFrom] = useState(todayIso())
  const [payoutTo, setPayoutTo] = useState(todayIso())
  const [payoutBatches, setPayoutBatches] = useState<PayoutBatch[]>([])
  const [payoutBatchError, setPayoutBatchError] = useState<string | null>(null)
  const [payoutBatchMsg, setPayoutBatchMsg] = useState('')
  const [payoutBatchForm, setPayoutBatchForm] = useState({
    date_from: todayIso(),
    date_to: todayIso(),
    include_wallet_kinds: { SACCO_FEE: true, SACCO_LOAN: true, SACCO_SAVINGS: true },
    destination_by_kind: { SACCO_FEE: '', SACCO_LOAN: '', SACCO_SAVINGS: '' },
  })
  const [payoutAmountByKind, setPayoutAmountByKind] = useState<Record<string, string>>({
    SACCO_FEE: '',
    SACCO_LOAN: '',
    SACCO_SAVINGS: '',
  })
  const [selectedPayoutBatchId, setSelectedPayoutBatchId] = useState('')
  const [payoutBatchDetail, setPayoutBatchDetail] = useState<PayoutBatch | null>(null)
  const [payoutItems, setPayoutItems] = useState<PayoutItem[]>([])
  const [payoutEvents, setPayoutEvents] = useState<PayoutEvent[]>([])
  const [payoutBatchReadiness, setPayoutBatchReadiness] = useState<BatchReadiness | null>(null)
  const [payoutDraftItems, setPayoutDraftItems] = useState<
    Array<{ id?: string; wallet_kind?: string; amount?: string; destination_id?: string }>
  >([])
  const [ledgerData, setLedgerData] = useState<Record<string, LedgerWallet>>({})
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState<string | null>(null)
  const [ledgerFrom, setLedgerFrom] = useState(todayIso())
  const [ledgerTo, setLedgerTo] = useState(todayIso())
  const [loans, setLoans] = useState<Loan[]>([])
  const [loanMsg, setLoanMsg] = useState('')
  const [loanForm, setLoanForm] = useState({
    matatu_id: '',
    borrower_name: '',
    principal: '',
    rate: '',
    term: '3',
    status: 'ACTIVE',
  })
  const [loanHistory, setLoanHistory] = useState<{ loanId?: string | null; items: Tx[]; total?: number; msg?: string }>({
    loanId: null,
    items: [],
    total: 0,
    msg: 'Select a loan',
  })
  const [routeViewId, setRouteViewId] = useState('')
  const [routeMapMsg, setRouteMapMsg] = useState('')
  const [routeLive, setRouteLive] = useState<LivePosition[]>([])
  const [routeLiveMsg, setRouteLiveMsg] = useState('')
  const mapRef = useRef<HTMLDivElement | null>(null)
  const mapInstance = useRef<any>(null)
  const mapLayers = useRef<{ polyline?: any; routeMarkers?: any[]; liveMarkers?: any[] }>({})
  const leafletLoader = useRef<Promise<any> | null>(null)

  const operatorType = useMemo(() => {
    const selected = saccos.find((s) => s.sacco_id === activeSaccoId)
    // TODO: backend should guarantee operator_type on /u/my-saccos for operator typing.
    const rawType = selected?.operator_type || selected?.org_type || selected?.operatorType
    return normalizeOperatorType(rawType)
  }, [saccos, activeSaccoId])

  const operatorConfig = useMemo(() => getOperatorConfig(operatorType), [operatorType])
  const currentOperator = useMemo(() => saccos.find((s) => s.sacco_id === activeSaccoId) || null, [saccos, activeSaccoId])
  const operatorRole = (currentOperator?.role || '').toString().toUpperCase()
  const isOperatorAdmin = operatorRole === 'SACCO' || operatorRole === 'SACCO_ADMIN'
  const operatorManagesFleet = currentOperator?.manages_fleet === true
  const myOperatorGrant = useMemo(
    () =>
      myAccessGrants.find(
        (grant) => grant.scope_type === 'OPERATOR' && String(grant.scope_id || '') === String(currentSacco || ''),
      ) || null,
    [myAccessGrants, currentSacco],
  )
  const canManageVehicleCare = Boolean((isOperatorAdmin && operatorManagesFleet) || myOperatorGrant?.can_manage_vehicle_care)
  const canManageCompliance = Boolean((isOperatorAdmin && operatorManagesFleet) || myOperatorGrant?.can_manage_compliance)
  const canViewVehicleCareAnalytics =
    isOperatorAdmin || myOperatorGrant?.can_view_analytics === undefined || myOperatorGrant?.can_view_analytics === true
  const memberLabel = operatorConfig.memberLabel
  const memberIdLabel = operatorConfig.memberIdLabel
  const memberOwnerLabel = operatorConfig.memberOwnerLabel
  const memberLocationLabel = operatorConfig.memberLocationLabel
  const feeLabel = operatorConfig.feeLabel
  const routesLabel = operatorConfig.routesLabel
  const showRouteMap = operatorConfig.showRouteMap
  const isBoda = operatorType === 'BODA_GROUP'
  const routeLabel = routesLabel.endsWith('s') ? routesLabel.slice(0, -1) : routesLabel

  const tabs = useMemo<Array<{ id: SaccoTabId; label: string }>>(() => {
    const items: Array<{ id: SaccoTabId; label: string }> = [
      { id: 'overview', label: 'Overview' },
      { id: 'members', label: memberLabel },
      { id: 'daily_fee', label: feeLabel },
      { id: 'savings', label: 'Savings' },
      { id: 'loans', label: 'Loans' },
    ]
    if (isOperatorAdmin) {
      items.push({ id: 'payouts', label: 'Payouts' })
    }
    items.push({ id: 'staff', label: 'Staff' })
    items.push({ id: 'routes', label: routesLabel })
    items.push({ id: 'vehicle_care', label: 'Vehicle Care' })
    return items
  }, [feeLabel, isOperatorAdmin, memberLabel, routesLabel])
  const showFilters = true

  const memberIdValue = (m: Matatu) => m.number_plate || m.id || ''
  const memberLocationValue = (m: Matatu) => (memberLocationLabel ? m.vehicle_type || '' : '')

  const matatuMap = useMemo(() => {
    const map = new Map<string, string>()
    matatus.forEach((m) => {
      if (m.id) map.set(m.id, memberIdValue(m))
    })
    return map
  }, [matatus])

  const paybillCodes = useMemo(() => mapPaybillCodes(paybillAliases), [paybillAliases])

  const payoutDestinationById = useMemo(() => {
    const map = new Map<string, PayoutDestination>()
    payoutDestinations.forEach((dest) => {
      if (dest.id) map.set(dest.id, dest)
    })
    return map
  }, [payoutDestinations])

  const payoutBalancesByKind = useMemo(() => {
    const map = new Map<string, number>()
    ;(payoutReadiness?.wallet_balances || []).forEach((row) => {
      if (row.wallet_kind) map.set(row.wallet_kind, Number(row.balance || 0))
    })
    return map
  }, [payoutReadiness])

  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications],
  )

  const filteredNotifications = useMemo(() => {
    const search = notificationSearch.trim().toLowerCase()
    return notifications
      .filter((n) => {
        if (notificationFilter === 'WARN' && n.severity !== 'WARN') return false
        if (notificationFilter === 'CRITICAL' && n.severity !== 'CRITICAL') return false
        return true
      })
      .filter((n) => {
        if (!search) return true
        return n.message.toLowerCase().includes(search)
      })
      .filter((n) => (notificationUnreadOnly ? !n.is_read : true))
  }, [notifications, notificationFilter, notificationSearch, notificationUnreadOnly])

  useEffect(() => {
    setPayoutAmountByKind((prev) => {
      const next = { ...prev }
      ;(['SACCO_FEE', 'SACCO_LOAN', 'SACCO_SAVINGS'] as const).forEach((kind) => {
        if (!next[kind] || Number(next[kind]) <= 0) {
          const bal = payoutBalancesByKind.get(kind) || 0
          if (bal > 0) next[kind] = String(bal)
        }
      })
      return next
    })
  }, [payoutBalancesByKind])

  const payoutReadinessChecks = payoutReadiness?.checks || null
  const payoutReadinessBlocking = payoutReadinessChecks
    ? Object.values(payoutReadinessChecks).some((check) => check && check.pass === false)
    : true
  const payoutReadinessFirstReason = payoutReadinessChecks
    ? Object.values(payoutReadinessChecks).find((check) => check && check.pass === false)?.reason || ''
    : ''

  const payoutReadinessFixes = useMemo(() => {
    const fixes: string[] = []
    if (!payoutReadinessChecks) return fixes
    if (payoutReadinessChecks.has_verified_msisdn_destination?.pass === false) {
      fixes.push('Add an MSISDN destination and ask a system admin to verify it.')
    }
    if (payoutReadinessChecks.no_quarantines_in_window?.pass === false) {
      fixes.push('Resolve quarantined payments in the selected date window.')
    }
    if (payoutReadinessChecks.has_positive_balances?.pass === false) {
      fixes.push('Wait for collections or top up wallets before submitting payouts.')
    }
    if (payoutReadinessChecks.b2c_env_present?.pass === false) {
      fixes.push('Ask a system admin to configure the MPESA_B2C_* environment variables.')
    }
    return fixes
  }, [payoutReadinessChecks])

  const payoutBlockedPreview = useMemo(() => {
    const previews: Array<{ kind: string; reason: string }> = []
    const selectedKinds = Object.entries(payoutBatchForm.include_wallet_kinds).filter(([, v]) => v)
    selectedKinds.forEach(([kind]) => {
      const destinationId =
        payoutBatchForm.destination_by_kind[
          kind as 'SACCO_FEE' | 'SACCO_LOAN' | 'SACCO_SAVINGS'
        ]
      const destination = destinationId ? payoutDestinationById.get(destinationId) : null
      if (destination?.destination_type === 'PAYBILL_TILL') {
        previews.push({ kind, reason: 'B2B_NOT_SUPPORTED' })
      }
      const balance = payoutBalancesByKind.get(kind) || 0
      if (balance <= 0) {
        previews.push({ kind, reason: 'ZERO_BALANCE' })
      }
    })
    return previews
  }, [payoutBatchForm, payoutDestinationById, payoutBalancesByKind])

  const payoutAmountErrors = useMemo(() => {
    const map = new Map<string, string>()
    Object.entries(payoutBatchForm.include_wallet_kinds)
      .filter(([, enabled]) => enabled)
      .forEach(([kind]) => {
        const raw = payoutAmountByKind[kind] || ''
        const amount = Number(raw)
        const balance = payoutBalancesByKind.get(kind) || 0
        if (!Number.isFinite(amount) || amount <= 0) {
          map.set(kind, 'Amount must be greater than 0')
        } else if (amount > balance) {
          map.set(kind, 'Amount exceeds available balance')
        }
      })
    return map
  }, [payoutAmountByKind, payoutBalancesByKind, payoutBatchForm.include_wallet_kinds])

  const batchSubmitCheck = payoutBatchReadiness?.checks?.can_submit

  const grantsByUserId = useMemo(() => {
    const map = new Map<string, AccessGrant>()
    accessGrants.forEach((grant) => {
      if (grant.user_id) map.set(grant.user_id, grant)
    })
    return map
  }, [accessGrants])

  const routeById = useMemo(() => {
    const map = new Map<string, SaccoRoute>()
    routes.forEach((r) => {
      if (r.id) map.set(r.id, r)
    })
    return map
  }, [routes])

  const selectedRoute = routeViewId ? routeById.get(routeViewId) || null : null

  const routePoints = useMemo(() => {
    const raw = selectedRoute?.path_points
    if (!raw || !Array.isArray(raw)) return []
    const points: Array<[number, number]> = []
    raw.forEach((p) => {
      if (Array.isArray(p) && p.length >= 2) {
        const lat = Number(p[0])
        const lng = Number(p[1])
        if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng])
      } else if (p && typeof p === 'object') {
        const lat = Number((p as { lat?: unknown }).lat)
        const lng = Number((p as { lng?: unknown }).lng)
        if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng])
      }
    })
    return points
  }, [selectedRoute])

  const filteredMatatus = useMemo(() => {
    const q = matatuFilter.trim().toUpperCase()
    if (!q) return matatus
    return matatus.filter((m) => {
      const id = memberIdValue(m).toUpperCase()
      const owner = (m.owner_name || '').toUpperCase()
      return id.includes(q) || owner.includes(q)
    })
  }, [matatuFilter, matatus])

  async function updateSavingsOptIn(matatuId?: string, next?: boolean) {
    if (!matatuId) return
    setMemberMsg('Saving...')
    try {
      const updated = await fetchJson<Matatu>(`/u/matatu/${encodeURIComponent(matatuId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ savings_opt_in: !!next }),
      })
      setMatatus((prev) =>
        prev.map((m) => (m.id === matatuId ? { ...m, savings_opt_in: updated.savings_opt_in } : m)),
      )
      setMemberMsg('Saved')
    } catch (err) {
      setMemberMsg(err instanceof Error ? err.message : 'Failed to update savings')
    }
  }

  async function updateTlbNumber(matatuId?: string) {
    if (!matatuId) return
    const next = (tlbEdits[matatuId] ?? '').trim()
    setMemberMsg('Saving...')
    try {
      const updated = await fetchJson<Matatu>(`/u/matatu/${encodeURIComponent(matatuId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ tlb_number: next || null }),
      })
      setMatatus((prev) => prev.map((m) => (m.id === matatuId ? { ...m, tlb_number: updated.tlb_number } : m)))
      setMemberMsg('Saved')
    } catch (err) {
      setMemberMsg(err instanceof Error ? err.message : 'Failed to update TLB')
    }
  }

  const showTLBColumn = useMemo(
    () => operatorConfig.showTLB && matatus.some((m) => (m.tlb_number || '').trim()),
    [operatorConfig.showTLB, matatus],
  )
  const showVehicleTypeColumn = useMemo(
    () => operatorConfig.showVehicleType && matatus.some((m) => (m.vehicle_type || '').trim()),
    [operatorConfig.showVehicleType, matatus],
  )
  const showMemberLocation = useMemo(
    () => Boolean(memberLocationLabel) && matatus.some((m) => (memberLocationValue(m) || '').trim()),
    [memberLocationLabel, matatus],
  )
  const memberTableColSpan =
    5 + (showVehicleTypeColumn ? 1 : 0) + (showMemberLocation ? 1 : 0) + (showTLBColumn ? 1 : 0)
  const bodaTableColSpan = 5 + (showMemberLocation ? 1 : 0)

  const txPageCount = Math.max(1, Math.ceil(txTotal / txLimit || 1))
  const txRangeStart = txTotal ? (txPage - 1) * txLimit + 1 : 0
  const txRangeEnd = txTotal ? Math.min(txTotal, txPage * txLimit) : 0

  const vehicleTypes = useMemo(() => {
    const fromMatatus = matatus.map((m) => (m.vehicle_type || '').trim()).filter(Boolean)
    const fromRates = feeRates.map((r) => (r.vehicle_type || '').trim()).filter(Boolean)
    return Array.from(new Set([...fromMatatus, ...fromRates])).sort()
  }, [matatus, feeRates])

  const dateLabel = useMemo(
    () =>
      new Date().toLocaleDateString('en-KE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
    [],
  )
  const operatorLabel = useMemo(() => {
    const match = saccos.find((s) => s.sacco_id === activeSaccoId)
    return match?.name || 'Operator'
  }, [activeSaccoId, saccos])

  const staffLabel = useMemo(() => {
    if (!user?.id) return ''
    const email = user.email ? user.email.toString().trim().toLowerCase() : ''
    const match =
      staff.find((s) => s.user_id === user.id) ||
      (email ? staff.find((s) => (s.email || '').toString().trim().toLowerCase() === email) : null)
    return match?.name || ''
  }, [staff, user?.email, user?.id])

  const helloLabel =
    staffLabel || (user?.email ? user.email.split('@')[0] : '') || (operatorLabel !== 'Operator' ? operatorLabel : 'Admin')
  const dashboardTitle = operatorLabel !== 'Operator' ? `${operatorLabel} Dashboard` : 'Operator Dashboard'
  const subtitleParts = [helloLabel ? `Hello, ${helloLabel}` : 'Operator dashboard', dateLabel, timeLabel].filter(Boolean)
  const dashboardSubtitle = subtitleParts.join(' | ')

  useEffect(() => {
    const updateTime = () => {
      setTimeLabel(
        new Date().toLocaleTimeString('en-KE', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
      )
    }
    updateTime()
    const timer = setInterval(updateTime, 60000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    async function loadSaccos() {
      try {
        const data = await fetchJson<{ items: SaccoOption[] }>('/u/my-saccos')
        const items = data.items || []
        setSaccos(items)
        setStatusMsg(`${items.length} organization(s)`)
        const match = activeSaccoId ? items.find((s) => s.sacco_id === activeSaccoId) : null
        if (!match) {
          if (!activeSaccoId && items.length === 1) {
            setActiveSacco(items[0].sacco_id || null, items[0].name || items[0].display_name || null)
            debugAuth('auto_select_single_sacco', { sacco_id: items[0].sacco_id })
          } else if (activeSaccoId) {
            setActiveSacco(null)
            debugAuth('clear_invalid_sacco', { sacco_id: activeSaccoId })
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load organizations')
        setStatusMsg('Load error')
      }
    }
    loadSaccos()
  }, [activeSaccoId, setActiveSacco])

  useEffect(() => {
    void loadMyAccessGrants()
  }, [])

  useEffect(() => {
    if (!currentSacco) return
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [matatuRes, txRes, staffRes] = await Promise.all([
          fetchJson<{ items: Matatu[] }>(`/u/sacco/${currentSacco}/matatus`),
          fetchJson<{ items: Tx[] }>(`/u/sacco/${currentSacco}/transactions?limit=2000`),
          fetchJson<{ items: Staff[] }>(`/u/sacco/${currentSacco}/staff`),
        ])
        setMatatus(matatuRes.items || [])
        setTxs(txRes.items || [])
        setStaff(staffRes.items || [])
        setTxSearch('')
        setTxSearchApplied('')
        setTxKindFilter('')
        setTxPage(1)
        setTxRows([])
        setTxTotal(0)
        await Promise.all([
          loadLoanRequests(),
          loadLoanDisbursements(),
          loadDailyFeeRates(),
          loadRoutes(),
          loadNotifications(),
          loadLoans(),
        ])
        await loadAccessGrants()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentSacco])

  useEffect(() => {
    if (!currentSacco) {
      setPaybillAliases([])
      setPaybillError(null)
      return
    }
    const saccoId = currentSacco
    async function loadPaybillCodes() {
      try {
        const res = await fetchJson<{ items?: PaybillAliasRow[] }>(
          `/u/paybill-codes?entity_type=SACCO&entity_id=${encodeURIComponent(saccoId)}`,
        )
        setPaybillAliases(res.items || [])
        setPaybillError(null)
      } catch (err) {
        setPaybillAliases([])
        setPaybillError(err instanceof Error ? err.message : 'Failed to load PayBill codes')
      }
    }
    loadPaybillCodes()
  }, [currentSacco])

  useEffect(() => {
    if (!currentSacco || !isOperatorAdmin) return
    void loadPayoutDestinations()
    void loadPayoutBatches()
  }, [currentSacco, isOperatorAdmin])

  useEffect(() => {
    if (!currentSacco || !isOperatorAdmin || activeTab !== 'payouts') return
    void loadPayoutReadiness()
  }, [currentSacco, isOperatorAdmin, activeTab, payoutBatchForm.date_from, payoutBatchForm.date_to])

  useEffect(() => {
    if (!currentSacco) return
    void loadPagedTransactions({ page: 1 })
  }, [currentSacco, fromDate, toDate, txStatus, txKindFilter, txSearchApplied, txLimit])

  useEffect(() => {
    if (!currentSacco) return
    void loadLoanApprovalsHistory()
  }, [currentSacco, loanApprovalsStatus])

  useEffect(() => {
    if (!currentSacco) return
    void loadLoanDue()
  }, [currentSacco])

  useEffect(() => {
    if (activeTab !== 'routes' || !showRouteMap || !routeViewId) return
    void loadRouteLive()
  }, [activeTab, routeViewId, showRouteMap])

  useEffect(() => {
    if (activeTab !== 'routes' || !showRouteMap) return
    let cancelled = false
    ;(async () => {
      try {
        setRouteMapMsg('Loading map...')
        const L = await ensureLeaflet()
        if (cancelled || !mapRef.current) return
        if (!mapInstance.current) {
          const center = routePoints[0] || [-1.286389, 36.817223]
          mapInstance.current = L.map(mapRef.current).setView(center, 12)
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: '&copy; OpenStreetMap',
          }).addTo(mapInstance.current)
        }
        syncRouteMap()
        setRouteMapMsg('')
      } catch (err) {
        if (!cancelled) {
          setRouteMapMsg(err instanceof Error ? err.message : 'Map failed to load')
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, routeViewId, showRouteMap])

  useEffect(() => {
    if (activeTab === 'routes' && showRouteMap) syncRouteMap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, routePoints, routeLive, showRouteMap])

  useEffect(() => {
    if (activeTab === 'overview') {
      void loadLedger()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentSacco])

  const filteredTx = useMemo(() => {
    return txs.filter((tx) => {
      if (!tx) return false
      const created = tx.created_at ? tx.created_at.slice(0, 10) : ''
      if (created < fromDate || created > toDate) return false
      if (txStatus && (tx.status || '').toUpperCase() !== txStatus) return false
      return true
    })
  }, [txs, fromDate, toDate, txStatus])

  const summary = useMemo(() => {
    const buckets: SummaryBuckets = {
      SACCO_FEE: { today: 0, week: 0, month: 0 },
      SAVINGS: { today: 0, week: 0, month: 0 },
      LOAN_REPAY: { today: 0, week: 0, month: 0 },
    }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const startOfWeek = new Date(today)
    const dow = startOfWeek.getDay() || 7
    startOfWeek.setDate(startOfWeek.getDate() - (dow - 1))
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

    const isSameOrAfter = (d: Date, since: Date) => d.getTime() >= since.getTime()

    filteredTx
      .filter((tx) => (tx.status || '').toUpperCase() === 'SUCCESS')
      .forEach((tx) => {
        const kind = (tx.kind || '').toUpperCase()
        if (!buckets[kind as keyof SummaryBuckets]) return
        const amt = Number(tx.fare_amount_kes || 0)
        const d = tx.created_at ? new Date(tx.created_at) : null
        if (!d) return
        const dMid = new Date(d)
        dMid.setHours(0, 0, 0, 0)
        if (dMid.getTime() === today.getTime()) buckets[kind as keyof SummaryBuckets].today += amt
        if (isSameOrAfter(dMid, startOfWeek)) buckets[kind as keyof SummaryBuckets].week += amt
        if (isSameOrAfter(dMid, startOfMonth)) buckets[kind as keyof SummaryBuckets].month += amt
      })
    return buckets
  }, [filteredTx])

  const txByKind = useMemo(() => {
    const norm = (k?: string) => (k || '').toUpperCase()
    return {
      daily: filteredTx.filter((tx) => norm(tx.kind) === 'SACCO_FEE'),
      savings: filteredTx.filter((tx) => norm(tx.kind) === 'SAVINGS'),
      loans: filteredTx.filter((tx) => norm(tx.kind) === 'LOAN_REPAY'),
    }
  }, [filteredTx])

  const savingsBalances = useMemo(() => {
    const totals = new Map<string, { id: string; member: string; amount: number; count: number }>()
    txByKind.savings
      .filter((tx) => (tx.status || '').toUpperCase() === 'SUCCESS')
      .forEach((tx) => {
        const id = String(tx.matatu_id || '')
        if (!id) return
        const row = totals.get(id) || {
          id,
          member: matatuMap.get(id) || '-',
          amount: 0,
          count: 0,
        }
        row.amount += Number(tx.fare_amount_kes || 0)
        row.count += 1
        totals.set(id, row)
      })
    return Array.from(totals.values()).sort((a, b) => b.amount - a.amount)
  }, [matatuMap, txByKind.savings])

  const staffSummary = useMemo(() => {
    const staffMap = new Map<
      string,
      { name: string; email: string; df: number; sav: number; loan: number; total: number }
    >()
    const breakdown = new Map<
      string,
      { staff: string; plate: string; kind: string; amount: number; count: number }
    >()

    const plateFor = (id?: string) => (id ? matatuMap.get(id) || '' : '')

    filteredTx
      .filter((tx) => (tx.status || '').toUpperCase() === 'SUCCESS')
      .forEach((tx) => {
        const kind = (tx.kind || '').toUpperCase()
        const bucket = kind === 'SACCO_FEE' ? 'df' : kind === 'SAVINGS' ? 'sav' : kind === 'LOAN_REPAY' ? 'loan' : null
        if (!bucket) return
        const amt = Number(tx.fare_amount_kes || 0)
        const key = tx.created_by_email || tx.created_by_name || tx.id || 'n/a'
        const label = tx.created_by_name || tx.created_by_email || 'Unknown'
        const email = tx.created_by_email || ''
        const row = staffMap.get(key) || { name: label, email, df: 0, sav: 0, loan: 0, total: 0 }
        row[bucket as 'df' | 'sav' | 'loan'] += amt
        row.total += amt
        staffMap.set(key, row)

        const bkey = `${key}|${tx.matatu_id || ''}|${kind}`
        const brow = breakdown.get(bkey) || {
          staff: label,
          plate: plateFor(tx.matatu_id),
          kind,
          amount: 0,
          count: 0,
        }
        brow.amount += amt
        brow.count += 1
        breakdown.set(bkey, brow)
      })

    return {
      summaryRows: Array.from(staffMap.values()).sort((a, b) => b.total - a.total),
      breakdownRows: Array.from(breakdown.values()).sort((a, b) => b.amount - a.amount),
    }
  }, [filteredTx, matatuMap])

  async function loadPagedTransactions(opts?: { page?: number; limit?: number; search?: string; kind?: string }) {
    if (!currentSacco) return
    const nextPage = Math.max(1, opts?.page ?? txPage)
    const nextLimit = Math.max(1, opts?.limit ?? txLimit)
    const searchValue = (opts?.search ?? txSearchApplied).trim()
    const kindValue = opts?.kind ?? txKindFilter

    const params = new URLSearchParams()
    params.set('page', String(nextPage))
    params.set('limit', String(nextLimit))
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)
    if (txStatus) params.set('status', txStatus)
    if (kindValue) params.set('kind', kindValue)
    if (searchValue) params.set('search', searchValue)

    setTxLoading(true)
    setTxError(null)
    try {
      const res = await fetchJson<{ items?: Tx[]; total?: number }>(
        `/u/sacco/${currentSacco}/transactions?${params.toString()}`,
      )
      setTxRows(res.items || [])
      setTxTotal(res.total ?? 0)
      setTxPage(nextPage)
      setTxLimit(nextLimit)
    } catch (err) {
      setTxRows([])
      setTxTotal(0)
      setTxError(err instanceof Error ? err.message : 'Failed to load transactions')
    } finally {
      setTxLoading(false)
    }
  }

  function applyTxSearch() {
    const next = txSearch.trim()
    setTxSearchApplied(next)
    if (next === txSearchApplied) {
      void loadPagedTransactions({ page: 1, search: next })
    }
  }

  function clearTxSearch() {
    setTxSearch('')
    setTxSearchApplied('')
    if (!txSearchApplied) {
      void loadPagedTransactions({ page: 1, search: '' })
    }
  }


  async function reloadStaff() {
    if (!currentSacco) return
    setStaffError(null)
    try {
      const stRes = await fetchJson<{ items?: Staff[] }>(`/u/sacco/${currentSacco}/staff`)
      setStaff(stRes.items || [])
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : 'Failed to refresh staff')
    }
  }

  async function loadAccessGrants() {
    if (!currentSacco) return
    setAccessGrantError(null)
    try {
      const items = await fetchAccessGrants({ scope_type: 'OPERATOR', scope_id: currentSacco, all: true })
      setAccessGrants(items)
    } catch (err) {
      setAccessGrantError(err instanceof Error ? err.message : 'Failed to load access grants')
    }
  }

  async function loadMyAccessGrants() {
    try {
      const items = await fetchAccessGrants()
      setMyAccessGrants(items)
    } catch (err) {
      setMyAccessGrants([])
    }
  }

  async function createStaff() {
    if (!currentSacco) return
    if (!staffForm.name.trim()) {
      setStaffMsg('Name required')
      return
    }
    setStaffMsg('Saving...')
    setStaffError(null)
    try {
      const payload = {
        name: staffForm.name.trim(),
        phone: staffForm.phone.trim() || null,
        email: staffForm.email.trim() || null,
        role: staffForm.role,
        password: staffForm.password.trim() || null,
      }
      await fetchJson(`/u/sacco/${currentSacco}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setStaffMsg('Staff saved')
      setStaffForm({ name: '', phone: '', email: '', role: 'SACCO_STAFF', password: '' })
      await reloadStaff()
      await loadAccessGrants()
    } catch (err) {
      setStaffMsg('')
      setStaffError(err instanceof Error ? err.message : 'Failed to save staff')
    }
  }

  function startStaffEdit(row: Staff) {
    const id = row.id || ''
    if (!id) return
    if (staffEditId === id) {
      setStaffEditId('')
      setStaffEditMsg('')
      setStaffEditError(null)
      return
    }
    const role = row.role || 'SACCO_STAFF'
    const normalizedRole = role === 'SACCO' ? 'SACCO_ADMIN' : role
    setStaffEditId(id)
    setStaffEditMsg('')
    setStaffEditError(null)
    setStaffEditForm({
      name: row.name || '',
      phone: row.phone || '',
      email: row.email || '',
      role: normalizedRole,
    })
    const grant = row.user_id ? grantsByUserId.get(row.user_id) : null
    setStaffAccessForm({
      role: grant?.role || 'STAFF',
      can_manage_staff: !!grant?.can_manage_staff,
      can_manage_vehicles: !!grant?.can_manage_vehicles,
      can_manage_vehicle_care: !!grant?.can_manage_vehicle_care,
      can_manage_compliance: !!grant?.can_manage_compliance,
      can_view_analytics: grant?.can_view_analytics !== false,
      is_active: grant?.is_active !== false,
    })
    setAccessGrantMsg('')
    setAccessGrantError(null)
  }

  async function saveStaffEdit() {
    if (!currentSacco || !staffEditId) return
    if (!staffEditForm.name.trim()) {
      setStaffEditMsg('Name required')
      return
    }
    setStaffEditMsg('Saving...')
    setStaffEditError(null)
    try {
      const payload = {
        name: staffEditForm.name.trim(),
        phone: staffEditForm.phone.trim() || null,
        email: staffEditForm.email.trim() || null,
        role: staffEditForm.role || 'SACCO_STAFF',
      }
      await fetchJson(`/u/sacco/${currentSacco}/staff/${encodeURIComponent(staffEditId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setStaffEditMsg('Staff updated')
      await reloadStaff()
      await loadAccessGrants()
    } catch (err) {
      setStaffEditMsg('')
      setStaffEditError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function saveStaffAccess(userId?: string | null) {
    if (!currentSacco) return
    if (!userId) {
      setAccessGrantMsg('Staff login not linked')
      return
    }
    setAccessGrantMsg('Saving access...')
    setAccessGrantError(null)
    try {
      await saveAccessGrant({
        scope_type: 'OPERATOR',
        scope_id: currentSacco,
        user_id: userId,
        role: staffAccessForm.role,
        can_manage_staff: staffAccessForm.can_manage_staff,
        can_manage_vehicles: staffAccessForm.can_manage_vehicles,
        can_manage_vehicle_care: staffAccessForm.can_manage_vehicle_care,
        can_manage_compliance: staffAccessForm.can_manage_compliance,
        can_view_analytics: staffAccessForm.can_view_analytics,
        is_active: staffAccessForm.is_active,
      })
      setAccessGrantMsg('Access updated')
      await loadAccessGrants()
    } catch (err) {
      setAccessGrantMsg('')
      setAccessGrantError(err instanceof Error ? err.message : 'Failed to save access')
    }
  }

  async function deleteStaff(id?: string) {
    if (!currentSacco || !id) return
    if (!confirm('Remove this staff member?')) return
    setStaffError(null)
    try {
      await fetchJson(`/u/sacco/${currentSacco}/staff/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      })
      await reloadStaff()
      await loadAccessGrants()
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : 'Failed to remove staff')
    }
  }

  function exportCsv() {
    const rows = filteredTx.map((tx) => [
      tx.created_at || '',
      tx.kind || '',
      tx.status || '',
      tx.fare_amount_kes ?? '',
      matatuMap.get(tx.matatu_id || '') || '',
      tx.created_by_name || '',
      tx.created_by_email || '',
    ])
    const headers = ['created_at', 'kind', 'status', 'amount', memberIdLabel, 'staff_name', 'staff_email']
    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'operator-transactions.csv'
    a.click()
  }

  async function loadLoanRequests() {
    if (!currentSacco) return
    setLoanReqMsg('Loading...')
    try {
      const res = await fetchJson<{ items?: LoanRequest[] }>(
        `/u/sacco/${currentSacco}/loan-requests?status=PENDING`,
      )
      setLoanRequests(res.items || [])
      setLoanReqMsg('')
    } catch (err) {
      setLoanRequests([])
      setLoanReqMsg(err instanceof Error ? err.message : 'Load failed')
    }
  }

  async function loadLoanDisbursements() {
    if (!currentSacco) return
    setLoanDisbMsg('Loading...')
    try {
      const res = await fetchJson<{ items?: LoanRequest[] }>(
        `/u/sacco/${currentSacco}/loan-requests?status=APPROVED`,
      )
      const items = (res.items || []).filter((r) => !(r as any).disbursed_at)
      setLoanDisb(items)
      setLoanDisbMsg('')
    } catch (err) {
      setLoanDisb([])
      setLoanDisbMsg(err instanceof Error ? err.message : 'Load failed')
    }
  }

  async function loadLoanApprovalsHistory() {
    if (!currentSacco) return
    setLoanApprovalsMsg('Loading...')
    try {
      const params = new URLSearchParams()
      if (loanApprovalsStatus) params.set('status', loanApprovalsStatus)
      const query = params.toString()
      const res = await fetchJson<{ items?: LoanRequest[] }>(
        `/u/sacco/${currentSacco}/loan-requests${query ? `?${query}` : ''}`,
      )
      setLoanApprovals(res.items || [])
      setLoanApprovalsMsg('')
    } catch (err) {
      setLoanApprovals([])
      setLoanApprovalsMsg(err instanceof Error ? err.message : 'Load failed')
    }
  }

  async function loadLoanDue() {
    if (!currentSacco) return
    setLoanDueMsg('Loading...')
    try {
      const res = await fetchJson<{ items?: LoanDue[] }>(`/u/sacco/${currentSacco}/loans/due-today`)
      setLoanDue(res.items || [])
      setLoanDueMsg('')
    } catch (err) {
      setLoanDue([])
      setLoanDueMsg(err instanceof Error ? err.message : 'Load failed')
    }
  }

  async function handleLoanRequest(id: string, action: 'APPROVE' | 'REJECT') {
    if (!currentSacco) return
    const payload: Record<string, string> = { action }
    if (action === 'REJECT') {
      const reason = prompt('Optional reason for rejection (shown to owner):', '')
      if (reason && reason.trim()) payload.rejection_reason = reason.trim()
    }
    try {
      await authFetch(`/u/sacco/${currentSacco}/loan-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      await Promise.all([
        loadLoanRequests(),
        loadLoanDisbursements(),
        loadLoanApprovalsHistory(),
        loadLoans(),
        loadLoanDue(),
      ])
    } catch (err) {
      setLoanReqMsg(err instanceof Error ? err.message : 'Action failed')
    }
  }

  async function handleDisburse(req: LoanRequest) {
    if (!currentSacco || !req.id) return
    const method = (req.payout_method || 'CASH').toUpperCase()
    setLoanDisbMsg('Disbursing...')
    try {
      const body: Record<string, string> = { method }
      if (method === 'M_PESA' && req.payout_phone) body.phone = req.payout_phone
      if (method === 'ACCOUNT' && req.payout_account) body.account = req.payout_account
      await authFetch(`/u/sacco/${currentSacco}/loan-requests/${req.id}/disburse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
      setLoanDisbMsg('Marked disbursed')
      await Promise.all([loadLoanDisbursements(), loadLoanApprovalsHistory()])
    } catch (err) {
      setLoanDisbMsg(err instanceof Error ? err.message : 'Disburse failed')
    }
  }

  async function loadDailyFeeRates() {
    if (!currentSacco) return
    setFeeMsg('Loading rates...')
    try {
      const res = await fetchJson<{ items?: DailyFeeRate[] }>(
        `/u/sacco/${currentSacco}/daily-fee-rates`,
      )
      setFeeRates(res.items || [])
      setFeeMsg('')
    } catch (err) {
      setFeeRates([])
      setFeeMsg(err instanceof Error ? err.message : 'Load failed')
    }
  }

  async function saveDailyFeeRate() {
    if (!currentSacco) return
    if (!feeForm.vehicle_type) {
      setFeeMsg('Vehicle type required')
      return
    }
    if (!feeForm.amount || Number(feeForm.amount) <= 0) {
      setFeeMsg('Enter a positive amount')
      return
    }
    setFeeMsg('Saving...')
    try {
      await authFetch(`/u/sacco/${currentSacco}/daily-fee-rates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ vehicle_type: feeForm.vehicle_type, daily_fee_kes: Number(feeForm.amount) }),
      })
      setFeeMsg('Saved')
      setFeeForm({ vehicle_type: '', amount: '' })
      await loadDailyFeeRates()
    } catch (err) {
      setFeeMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function loadRoutes() {
    if (!currentSacco) return
    setRoutesMsg('Loading...')
    try {
      const res = await fetchJson<{ items?: SaccoRoute[] }>(`/u/sacco/${currentSacco}/routes`)
      const items = res.items || []
      setRoutes(items)
      if (items.length) {
        const firstId = items[0].id || ''
        setRouteViewId((prev) => (prev && items.some((r) => r.id === prev) ? prev : firstId))
      } else {
        setRouteViewId('')
      }
      setRoutesMsg('')
    } catch (err) {
      setRoutes([])
      setRoutesMsg(err instanceof Error ? err.message : 'Load failed')
    }
  }

  async function loadRouteLive() {
    if (!currentSacco || !routeViewId) return
    setRouteLiveMsg('Loading...')
    try {
      const res = await fetchJson<{ items?: LivePosition[] }>(
        `/u/sacco/${currentSacco}/live-positions?route_id=${encodeURIComponent(routeViewId)}&window_min=60`,
      )
      setRouteLive(res.items || [])
      setRouteLiveMsg('')
    } catch (err) {
      setRouteLive([])
      setRouteLiveMsg(err instanceof Error ? err.message : 'Failed to load live positions')
    }
  }

  async function ensureLeaflet() {
    const w = window as typeof window & { L?: any }
    if (w.L) return w.L
    if (!leafletLoader.current) {
      leafletLoader.current = new Promise((resolve, reject) => {
        if (!document.querySelector('link[data-leaflet]')) {
          const link = document.createElement('link')
          link.setAttribute('data-leaflet', '1')
          link.rel = 'stylesheet'
          link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
          document.head.appendChild(link)
        }
        const existing = document.querySelector('script[data-leaflet]')
        if (existing) {
          existing.addEventListener('load', () => resolve(w.L))
          existing.addEventListener('error', () => reject(new Error('Leaflet failed to load')))
          return
        }
        const script = document.createElement('script')
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
        script.async = true
        script.setAttribute('data-leaflet', '1')
        script.onload = () => resolve(w.L)
        script.onerror = () => reject(new Error('Leaflet failed to load'))
        document.body.appendChild(script)
      })
    }
    return leafletLoader.current
  }

  function syncRouteMap() {
    const w = window as typeof window & { L?: any }
    const L = w.L
    if (!L || !mapInstance.current) return
    const map = mapInstance.current
    if (mapLayers.current.polyline) {
      map.removeLayer(mapLayers.current.polyline)
    }
    if (mapLayers.current.routeMarkers) {
      mapLayers.current.routeMarkers.forEach((m: any) => map.removeLayer(m))
    }
    if (mapLayers.current.liveMarkers) {
      mapLayers.current.liveMarkers.forEach((m: any) => map.removeLayer(m))
    }
    mapLayers.current.polyline = null
    mapLayers.current.routeMarkers = []
    mapLayers.current.liveMarkers = []

    const livePoints: Array<[number, number]> = []
    routeLive.forEach((row) => {
      const lat = Number(row.lat)
      const lng = Number(row.lng)
      if (Number.isFinite(lat) && Number.isFinite(lng)) livePoints.push([lat, lng])
    })

    if (routePoints.length) {
      mapLayers.current.polyline = L.polyline(routePoints, { color: '#2563eb', weight: 4 }).addTo(map)
      mapLayers.current.routeMarkers = routePoints.map((pt) =>
        L.circleMarker(pt, { radius: 4, color: '#0ea5e9', fillColor: '#0ea5e9', fillOpacity: 0.9 }).addTo(map),
      )
    }

    if (livePoints.length) {
      mapLayers.current.liveMarkers = livePoints.map((pt) =>
        L.circleMarker(pt, { radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9 }).addTo(map),
      )
    }

    const boundsPoints = [...routePoints, ...livePoints]
    if (boundsPoints.length) {
      const bounds = L.latLngBounds(boundsPoints)
      map.fitBounds(bounds, { padding: [20, 20] })
    }
  }

  async function loadLoans() {
    if (!currentSacco) return
    setLoanMsg('Loading loans...')
    try {
      const res = await fetchJson<{ items?: Loan[] }>(`/u/sacco/${currentSacco}/loans`)
      setLoans(res.items || [])
      setLoanMsg('')
    } catch (err) {
      setLoans([])
      setLoanMsg(err instanceof Error ? err.message : 'Load failed')
    }
  }

  async function createLoan() {
    if (!currentSacco) return
    if (!loanForm.borrower_name.trim()) {
      setLoanMsg('Borrower required')
      return
    }
    if (!loanForm.principal || Number(loanForm.principal) <= 0) {
      setLoanMsg('Principal must be > 0')
      return
    }
    if (!loanForm.rate || Number(loanForm.rate) < 0) {
      setLoanMsg('Rate must be >= 0')
      return
    }
    if (!loanForm.term || Number(loanForm.term) <= 0) {
      setLoanMsg('Term months required')
      return
    }
    setLoanMsg('Saving...')
    try {
      await authFetch(`/u/sacco/${currentSacco}/loans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          matatu_id: loanForm.matatu_id || null,
          borrower_name: loanForm.borrower_name.trim(),
          principal_kes: Number(loanForm.principal),
          interest_rate_pct: Number(loanForm.rate),
          term_months: Number(loanForm.term),
          status: loanForm.status || 'ACTIVE',
        }),
      })
      setLoanMsg('Loan created')
      setLoanForm({ matatu_id: '', borrower_name: '', principal: '', rate: '', term: '3', status: 'ACTIVE' })
      await loadLoans()
      await loadLoanDue()
    } catch (err) {
      setLoanMsg(err instanceof Error ? err.message : 'Create failed')
    }
  }

  async function viewLoanHistory(id: string | undefined) {
    if (!currentSacco || !id) return
    setLoanHistory((prev) => ({ ...prev, msg: 'Loading history...', items: [], loanId: id }))
    try {
      const res = await fetchJson<{ items?: Tx[]; total?: number }>(
        `/u/sacco/${currentSacco}/loans/${id}/payments`,
      )
      setLoanHistory({ loanId: id, items: res.items || [], total: res.total || 0, msg: '' })
    } catch (err) {
      setLoanHistory({ loanId: id, items: [], total: 0, msg: err instanceof Error ? err.message : 'Load failed' })
    }
  }

  async function updateLoanStatus(id: string | undefined, status: string) {
    if (!currentSacco || !id) return
    setLoanMsg('Updating loan...')
    try {
      await authFetch(`/u/sacco/${currentSacco}/loans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ status }),
      })
      await loadLoans()
      await loadLoanDue()
      setLoanMsg('Updated')
    } catch (err) {
      setLoanMsg(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function deleteLoan(id: string | undefined) {
    if (!currentSacco || !id) return
    setLoanMsg('Deleting...')
    try {
      await authFetch(`/u/sacco/${currentSacco}/loans/${id}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      })
      await loadLoans()
      await loadLoanDue()
      setLoanMsg('Deleted')
    } catch (err) {
      setLoanMsg(err instanceof Error ? err.message : 'Delete failed')
    }
  }


  async function loadNotifications() {
    if (!currentSacco) return
    const prevRead = new Map<string, boolean>()
    notifications.forEach((n) => {
      prevRead.set(`${n.severity}:${n.message}`, Boolean(n.is_read))
    })
    const items: NotificationItem[] = []
    const memberLabelLower = memberLabel.toLowerCase()
    try {
      const res = await fetchJson<{ items?: LoanRequest[] }>(
        `/u/sacco/${currentSacco}/loan-requests?status=PENDING`,
      )
      const pending = (res.items || []).length
      if (pending > 0) {
        items.push({
          id: `loan-requests-${pending}`,
          message: `${pending} pending loan request${pending > 1 ? 's' : ''}`,
          severity: 'WARN',
          is_read: prevRead.get(`WARN:${pending} pending loan request${pending > 1 ? 's' : ''}`) || false,
        })
      }
    } catch {}
    try {
      const loans = await fetchJson<{ items?: any[]; data?: any[] }>('/u/transactions?kind=loans')
      const rows = (loans.items || loans.data || []) as any[]
      const todayISO = new Date().toISOString().slice(0, 10)
      const count = rows.filter((r) => String(r.created_at || '').slice(0, 10) === todayISO).length
      if (count > 0) {
        items.push({
          id: `loan-repay-${count}`,
          message: `${count} loan repayment${count > 1 ? 's' : ''} recorded today`,
          severity: 'INFO',
          is_read: prevRead.get(`INFO:${count} loan repayment${count > 1 ? 's' : ''} recorded today`) || false,
        })
      }
    } catch {}
    try {
      if (matatuMap.size) {
        const y = new Date()
        y.setDate(y.getDate() - 1)
        const yISO = y.toISOString().slice(0, 10)
        const tx = await fetchJson<{ items?: any[] }>(
          `/u/sacco/${currentSacco}/transactions?limit=2000`,
        )
        const items = tx.items || []
        const paid = new Set(
          items
            .filter(
              (t) =>
                String(t.kind || '').toUpperCase() === 'SACCO_FEE' &&
                String(t.created_at || '').slice(0, 10) === yISO,
            )
            .map((t) => String(t.matatu_id || '')),
        )
        const unpaid = Array.from(matatuMap.keys()).map(String).filter((id) => id && !paid.has(id))
        if (unpaid.length) {
          const message = `${feeLabel} missing yesterday for ${unpaid.length} ${memberLabelLower}`
          items.push({
            id: `missing-fee-${unpaid.length}`,
            message,
            severity: 'CRITICAL',
            is_read: prevRead.get(`CRITICAL:${message}`) || false,
          })
        }
      }
    } catch {}
    setNotifications(items)
  }

  function toggleNotificationRead(id: string | undefined) {
    if (!id) return
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: !n.is_read } : n)),
    )
  }

  async function loadPayoutDestinations() {
    if (!currentSacco) {
      debugAuth('payout_dest_blocked_no_sacco')
      return
    }
    setPayoutDestError(null)
    try {
      const res = await authFetch('/api/sacco/payout-destinations')
      if (!res.ok) {
        let msg = 'Failed to load payout destinations'
        try {
          const body = await res.json()
          if (res.status === 403 && body?.code === 'SACCO_ACCESS_DENIED') {
            msg = 'Your account is not authorized to manage SACCO payouts.'
          }
        } catch {
          const text = await res.text()
          msg = text || msg
        }
        setPayoutDestError(msg)
        return
      }
      const data = await res.json()
      const items = data.destinations || []
      setPayoutDestinations(items)
      setPayoutDestError(null)
      if (items.length) {
        setPayoutBatchForm((prev) => {
          const next = { ...prev.destination_by_kind }
          ;(['SACCO_FEE', 'SACCO_LOAN', 'SACCO_SAVINGS'] as const).forEach((kind) => {
            if (!next[kind]) next[kind] = items[0].id || ''
          })
          return { ...prev, destination_by_kind: next }
        })
      }
    } catch (err) {
      setPayoutDestinations([])
      setPayoutDestError(err instanceof Error ? err.message : 'Failed to load payout destinations')
    }
  }

  async function loadPayoutReadiness(dateFrom?: string, dateTo?: string) {
    const from = dateFrom || payoutBatchForm.date_from
    const to = dateTo || payoutBatchForm.date_to
    setPayoutReadinessMsg('Checking readiness...')
    setPayoutReadinessError(null)
    try {
      const res = await fetchJson<SaccoPayoutReadiness>(
        `/api/sacco/payout-readiness?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}`,
      )
      setPayoutReadiness(res || null)
      setPayoutReadinessMsg('Ready')
    } catch (err) {
      setPayoutReadiness(null)
      setPayoutReadinessError(err instanceof Error ? err.message : 'Failed to load readiness')
      setPayoutReadinessMsg('')
    }
  }

  async function savePayoutDestination() {
    if (!payoutDestForm.destination_ref.trim()) {
      setPayoutDestMsg('Destination reference required')
      return
    }
    setPayoutDestMsg('Saving...')
    try {
      await fetchJson<{ destination?: PayoutDestination }>('/api/sacco/payout-destinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          destination_type: payoutDestForm.destination_type,
          destination_ref: payoutDestForm.destination_ref,
          destination_name: payoutDestForm.destination_name,
        }),
      })
      setPayoutDestMsg('Saved')
      setPayoutDestForm({ destination_type: 'MSISDN', destination_ref: '', destination_name: '' })
      await loadPayoutDestinations()
    } catch (err) {
      setPayoutDestMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function loadPayoutBatches() {
    if (!currentSacco) {
      debugAuth('payout_batches_blocked_no_sacco')
      return
    }
    setPayoutBatchError(null)
    try {
      const res = await authFetch(
        `/api/sacco/payout-batches?from=${encodeURIComponent(payoutFrom)}&to=${encodeURIComponent(payoutTo)}`,
      )
      if (!res.ok) {
        let msg = 'Failed to load payout batches'
        try {
          const body = await res.json()
          if (res.status === 403 && body?.code === 'SACCO_ACCESS_DENIED') {
            msg = 'Your account is not authorized to manage SACCO payouts.'
          }
        } catch {
          const text = await res.text()
          msg = text || msg
        }
        setPayoutBatchError(msg)
        return
      }
      const data = await res.json()
      setPayoutBatches(data.batches || [])
      setPayoutBatchError(null)
    } catch (err) {
      setPayoutBatches([])
      setPayoutBatchError(err instanceof Error ? err.message : 'Failed to load payout batches')
    }
  }

  async function loadPayoutBatchDetail(batchId: string) {
    if (!batchId) return
    setSelectedPayoutBatchId(batchId)
    setPayoutBatchMsg('Loading batch...')
    try {
      const res = await fetchJson<{ batch?: PayoutBatch; items?: PayoutItem[]; events?: PayoutEvent[] }>(
        `/api/sacco/payout-batches/${encodeURIComponent(batchId)}`,
      )
      setPayoutBatchDetail(res.batch || null)
      setPayoutItems(res.items || [])
      setPayoutEvents(res.events || [])
      setPayoutBatchMsg('')
      await loadPayoutBatchReadiness(batchId)
      if (res.batch?.status === 'DRAFT') {
        const draftItems = (res.items || []).map((item) => {
          const destId =
            payoutDestinations.find(
              (d) =>
                d.destination_type === item.destination_type &&
                d.destination_ref === item.destination_ref,
            )?.id || ''
          return {
            id: item.id,
            wallet_kind: item.wallet_kind,
            amount: item.amount !== undefined ? String(item.amount) : '',
            destination_id: destId,
          }
        })
        setPayoutDraftItems(draftItems)
      } else {
        setPayoutDraftItems([])
      }
    } catch (err) {
      setPayoutBatchMsg(err instanceof Error ? err.message : 'Failed to load batch')
    }
  }

  async function loadPayoutBatchReadiness(batchId: string) {
    if (!batchId) return
    try {
      const res = await fetchJson<BatchReadiness>(`/api/payout-batches/${encodeURIComponent(batchId)}/readiness`)
      setPayoutBatchReadiness(res || null)
    } catch (err) {
      setPayoutBatchReadiness(null)
      setPayoutBatchMsg(err instanceof Error ? err.message : 'Failed to load batch readiness')
    }
  }

  async function createPayoutBatch() {
    const includeKinds = Object.entries(payoutBatchForm.include_wallet_kinds)
      .filter(([, enabled]) => enabled)
      .map(([kind]) => kind)
    if (!includeKinds.length) {
      setPayoutBatchMsg('Select at least one wallet kind')
      return
    }
    const destByKind: Record<string, string> = {}
    for (const kind of includeKinds) {
      const dest =
        payoutBatchForm.destination_by_kind[
          kind as 'SACCO_FEE' | 'SACCO_LOAN' | 'SACCO_SAVINGS'
        ]
      if (!dest) {
        setPayoutBatchMsg('Select destinations for all chosen kinds')
        return
      }
      destByKind[kind] = dest
    }
    for (const kind of includeKinds) {
      const err = payoutAmountErrors.get(kind)
      if (err) {
        setPayoutBatchMsg(err)
        return
      }
    }
    const items = includeKinds.map((kind) => ({
      wallet_kind: kind,
      destination_id: destByKind[kind],
      amount: Number(payoutAmountByKind[kind] || 0),
    }))

    setPayoutBatchMsg('Creating batch...')
    try {
      const res = await fetchJson<{ batch_id?: string }>('/api/sacco/payout-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          date_from: payoutBatchForm.date_from,
          date_to: payoutBatchForm.date_to,
          items,
        }),
      })
      setPayoutBatchMsg('Batch created')
      await loadPayoutBatches()
      if (res.batch_id) {
        await loadPayoutBatchDetail(res.batch_id)
      }
    } catch (err) {
      setPayoutBatchMsg(err instanceof Error ? err.message : 'Batch creation failed')
    }
  }

  async function submitPayoutBatch(batchId: string) {
    if (!batchId) return
    setPayoutBatchMsg('Submitting batch...')
    try {
      await fetchJson(`/api/sacco/payout-batches/${encodeURIComponent(batchId)}/submit`, { method: 'POST' })
      setPayoutBatchMsg('Batch submitted')
      await loadPayoutBatches()
      await loadPayoutBatchDetail(batchId)
    } catch (err) {
      setPayoutBatchMsg(err instanceof Error ? err.message : 'Submit failed')
    }
  }

  async function sendStk() {
    setStkResp('Sending...')
    try {
      const plate = stkForm.code.trim().toUpperCase().replace(/\s+/g, '')
      const res = await fetch('/api/pay/stk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: plate,
          amount: Number(stkForm.amount || 0),
          phone: stkForm.phone.trim(),
        }),
      })
      const text = await res.text()
      setStkResp(text)
    } catch (err) {
      setStkResp(err instanceof Error ? err.message : 'STK failed')
    }
  }

  async function copyPayoutValue(value: string, label: string) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setPayoutBatchMsg(label)
    } catch (err) {
      setPayoutBatchMsg(err instanceof Error ? err.message : 'Copy failed')
    }
  }

  function updateDraftItem(id: string | undefined, field: 'amount' | 'destination_id') {
    return (value: string) => {
      setPayoutDraftItems((prev) =>
        prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
      )
    }
  }

  function removeDraftItem(id: string | undefined) {
    setPayoutDraftItems((prev) => prev.filter((row) => row.id !== id))
  }

  async function saveDraftBatch() {
    if (!payoutBatchDetail?.id) return
    if (!payoutDraftItems.length) {
      setPayoutBatchMsg('Add at least one item')
      return
    }
    setPayoutBatchMsg('Saving draft...')
    try {
      await fetchJson(`/api/sacco/payout-batches/${encodeURIComponent(payoutBatchDetail.id)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: payoutDraftItems.map((row) => ({
            wallet_kind: row.wallet_kind,
            amount: Number(row.amount || 0),
            destination_id: row.destination_id || null,
          })),
        }),
      })
      setPayoutBatchMsg('Draft saved')
      await loadPayoutBatches()
      await loadPayoutBatchDetail(payoutBatchDetail.id)
    } catch (err) {
      setPayoutBatchMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function discardDraftBatch() {
    if (!payoutBatchDetail?.id) return
    setPayoutBatchMsg('Discarding draft...')
    try {
      await fetchJson(`/api/sacco/payout-batches/${encodeURIComponent(payoutBatchDetail.id)}`, {
        method: 'DELETE',
      })
      setPayoutBatchMsg('Draft discarded')
      setPayoutBatchDetail(null)
      setPayoutItems([])
      setPayoutEvents([])
      await loadPayoutBatches()
    } catch (err) {
      setPayoutBatchMsg(err instanceof Error ? err.message : 'Discard failed')
    }
  }

  function formatLedgerSource(row: LedgerRow) {
    const entry = String(row.entry_type || '').toUpperCase()
    if (entry === 'C2B_CREDIT') return 'PayBill'
    if (entry === 'STK_CREDIT') return 'STK'
    if (entry === 'PAYOUT_DEBIT') return 'Payout'
    if (entry === 'REVERSAL') return 'Reversal'
    return row.reference_type || entry || '-'
  }

  async function loadLedger(kind?: string) {
    if (!currentSacco) {
      setLedgerError('Choose a SACCO to load ledger')
      debugAuth('ledger_blocked_no_sacco')
      return
    }
    setLedgerLoading(true)
    setLedgerError(null)
    try {
      const params = new URLSearchParams()
      params.set('limit', '200')
      params.set('sacco_id', currentSacco)
      if (ledgerFrom) params.set('from', ledgerFrom)
      if (ledgerTo) params.set('to', ledgerTo)
      if (kind) params.set('wallet_kind', kind)
      const res = await authFetch(`/api/sacco/wallet-ledger?${params.toString()}`)
      if (!res.ok) {
        let msg = 'Failed to load wallet ledger'
        try {
          const body = await res.json()
          if (res.status === 403 && body?.code === 'SACCO_ACCESS_DENIED') {
            msg = 'Your account is not authorized to view this SACCO ledger.'
          } else if (body?.error) {
            msg = body.error
          }
        } catch {
          const text = await res.text()
          msg = text || msg
        }
        setLedgerError(msg)
        return
      }
      const payload = await res.json()
      const wallets = (payload.wallets || []) as LedgerWallet[]
      setLedgerData((prev) => {
        const next = { ...prev }
        wallets.forEach((w) => {
          if (!w.wallet_kind) return
          next[w.wallet_kind] = w
        })
        return next
      })
    } catch (err) {
      setLedgerError(err instanceof Error ? err.message : 'Failed to load wallet ledger')
    } finally {
      setLedgerLoading(false)
    }
  }

  function exportLedgerCsv(kind: string) {
    const entry = ledgerData[kind]
    if (!entry || !entry.items || !entry.items.length) return
    const header = [
      'created_at',
      'direction',
      'entry_type',
      'reference_type',
      'reference_id',
      'amount',
      'balance_after',
      'description',
    ]
    const rows = entry.items.map((row) =>
      [
        row.created_at,
        row.direction,
        row.entry_type,
        row.reference_type,
        row.reference_id,
        row.amount,
        row.balance_after,
        (row.description || '').replace(/,/g, ';'),
      ]
        .map((v) => `"${String(v ?? '')}"`)
        .join(','),
    )
    const csv = [header.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${kind || 'ledger'}-${ledgerFrom || 'from'}-${ledgerTo || 'to'}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function renderStkSection(title: string, helperText?: string) {
    return (
      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" className="btn ghost" onClick={sendStk}>
            Send
          </button>
        </div>
        {helperText ? (
          <div className="muted small" style={{ marginBottom: 8 }}>
            {helperText}
          </div>
        ) : null}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <input
            placeholder="Plate e.g. KDE123A"
            value={stkForm.code}
            onChange={(e) => setStkForm((f) => ({ ...f, code: e.target.value }))}
            style={{ flex: '1 1 160px' }}
          />
          <input
            type="number"
            placeholder="Amount"
            value={stkForm.amount}
            onChange={(e) => setStkForm((f) => ({ ...f, amount: e.target.value }))}
            style={{ width: 140 }}
          />
          <input
            placeholder="07XXXXXXXX"
            value={stkForm.phone}
            onChange={(e) => setStkForm((f) => ({ ...f, phone: e.target.value }))}
            style={{ width: 180 }}
          />
        </div>
        <pre className="mono" style={{ background: '#f8fafc', padding: 12 }}>
          {stkResp || '{}'}
        </pre>
      </section>
    )
  }

  return (
    <DashboardShell title={dashboardTitle} subtitle={dashboardSubtitle} hideNav>
      {showFilters ? (
        <section className="card">
          <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
            <label>
              <div className="muted small">Operate Under</div>
              <select
                value={currentSacco || ''}
                onChange={(e) => {
                  const id = e.target.value || null
                  const name = saccos.find((s) => s.sacco_id === id)?.name || null
                  setActiveSacco(id, name)
                }}
                style={{ padding: 10, minWidth: 200 }}
              >
                <option value="">- choose -</option>
                {saccos.map((s) => (
                  <option key={s.sacco_id} value={s.sacco_id}>
                    {s.name || s.sacco_id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div className="muted small">From</div>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </label>
            <label>
              <div className="muted small">To</div>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </label>
            <label>
              <div className="muted small">Status</div>
              <select value={txStatus} onChange={(e) => setTxStatus(e.target.value)} style={{ padding: 10 }}>
                <option value="">Any</option>
                <option value="SUCCESS">Success</option>
                <option value="PENDING">Pending</option>
                <option value="FAILED">Failed</option>
              </select>
            </label>
            <button type="button" className="btn ghost" onClick={exportCsv} disabled={!filteredTx.length}>
              Export CSV
            </button>
            <span className="muted small">{statusMsg}</span>
            {loading ? <span className="muted small">Loading...</span> : null}
            {error ? <span className="err">{error}</span> : null}
          </div>
        </section>
      ) : null}

      <nav className="sys-nav" aria-label="Operator admin sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`sys-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {notifications.length ? (
        <section className="card" style={{ background: '#f8fafc' }}>
          <div className="topline" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Notifications</h3>
              <span className="badge-ghost">Unread: {unreadNotificationCount}</span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn ghost" onClick={loadNotifications}>
                Refresh
              </button>
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn ghost${notificationFilter === 'ALL' ? ' active' : ''}`}
                onClick={() => setNotificationFilter('ALL')}
              >
                All
              </button>
              <button
                type="button"
                className={`btn ghost${notificationFilter === 'WARN' ? ' active' : ''}`}
                onClick={() => setNotificationFilter('WARN')}
              >
                Warnings
              </button>
              <button
                type="button"
                className={`btn ghost${notificationFilter === 'CRITICAL' ? ' active' : ''}`}
                onClick={() => setNotificationFilter('CRITICAL')}
              >
                Critical
              </button>
            </div>
            <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Search
              <input
                className="input"
                placeholder="Title or message"
                value={notificationSearch}
                onChange={(e) => setNotificationSearch(e.target.value)}
                style={{ minWidth: 200 }}
              />
            </label>
            <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={notificationUnreadOnly}
                onChange={(e) => setNotificationUnreadOnly(e.target.checked)}
              />
              Unread only
            </label>
          </div>
          <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
            {filteredNotifications.length === 0 ? (
              <li className="muted small" style={{ listStyle: 'none', marginTop: 4 }}>
                No notifications match filters.
              </li>
            ) : (
              filteredNotifications.map((n) => {
                const pillColor =
                  n.severity === 'CRITICAL' ? '#fee2e2' : n.severity === 'WARN' ? '#fef9c3' : '#e0f2fe'
                const pillBorder =
                  n.severity === 'CRITICAL' ? '#ef4444' : n.severity === 'WARN' ? '#f59e0b' : '#0284c7'
                return (
                  <li
                    key={n.id}
                    className="row"
                    style={{
                      margin: '6px 0',
                      alignItems: 'center',
                      gap: 8,
                      opacity: n.is_read ? 0.7 : 1,
                      listStyle: 'none',
                    }}
                  >
                    <span
                      className="badge-ghost mono"
                      style={{
                        background: pillColor,
                        border: `1px solid ${pillBorder}`,
                        color: '#0f172a',
                      }}
                    >
                      {n.severity}
                    </span>
                    <span>{n.message}</span>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => toggleNotificationRead(n.id)}
                      style={{ marginLeft: 'auto' }}
                    >
                      {n.is_read ? 'Mark unread' : 'Mark read'}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </section>
      ) : null}

      {activeTab === 'overview' ? (
        <>
          <section className="card">
            <PaybillHeader
              title="SACCO PayBill Accounts (4814003)"
              actions={
                <button className="btn ghost" type="button" onClick={() => setShowPaybillSticker(true)}>
                  Print Sticker
                </button>
              }
            />
            {paybillError ? <div className="err">PayBill load error: {paybillError}</div> : null}
            <div
              className="grid"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}
            >
              <PaybillCodeCard
                title="Daily Fee Collection Account"
                label="SACCO FEE Account"
                code={paybillCodes.fee || ''}
              />
              <PaybillCodeCard
                title="Loan Repayment Account"
                label="SACCO LOAN Account"
                code={paybillCodes.loan || ''}
              />
              <PaybillCodeCard
                title="Savings Deposit Account"
                label="SACCO SAVINGS Account"
                code={paybillCodes.savings || ''}
              />
            </div>
          </section>

          <section className="card">
            <div className="topline" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h3 style={{ margin: 0 }}>Wallet statements</h3>
                <div className="muted small">Audit trail for SACCO fee, loan, and savings wallets</div>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="muted small">
                  From
                  <input type="date" value={ledgerFrom} onChange={(e) => setLedgerFrom(e.target.value)} />
                </label>
                <label className="muted small">
                  To
                  <input type="date" value={ledgerTo} onChange={(e) => setLedgerTo(e.target.value)} />
                </label>
                <button className="btn" type="button" onClick={() => loadLedger()}>
                  Refresh
                </button>
                {ledgerLoading ? <span className="muted small">Loading...</span> : null}
                {ledgerError ? <span className="err">{ledgerError}</span> : null}
              </div>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
              {SACCO_LEDGER_KINDS.map((kind) => {
                const entry = ledgerData[kind] || {}
                return (
                  <div key={kind} className="table-wrap" style={{ border: '1px solid #e2e8f0', borderRadius: 8 }}>
                    <div className="topline" style={{ padding: '8px 12px' }}>
                      <div>
                        <div className="muted small">{formatPayoutKind(kind, feeLabel)}</div>
                        <strong>{fmtKES(entry.balance || 0)}</strong>
                        <div className="muted small">Account: {entry.virtual_account_code || '-'}</div>
                      </div>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn ghost" type="button" onClick={() => exportLedgerCsv(kind)}>
                          Export CSV
                        </button>
                        <span className="muted small">Entries: {entry.total || 0}</span>
                      </div>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Source</th>
                          <th>Amount</th>
                          <th>Balance</th>
                          <th>Reference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!entry.items?.length ? (
                          <tr>
                            <td colSpan={6} className="muted">
                              No ledger entries.
                            </td>
                          </tr>
                        ) : (
                          (entry.items || []).map((row) => (
                            <tr key={row.id}>
                              <td className="muted small">{row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</td>
                              <td>{row.direction}</td>
                              <td>{formatLedgerSource(row)}</td>
                              <td style={{ color: row.direction === 'CREDIT' ? '#15803d' : '#b91c1c' }}>
                                {fmtKES(row.amount)}
                              </td>
                              <td>{fmtKES(row.balance_after)}</td>
                              <td className="mono">{row.reference_id || '-'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>Performance summary</h3>
            <div className="grid metrics">
              <div className="metric">
                <div className="k">{feeLabel} (today / week / month)</div>
                <div className="v">
                  {fmtKES(summary.SACCO_FEE.today)} / {fmtKES(summary.SACCO_FEE.week)} /{' '}
                  {fmtKES(summary.SACCO_FEE.month)}
                </div>
              </div>
              <div className="metric">
                <div className="k">Savings (today / week / month)</div>
                <div className="v">
                  {fmtKES(summary.SAVINGS.today)} / {fmtKES(summary.SAVINGS.week)} / {fmtKES(summary.SAVINGS.month)}
                </div>
              </div>
              <div className="metric">
                <div className="k">Loan Repay (today / week / month)</div>
                <div className="v">
                  {fmtKES(summary.LOAN_REPAY.today)} / {fmtKES(summary.LOAN_REPAY.week)} /{' '}
                  {fmtKES(summary.LOAN_REPAY.month)}
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Recent transactions</h3>
              <span className="muted small">
                {txTotal ? `Showing ${txRangeStart}-${txRangeEnd} of ${txTotal}` : '0 rows'}
              </span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <input
                className="input"
                placeholder={`Search ${memberIdLabel.toLowerCase()}, staff, phone, status, notes`}
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    applyTxSearch()
                  }
                }}
                style={{ maxWidth: 260 }}
              />
              <label className="muted small">
                Kind:{' '}
                <select
                  value={txKindFilter}
                  onChange={(e) => setTxKindFilter(e.target.value)}
                  style={{ padding: 10 }}
                >
                  <option value="">All</option>
                  <option value="SACCO_FEE">{feeLabel}</option>
                  <option value="SAVINGS">Savings</option>
                  <option value="LOAN_REPAY">Loan Repay</option>
                </select>
              </label>
              <button className="btn ghost" type="button" onClick={applyTxSearch}>
                Apply
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={clearTxSearch}
                disabled={!txSearch && !txSearchApplied}
              >
                Clear
              </button>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn ghost"
                type="button"
                onClick={() => loadPagedTransactions({ page: Math.max(1, txPage - 1) })}
                disabled={txPage <= 1 || txLoading}
              >
                Prev
              </button>
              <span className="muted small">
                Page {txPage} of {txPageCount}
              </span>
              <button
                className="btn ghost"
                type="button"
                onClick={() => loadPagedTransactions({ page: Math.min(txPageCount, txPage + 1) })}
                disabled={txPage >= txPageCount || txLoading}
              >
                Next
              </button>
              <label className="muted small">
                Page size:{' '}
                <select
                  value={txLimit}
                  onChange={(e) => setTxLimit(Number(e.target.value))}
                  style={{ padding: 10 }}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </label>
            </div>
            {txError ? <div className="err">Transactions error: {txError}</div> : null}
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Kind</th>
                    <th>{memberIdLabel}</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Staff</th>
                    <th>Phone</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {txLoading && txRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="muted">
                        Loading...
                      </td>
                    </tr>
                  ) : txRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="muted">
                        No transactions found.
                      </td>
                    </tr>
                  ) : (
                    txRows.map((tx) => (
                      <tr key={tx.id || tx.created_at}>
                        <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                        <td>{formatKind(tx.kind, feeLabel)}</td>
                        <td>{matatuMap.get(tx.matatu_id || '') || '-'}</td>
                        <td>{fmtKES(tx.fare_amount_kes)}</td>
                        <td>{tx.status || ''}</td>
                        <td>{tx.created_by_name || tx.created_by_email || '-'}</td>
                        <td>{tx.passenger_msisdn || '-'}</td>
                        <td>{tx.notes || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <StickerPrintModal
            open={showPaybillSticker}
            title="SACCO PayBill Accounts (4814003)"
            onClose={() => setShowPaybillSticker(false)}
            lines={[
              { label: 'Daily Fee Collection Account - SACCO FEE Account', value: paybillCodes.fee },
              { label: 'Loan Repayment Account - SACCO LOAN Account', value: paybillCodes.loan },
              { label: 'Savings Deposit Account - SACCO SAVINGS Account', value: paybillCodes.savings },
            ]}
          />

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Pending loan requests</h3>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn ghost" onClick={loadLoanRequests}>
                  Reload
                </button>
                <span className="muted small">{loanReqMsg || `${loanRequests.length} request(s)`}</span>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>{memberOwnerLabel}</th>
                    <th>{memberIdLabel}</th>
                    <th>Amount</th>
                    <th>Model</th>
                    <th>Term</th>
                    <th>Payout</th>
                    <th>Note</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loanRequests.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="muted">
                        {loanReqMsg || 'No pending requests'}
                      </td>
                    </tr>
                  ) : (
                    loanRequests.map((r) => (
                      <tr key={r.id}>
                        <td>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
                        <td>{r.owner_name || ''}</td>
                        <td>{matatuMap.get(r.matatu_id || '') || ''}</td>
                        <td>{fmtKES(r.amount_kes)}</td>
                        <td>{r.model || ''}</td>
                        <td>{r.term_months || ''} mo</td>
                        <td>
                          {r.payout_method || ''}
                          {r.payout_phone ? ` (${r.payout_phone})` : ''}
                          {r.payout_account ? ` (${r.payout_account})` : ''}
                        </td>
                        <td>{r.note || ''}</td>
                        <td>{r.status || ''}</td>
                        <td className="row" style={{ gap: 6 }}>
                          <button type="button" onClick={() => handleLoanRequest(r.id || '', 'APPROVE')}>
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn bad ghost"
                            onClick={() => handleLoanRequest(r.id || '', 'REJECT')}
                          >
                            Reject
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {activeTab === 'members' ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>{memberLabel}</h3>
            <input
              placeholder={`Search ${memberIdLabel}`}
              value={matatuFilter}
              onChange={(e) => setMatatuFilter(e.target.value)}
              className="input"
              style={{ maxWidth: 220 }}
            />
            <span className="muted small">{memberMsg}</span>
          </div>
          <div className="table-wrap">
            {isBoda ? (
              <table>
                <thead>
                  <tr>
                    <th>{memberOwnerLabel}</th>
                    <th>Phone</th>
                    <th>{memberIdLabel}</th>
                    {showMemberLocation ? <th>{memberLocationLabel}</th> : null}
                    <th>Savings</th>
                    <th>Till</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMatatus.length === 0 ? (
                    <tr>
                      <td colSpan={bodaTableColSpan} className="muted">
                        No {memberLabel.toLowerCase()}.
                      </td>
                    </tr>
                  ) : (
                    filteredMatatus.map((m) => (
                      <tr key={m.id || m.number_plate}>
                        <td>{m.owner_name || ''}</td>
                        <td>{m.owner_phone || ''}</td>
                        <td>{memberIdValue(m)}</td>
                        {showMemberLocation ? <td>{memberLocationValue(m)}</td> : null}
                        <td>
                          <label className="muted small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input
                              type="checkbox"
                              checked={!!m.savings_opt_in}
                              onChange={(e) => updateSavingsOptIn(m.id, e.target.checked)}
                            />
                            {m.savings_opt_in ? 'Enabled' : 'Off'}
                          </label>
                        </td>
                        <td>{m.till_number || ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{memberIdLabel}</th>
                    <th>{memberOwnerLabel}</th>
                    <th>Phone</th>
                    {showVehicleTypeColumn ? <th>Type</th> : null}
                    {showMemberLocation ? <th>{memberLocationLabel}</th> : null}
                    {showTLBColumn ? <th>TLB</th> : null}
                    <th>Savings</th>
                    <th>Till</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMatatus.length === 0 ? (
                    <tr>
                      <td colSpan={memberTableColSpan} className="muted">
                        No {memberLabel.toLowerCase()}.
                      </td>
                    </tr>
                  ) : (
                    filteredMatatus.map((m) => {
                      const tlbValue = tlbEdits[m.id || ''] ?? m.tlb_number ?? ''
                      const tlbDisabled = !m.id || tlbValue === (m.tlb_number || '')
                      return (
                        <tr key={m.id || m.number_plate}>
                          <td>{memberIdValue(m)}</td>
                          <td>{m.owner_name || ''}</td>
                          <td>{m.owner_phone || ''}</td>
                          {showVehicleTypeColumn ? <td>{m.vehicle_type || ''}</td> : null}
                          {showMemberLocation ? <td>{memberLocationValue(m)}</td> : null}
                          {showTLBColumn ? (
                            <td>
                              <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                <input
                                  className="input"
                                  value={tlbValue}
                                  onChange={(e) =>
                                    setTlbEdits((prev) => ({
                                      ...prev,
                                      [m.id || '']: e.target.value,
                                    }))
                                  }
                                  placeholder="TLB number"
                                  style={{ minWidth: 140 }}
                                />
                                <button
                                  type="button"
                                  className="btn ghost"
                                  onClick={() => updateTlbNumber(m.id)}
                                  disabled={tlbDisabled}
                                >
                                  Save
                                </button>
                              </div>
                            </td>
                          ) : null}
                          <td>
                            <label className="muted small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input
                                type="checkbox"
                                checked={!!m.savings_opt_in}
                                onChange={(e) => updateSavingsOptIn(m.id, e.target.checked)}
                              />
                              {m.savings_opt_in ? 'Enabled' : 'Off'}
                            </label>
                          </td>
                          <td>{m.till_number || ''}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>
      ) : null}



      {activeTab === 'daily_fee' ? (
        <>
          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>{feeLabel} overview</h3>
              <span className="muted small">{txByKind.daily.length} records in range</span>
            </div>
            <div className="grid metrics">
              <div className="metric">
                <div className="k">Collected (today / week / month)</div>
                <div className="v">
                  {fmtKES(summary.SACCO_FEE.today)} / {fmtKES(summary.SACCO_FEE.week)} /{' '}
                  {fmtKES(summary.SACCO_FEE.month)}
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>{feeLabel} rates</h3>
              <span className="muted small">{feeMsg}</span>
            </div>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <label>
                <div className="muted small">Vehicle type</div>
                <select
                  value={feeForm.vehicle_type}
                  onChange={(e) => setFeeForm((f) => ({ ...f, vehicle_type: e.target.value }))}
                  style={{ padding: 10, minWidth: 200 }}
                >
                  <option value="">- choose -</option>
                  {vehicleTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <div className="muted small">{feeLabel} (KES)</div>
                <input
                  type="number"
                  value={feeForm.amount}
                  onChange={(e) => setFeeForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="Amount"
                />
              </label>
              <button type="button" onClick={saveDailyFeeRate}>
                Save
              </button>
              <button type="button" className="btn ghost" onClick={loadDailyFeeRates}>
                Reload
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Vehicle type</th>
                    <th>{feeLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {feeRates.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="muted">
                        No rates configured.
                      </td>
                    </tr>
                  ) : (
                    feeRates.map((r) => (
                      <tr key={r.vehicle_type}>
                        <td>{r.vehicle_type}</td>
                        <td>{fmtKES(r.daily_fee_kes)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>{feeLabel} history</h3>
              <span className="muted small">{txByKind.daily.length} records</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>{memberIdLabel}</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Staff</th>
                  </tr>
                </thead>
                <tbody>
                  {txByKind.daily.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No {feeLabel.toLowerCase()} records.
                      </td>
                    </tr>
                  ) : (
                    txByKind.daily.map((tx) => (
                      <tr key={tx.id || tx.created_at}>
                        <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                        <td>{matatuMap.get(tx.matatu_id || '') || '-'}</td>
                        <td>{fmtKES(tx.fare_amount_kes)}</td>
                        <td>{tx.status || ''}</td>
                        <td>{tx.created_by_name || tx.created_by_email || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>Staff collections (SUCCESS only in range)</h3>
            <div className="grid g2">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th>Email</th>
                      <th>{feeLabel}</th>
                      <th>Savings</th>
                      <th>Loan</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffSummary.summaryRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="muted">
                          No data.
                        </td>
                      </tr>
                    ) : (
                      staffSummary.summaryRows.map((row) => (
                        <tr key={row.email || row.name}>
                          <td>{row.name}</td>
                          <td className="mono">{row.email}</td>
                          <td>{fmtKES(row.df)}</td>
                          <td>{fmtKES(row.sav)}</td>
                          <td>{fmtKES(row.loan)}</td>
                          <td>
                            <strong>{fmtKES(row.total)}</strong>
                          </td>
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
                      <th>Staff</th>
                      <th>{memberIdLabel}</th>
                      <th>Kind</th>
                      <th>Amount</th>
                      <th>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffSummary.breakdownRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="muted">
                          No data.
                        </td>
                      </tr>
                    ) : (
                      staffSummary.breakdownRows.map((row) => (
                        <tr key={`${row.staff}-${row.plate}-${row.kind}`}>
                          <td>{row.staff}</td>
                          <td className="mono">{row.plate}</td>
                          <td>{formatKind(row.kind, feeLabel)}</td>
                          <td>{fmtKES(row.amount)}</td>
                          <td>{row.count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {renderStkSection(`${feeLabel} STK payment`, `Record ${feeLabel.toLowerCase()} collections via STK.`)}
        </>
      ) : null}

      {activeTab === 'savings' ? (
        <>
          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Savings overview</h3>
              <span className="muted small">{txByKind.savings.length} records in range</span>
            </div>
            <div className="grid metrics">
              <div className="metric">
                <div className="k">Savings (today / week / month)</div>
                <div className="v">
                  {fmtKES(summary.SAVINGS.today)} / {fmtKES(summary.SAVINGS.week)} / {fmtKES(summary.SAVINGS.month)}
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Savings balances</h3>
              <span className="muted small">Computed from SUCCESS transactions in range</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{memberIdLabel}</th>
                    <th>Deposits</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {savingsBalances.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No savings balance data.
                      </td>
                    </tr>
                  ) : (
                    savingsBalances.map((row) => (
                      <tr key={row.id}>
                        <td className="mono">{row.member}</td>
                        <td>{fmtKES(row.amount)}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Savings deposits</h3>
              <span className="muted small">{txByKind.savings.length} records</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>{memberIdLabel}</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Staff</th>
                  </tr>
                </thead>
                <tbody>
                  {txByKind.savings.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No savings deposits in range.
                      </td>
                    </tr>
                  ) : (
                    txByKind.savings.map((tx) => (
                      <tr key={tx.id || tx.created_at}>
                        <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                        <td>{matatuMap.get(tx.matatu_id || '') || '-'}</td>
                        <td>{fmtKES(tx.fare_amount_kes)}</td>
                        <td>{tx.status || ''}</td>
                        <td>{tx.created_by_name || tx.created_by_email || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {renderStkSection('Savings STK payment', 'Record savings deposits via STK.')}
        </>
      ) : null}

      {activeTab === 'routes' ? (
        <>
          {showRouteMap ? (
            <section className="card">
              <div className="topline">
                <h3 style={{ margin: 0 }}>{routesLabel} map & live {memberLabel}</h3>
                <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <label className="muted small">
                    {routeLabel}
                    <select
                      value={routeViewId}
                      onChange={(e) => setRouteViewId(e.target.value)}
                      style={{ padding: 10, minWidth: 180 }}
                    >
                      {routes.map((r) => (
                        <option key={r.id || r.code} value={r.id || ''}>
                          {r.code ? `${r.code} - ${r.name}` : r.name || r.id}
                        </option>
                      ))}
                      {!routes.length ? <option value="">- no {routesLabel.toLowerCase()} -</option> : null}
                    </select>
                  </label>
                  <button type="button" className="btn ghost" onClick={loadRouteLive} disabled={!routeViewId}>
                    Reload Live
                  </button>
                  <span className="muted small">{routeLiveMsg}</span>
                </div>
              </div>
              <div className="muted small" style={{ marginBottom: 8 }}>
                Select a {routeLabel.toLowerCase()} to view its path and live {memberLabel.toLowerCase()} positions (GPS
                required).
              </div>
              <div
                ref={mapRef}
                style={{ height: 320, borderRadius: 12, overflow: 'hidden', background: '#e2e8f0' }}
              />
              {routeMapMsg ? (
                <div className="muted small" style={{ marginTop: 6 }}>
                  {routeMapMsg}
                </div>
              ) : null}
            </section>
          ) : (
            <section className="card">
              <div className="topline">
                <h3 style={{ margin: 0 }}>{routesLabel} overview</h3>
              </div>
              <div className="muted small">Live route mapping is available for matatu operators only.</div>
            </section>
          )}

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>{routesLabel}</h3>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn ghost" onClick={loadRoutes}>
                  Reload
                </button>
                <span className="muted small">{routesMsg}</span>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>{routeLabel}</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No {routesLabel.toLowerCase()}.
                      </td>
                    </tr>
                  ) : (
                    routes.map((r) => (
                      <tr key={r.id || r.name}>
                        <td>{r.code || ''}</td>
                        <td>{r.name || ''}</td>
                        <td>{r.start_stop || ''}</td>
                        <td>{r.end_stop || ''}</td>
                        <td>{r.active ? 'Active' : 'Inactive'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {activeTab === 'vehicle_care' ? (
        currentSacco ? (
          <VehicleCarePage
            context={{
              scope_type: 'OPERATOR',
              scope_id: currentSacco,
              can_manage_vehicle_care: canManageVehicleCare,
              can_manage_compliance: canManageCompliance,
              can_view_analytics: canViewVehicleCareAnalytics,
            }}
          />
        ) : (
          <section className="card">
            <div className="muted">Select an operator to view vehicle care.</div>
          </section>
        )
      ) : null}

      {activeTab === 'loans' ? (
        <>
        <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Loans</h3>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn ghost" onClick={loadLoans}>
              Reload
            </button>
            <span className="muted small">{loanMsg}</span>
          </div>
        </div>
        <div className="card" style={{ boxShadow: 'none', marginBottom: 12 }}>
          <h4 style={{ margin: '0 0 6px' }}>Create loan</h4>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select
              value={loanForm.matatu_id}
              onChange={(e) => {
                const id = e.target.value
                const mt = matatus.find((m) => String(m.id) === id)
                setLoanForm((f) => ({ ...f, matatu_id: id, borrower_name: mt?.owner_name || f.borrower_name }))
              }}
              style={{ padding: 10, minWidth: 160 }}
            >
              <option value="">{`- ${memberIdLabel} (optional) -`}</option>
              {matatus.map((m) => (
                <option key={m.id} value={m.id}>
                  {memberIdValue(m)} - {m.owner_name}
                </option>
              ))}
            </select>
            <input
              placeholder="Borrower"
              value={loanForm.borrower_name}
              onChange={(e) => setLoanForm((f) => ({ ...f, borrower_name: e.target.value }))}
              style={{ flex: '1 1 200px' }}
            />
            <input
              type="number"
              placeholder="Principal (KES)"
              value={loanForm.principal}
              onChange={(e) => setLoanForm((f) => ({ ...f, principal: e.target.value }))}
              style={{ width: 150 }}
            />
            <input
              type="number"
              placeholder="Interest %"
              value={loanForm.rate}
              onChange={(e) => setLoanForm((f) => ({ ...f, rate: e.target.value }))}
              style={{ width: 130 }}
            />
            <input
              type="number"
              placeholder="Term (months)"
              value={loanForm.term}
              onChange={(e) => setLoanForm((f) => ({ ...f, term: e.target.value }))}
              style={{ width: 130 }}
            />
            <select
              value={loanForm.status}
              onChange={(e) => setLoanForm((f) => ({ ...f, status: e.target.value }))}
              style={{ padding: 10, width: 140 }}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="CLOSED">CLOSED</option>
              <option value="PENDING">PENDING</option>
            </select>
            <button type="button" onClick={createLoan}>
              Save loan
            </button>
          </div>
        </div>
        <div className="grid g2" style={{ gap: 12 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Borrower</th>
                  <th>{memberIdLabel}</th>
                  <th>Principal</th>
                  <th>Rate %</th>
                  <th>Term</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loans.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      No loans.
                    </td>
                  </tr>
                ) : (
                  loans.map((ln) => (
                    <tr key={ln.id}>
                      <td>{ln.borrower_name || ''}</td>
                      <td className="mono">{matatuMap.get(ln.matatu_id || '') || ''}</td>
                      <td>{fmtKES(ln.principal_kes)}</td>
                      <td>{ln.interest_rate_pct ?? ''}</td>
                      <td>{ln.term_months ?? ''}</td>
                      <td>{ln.status || ''}</td>
                      <td className="row" style={{ gap: 6 }}>
                        <button type="button" className="btn ghost" onClick={() => viewLoanHistory(ln.id)}>
                          History
                        </button>
                        <button type="button" onClick={() => updateLoanStatus(ln.id, 'CLOSED')}>
                          Close
                        </button>
                        <button type="button" className="btn bad ghost" onClick={() => deleteLoan(ln.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="card" style={{ boxShadow: 'none' }}>
            <h4 style={{ margin: '0 0 6px' }}>Loan history</h4>
            <div className="muted small" style={{ marginBottom: 6 }}>
              {loanHistory.msg || ''}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Amount</th>
                    <th>Staff</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {loanHistory.items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        {loanHistory.msg || 'No history yet.'}
                      </td>
                    </tr>
                  ) : (
                    loanHistory.items.map((tx) => (
                      <tr key={tx.id || tx.created_at}>
                        <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                        <td>{fmtKES(tx.fare_amount_kes)}</td>
                        <td>{tx.created_by_name || tx.created_by_email || ''}</td>
                        <td>{(tx as any).notes || ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {loanHistory.items.length ? (
              <div className="muted small" style={{ marginTop: 6 }}>
                Total scheduled: {fmtKES(loanHistory.total)}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Loan repayments (in range)</h3>
          <span className="muted small">{txByKind.loans.length} records</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>{memberIdLabel}</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Staff</th>
              </tr>
            </thead>
            <tbody>
              {txByKind.loans.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No loan repayments in range.
                  </td>
                </tr>
              ) : (
                txByKind.loans.map((tx) => (
                  <tr key={tx.id || tx.created_at}>
                    <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                    <td>{matatuMap.get(tx.matatu_id || '') || '-'}</td>
                    <td>{fmtKES(tx.fare_amount_kes)}</td>
                    <td>{tx.status || ''}</td>
                    <td>{tx.created_by_name || tx.created_by_email || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Loan requests</h3>
          <button type="button" className="btn ghost" onClick={loadLoanRequests}>
            Reload
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>{memberOwnerLabel}</th>
                <th>{memberIdLabel}</th>
                <th>Amount</th>
                <th>Model</th>
                <th>Term</th>
                <th>Payout</th>
                <th>Note</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loanRequests.length === 0 ? (
                <tr>
                  <td colSpan={10} className="muted">
                    {loanReqMsg || 'No pending requests'}
                  </td>
                </tr>
              ) : (
                loanRequests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
                    <td>{r.owner_name || ''}</td>
                    <td>{matatuMap.get(r.matatu_id || '') || ''}</td>
                    <td>{fmtKES(r.amount_kes)}</td>
                    <td>{r.model || ''}</td>
                    <td>{r.term_months || ''} mo</td>
                    <td>
                      {r.payout_method || ''}
                      {r.payout_phone ? ` (${r.payout_phone})` : ''}
                      {r.payout_account ? ` (${r.payout_account})` : ''}
                    </td>
                    <td>{r.note || ''}</td>
                    <td>{r.status || ''}</td>
                    <td className="row" style={{ gap: 6 }}>
                      <button type="button" onClick={() => handleLoanRequest(r.id || '', 'APPROVE')}>
                        Approve
                      </button>
                      <button type="button" className="btn bad ghost" onClick={() => handleLoanRequest(r.id || '', 'REJECT')}>
                        Reject
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
          <h3 style={{ margin: 0 }}>Approved - pending disbursement</h3>
          <button type="button" className="btn ghost" onClick={loadLoanDisbursements}>
            Reload
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>{memberOwnerLabel}</th>
                <th>{memberIdLabel}</th>
                <th>Amount</th>
                <th>Model</th>
                <th>Term</th>
                <th>Payout</th>
                <th>Disbursement</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loanDisb.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">
                    {loanDisbMsg || 'No loans awaiting disbursement'}
                  </td>
                </tr>
              ) : (
                loanDisb.map((r) => (
                  <tr key={r.id}>
                    <td>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
                    <td>{r.owner_name || ''}</td>
                    <td>{matatuMap.get(r.matatu_id || '') || ''}</td>
                    <td>{fmtKES(r.amount_kes)}</td>
                    <td>{r.model || ''}</td>
                    <td>{r.term_months || ''} mo</td>
                    <td>
                      {r.payout_method || ''}
                      {r.payout_phone ? ` (${r.payout_phone})` : ''}
                      {r.payout_account ? ` (${r.payout_account})` : ''}
                    </td>
                    <td>{r.status || ''}</td>
                    <td>
                      <button type="button" onClick={() => handleDisburse(r)}>
                        Mark disbursed
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
          <h3 style={{ margin: 0 }}>Loan approvals history</h3>
          <div className="row" style={{ gap: 8 }}>
            <label className="muted small">
              Status
              <select
                value={loanApprovalsStatus}
                onChange={(e) => setLoanApprovalsStatus(e.target.value)}
                style={{ padding: 10 }}
              >
                <option value="APPROVED,REJECTED,CANCELLED">All decisions</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </label>
            <button type="button" className="btn ghost" onClick={loadLoanApprovalsHistory}>
              Reload
            </button>
            <span className="muted small">{loanApprovalsMsg}</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Decision time</th>
                <th>{memberOwnerLabel}</th>
                <th>{memberIdLabel}</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Payout</th>
                <th>Disbursement</th>
                <th>Reason / Note</th>
              </tr>
            </thead>
            <tbody>
              {loanApprovals.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted">
                    {loanApprovalsMsg || 'No approvals yet.'}
                  </td>
                </tr>
              ) : (
                loanApprovals.map((r) => {
                  const decisionAt = r.decided_at || r.created_at
                  const payoutDetail = r.payout_phone || r.payout_account || ''
                  const payoutLabel = r.payout_method
                    ? `${r.payout_method}${payoutDetail ? ` (${payoutDetail})` : ''}`
                    : '-'
                  const disbursedAt = r.disbursed_at ? new Date(r.disbursed_at).toLocaleString() : ''
                  const disbursedMethod = r.disbursed_method || r.payout_method || ''
                  const disbursedLabel = r.disbursed_at
                    ? `${disbursedMethod || 'Disbursed'}${disbursedAt ? ` (${disbursedAt})` : ''}`
                    : '-'
                  const reason = r.rejection_reason || r.note || ''
                  return (
                    <tr key={r.id || r.created_at}>
                      <td>{decisionAt ? new Date(decisionAt).toLocaleString() : ''}</td>
                      <td>{r.owner_name || ''}</td>
                      <td>{matatuMap.get(r.matatu_id || '') || ''}</td>
                      <td>{fmtKES(r.amount_kes)}</td>
                      <td>{r.status || ''}</td>
                      <td>{payoutLabel}</td>
                      <td>{disbursedLabel}</td>
                      <td>{reason || '-'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Loans due today / overdue</h3>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn ghost" onClick={loadLoanDue}>
              Reload
            </button>
            <span className="muted small">{loanDueMsg || `${loanDue.length} loan(s)`}</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Due status</th>
                <th>Due date</th>
                <th>Borrower</th>
                <th>{memberIdLabel}</th>
                <th>Principal</th>
                <th>Rate %</th>
                <th>Term</th>
                <th>Model</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loanDue.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">
                    {loanDueMsg || 'No loans due today or overdue.'}
                  </td>
                </tr>
              ) : (
                loanDue.map((ln) => (
                  <tr key={ln.id || ln.matatu_id}>
                    <td>{ln.due_status || ''}</td>
                    <td>{ln.next_due_date ? new Date(ln.next_due_date).toLocaleDateString() : ''}</td>
                    <td>{ln.borrower_name || ''}</td>
                    <td className="mono">{matatuMap.get(ln.matatu_id || '') || ''}</td>
                    <td>{fmtKES(ln.principal_kes)}</td>
                    <td>{ln.interest_rate_pct ?? ''}</td>
                    <td>{ln.term_months ?? ''}</td>
                    <td>{ln.collection_model || ''}</td>
                    <td>
                      <button type="button" className="btn ghost" onClick={() => viewLoanHistory(ln.id)}>
                        History
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {renderStkSection('Loan repayment STK payment', 'Record loan repayments via STK.')}
        </>
      ) : null}

      {activeTab === 'payouts' ? (
        <>
          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Payout Readiness</h3>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn ghost" onClick={() => loadPayoutReadiness()}>
                  Refresh
                </button>
                <span className="muted small">{payoutReadinessMsg}</span>
              </div>
            </div>
            {payoutReadinessError ? <div className="err">{payoutReadinessError}</div> : null}
            <div className="grid g2" style={{ gap: 12, marginTop: 8 }}>
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge-ghost">
                    {payoutReadinessChecks?.has_verified_msisdn_destination?.pass ? 'OK' : 'BLOCK'}
                  </span>
                  <strong>Verified MSISDN destination</strong>
                </div>
                <div className="muted small">
                  {payoutReadinessChecks?.has_verified_msisdn_destination?.reason || 'Checking destinations...'}
                </div>
                <div className="muted small">
                  Verified MSISDN destinations: {payoutReadiness?.destinations?.verified_msisdn_count || 0}
                </div>
              </div>

              <div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge-ghost">
                    {payoutReadinessChecks?.no_quarantines_in_window?.pass ? 'OK' : 'BLOCK'}
                  </span>
                  <strong>No quarantines in range</strong>
                </div>
                <div className="muted small">
                  {payoutReadinessChecks?.no_quarantines_in_window?.reason || 'Checking quarantines...'}
                </div>
                <div className="muted small">
                  Quarantines: {payoutReadiness?.quarantines?.count || 0}
                </div>
                {payoutReadiness?.quarantines?.sample?.length ? (
                  <div className="muted small" style={{ marginTop: 4 }}>
                    Sample: {payoutReadiness.quarantines.sample[0]?.account_reference || '-'} (
                    {payoutReadiness.quarantines.sample[0]?.reason || 'reason'})
                  </div>
                ) : null}
              </div>

              <div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge-ghost">
                    {payoutReadinessChecks?.has_positive_balances?.pass ? 'OK' : 'BLOCK'}
                  </span>
                  <strong>Wallet balances &gt; 0</strong>
                </div>
                <div className="muted small">
                  {payoutReadinessChecks?.has_positive_balances?.reason || 'Checking balances...'}
                </div>
                {payoutReadiness?.wallet_balances?.length ? (
                  <div className="muted small" style={{ marginTop: 4 }}>
                    {payoutReadiness.wallet_balances.map((row) => (
                      <div key={row.wallet_id || row.wallet_kind}>
                        {formatPayoutKind(row.wallet_kind, feeLabel)}: {fmtKES(row.balance || 0)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge-ghost">{payoutReadinessChecks?.b2c_env_present?.pass ? 'OK' : 'BLOCK'}</span>
                  <strong>B2C env configured</strong>
                </div>
                <div className="muted small">
                  {payoutReadinessChecks?.b2c_env_present?.reason || 'Checking B2C config...'}
                </div>
                {payoutReadinessChecks?.b2c_env_present?.pass === false ? (
                  <div className="muted small">
                    Missing keys:{' '}
                    {(payoutReadinessChecks?.b2c_env_present?.details?.missing_keys as string[] | undefined)?.join(
                      ', ',
                    ) || '-'}
                  </div>
                ) : null}
              </div>
            </div>
            {payoutReadinessFixes.length ? (
              <div className="muted small" style={{ marginTop: 10 }}>
                <strong>How to fix:</strong>
                <ul style={{ marginTop: 6 }}>
                  {payoutReadinessFixes.map((fix) => (
                    <li key={fix}>{fix}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="card">
            <PaybillHeader title="SACCO Payouts (4814003)" />
            <div className="muted small" style={{ marginTop: 8 }}>
              Payout batches require system admin approval. Wallets are debited only after M-Pesa confirms payout.
            </div>
            <div className="muted small">
              Only MSISDN payouts are automated in v1. PayBill/Till destinations require manual transfer.
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Payout destinations</h3>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn ghost" onClick={loadPayoutDestinations}>
                  Reload
                </button>
                <span className="muted small">{payoutDestMsg}</span>
              </div>
            </div>
            {payoutDestError ? <div className="err">{payoutDestError}</div> : null}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <select
                value={payoutDestForm.destination_type}
                onChange={(e) => setPayoutDestForm((f) => ({ ...f, destination_type: e.target.value }))}
                style={{ padding: 10, minWidth: 160 }}
              >
                <option value="MSISDN">MSISDN</option>
                <option value="PAYBILL_TILL">PayBill/Till</option>
              </select>
              <input
                placeholder={payoutDestForm.destination_type === 'MSISDN' ? 'MSISDN e.g. +2547XXXXXXXX' : 'Till or PayBill'}
                value={payoutDestForm.destination_ref}
                onChange={(e) => setPayoutDestForm((f) => ({ ...f, destination_ref: e.target.value }))}
                style={{ minWidth: 200 }}
              />
              <input
                placeholder="Label (optional)"
                value={payoutDestForm.destination_name}
                onChange={(e) => setPayoutDestForm((f) => ({ ...f, destination_name: e.target.value }))}
                style={{ minWidth: 200 }}
              />
              <button type="button" onClick={savePayoutDestination}>
                Save destination
              </button>
            </div>
            {payoutDestForm.destination_type !== 'MSISDN' ? (
              <div className="muted small" style={{ marginTop: 6 }}>
                PayBill/Till destinations are stored for manual transfer in v1.
              </div>
            ) : null}
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Reference</th>
                    <th>Label</th>
                    <th>Verified</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutDestinations.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No payout destinations yet.
                      </td>
                    </tr>
                  ) : (
                    payoutDestinations.map((d) => (
                      <tr key={d.id}>
                        <td>{d.destination_type || ''}</td>
                        <td className="mono">{d.destination_ref || ''}</td>
                        <td>{d.destination_name || '-'}</td>
                        <td>{d.is_verified ? 'Verified' : 'Pending'}</td>
                        <td>{d.created_at ? new Date(d.created_at).toLocaleString() : ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Create payout batch</h3>
              <span className="muted small">{payoutBatchMsg}</span>
            </div>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              <label>
                <div className="muted small">Date from</div>
                <input
                  type="date"
                  value={payoutBatchForm.date_from}
                  onChange={(e) => setPayoutBatchForm((f) => ({ ...f, date_from: e.target.value }))}
                />
              </label>
              <label>
                <div className="muted small">Date to</div>
                <input
                  type="date"
                  value={payoutBatchForm.date_to}
                  onChange={(e) => setPayoutBatchForm((f) => ({ ...f, date_to: e.target.value }))}
                />
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={payoutBatchForm.include_wallet_kinds.SACCO_FEE}
                  onChange={(e) =>
                    setPayoutBatchForm((f) => ({
                      ...f,
                      include_wallet_kinds: { ...f.include_wallet_kinds, SACCO_FEE: e.target.checked },
                    }))
                  }
                />
                {feeLabel}
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={payoutBatchForm.include_wallet_kinds.SACCO_LOAN}
                  onChange={(e) =>
                    setPayoutBatchForm((f) => ({
                      ...f,
                      include_wallet_kinds: { ...f.include_wallet_kinds, SACCO_LOAN: e.target.checked },
                    }))
                  }
                />
                Loan
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={payoutBatchForm.include_wallet_kinds.SACCO_SAVINGS}
                  onChange={(e) =>
                    setPayoutBatchForm((f) => ({
                      ...f,
                      include_wallet_kinds: { ...f.include_wallet_kinds, SACCO_SAVINGS: e.target.checked },
                    }))
                  }
                />
                Savings
              </label>
            </div>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              <label>
                <div className="muted small">{feeLabel} destination</div>
                <select
                  value={payoutBatchForm.destination_by_kind.SACCO_FEE}
                  onChange={(e) =>
                    setPayoutBatchForm((f) => ({
                      ...f,
                      destination_by_kind: { ...f.destination_by_kind, SACCO_FEE: e.target.value },
                    }))
                  }
                  style={{ padding: 10, minWidth: 220 }}
                >
                  <option value="">- select -</option>
                  {payoutDestinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {(d.destination_name || d.destination_ref || '').toString()}
                      {d.is_verified ? '' : ' (unverified)'}
                    </option>
                  ))}
                </select>
                {payoutBatchForm.destination_by_kind.SACCO_FEE &&
                payoutDestinationById.get(payoutBatchForm.destination_by_kind.SACCO_FEE)?.is_verified === false ? (
                  <div className="muted small">Unverified: approval blocked until verified.</div>
                ) : null}
              </label>
              <label>
                <div className="muted small">Loan destination</div>
                <select
                  value={payoutBatchForm.destination_by_kind.SACCO_LOAN}
                  onChange={(e) =>
                    setPayoutBatchForm((f) => ({
                      ...f,
                      destination_by_kind: { ...f.destination_by_kind, SACCO_LOAN: e.target.value },
                    }))
                  }
                  style={{ padding: 10, minWidth: 220 }}
                >
                  <option value="">- select -</option>
                  {payoutDestinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {(d.destination_name || d.destination_ref || '').toString()}
                      {d.is_verified ? '' : ' (unverified)'}
                    </option>
                  ))}
                </select>
                {payoutBatchForm.destination_by_kind.SACCO_LOAN &&
                payoutDestinationById.get(payoutBatchForm.destination_by_kind.SACCO_LOAN)?.is_verified === false ? (
                  <div className="muted small">Unverified: approval blocked until verified.</div>
                ) : null}
              </label>
              <label>
                <div className="muted small">Savings destination</div>
                <select
                  value={payoutBatchForm.destination_by_kind.SACCO_SAVINGS}
                  onChange={(e) =>
                    setPayoutBatchForm((f) => ({
                      ...f,
                      destination_by_kind: { ...f.destination_by_kind, SACCO_SAVINGS: e.target.value },
                    }))
                  }
                  style={{ padding: 10, minWidth: 220 }}
                >
                  <option value="">- select -</option>
                  {payoutDestinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {(d.destination_name || d.destination_ref || '').toString()}
                      {d.is_verified ? '' : ' (unverified)'}
                    </option>
                  ))}
                </select>
                {payoutBatchForm.destination_by_kind.SACCO_SAVINGS &&
                payoutDestinationById.get(payoutBatchForm.destination_by_kind.SACCO_SAVINGS)?.is_verified === false ? (
                  <div className="muted small">Unverified: approval blocked until verified.</div>
                ) : null}
              </label>
              <button type="button" onClick={createPayoutBatch} disabled={payoutReadinessBlocking}>
                Create batch
              </button>
              {payoutReadinessBlocking && payoutReadinessFirstReason ? (
                <div className="muted small" style={{ maxWidth: 280 }}>
                  {payoutReadinessFirstReason}
                </div>
              ) : null}
            </div>
            {payoutBlockedPreview.length ? (
              <div className="muted small" style={{ marginTop: 8 }}>
                <strong>Items that will be blocked:</strong>
                <ul style={{ marginTop: 6 }}>
                  {payoutBlockedPreview.map((item, idx) => (
                    <li key={`${item.kind}-${item.reason}-${idx}`}>
                      {formatPayoutKind(item.kind, feeLabel)} - {item.reason === 'ZERO_BALANCE' ? 'Zero balance' : 'B2B not supported'}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Payout batches</h3>
              <div className="row" style={{ gap: 8 }}>
                <label>
                  <div className="muted small">From</div>
                  <input type="date" value={payoutFrom} onChange={(e) => setPayoutFrom(e.target.value)} />
                </label>
                <label>
                  <div className="muted small">To</div>
                  <input type="date" value={payoutTo} onChange={(e) => setPayoutTo(e.target.value)} />
                </label>
                <button type="button" className="btn ghost" onClick={loadPayoutBatches}>
                  Reload
                </button>
                {payoutBatchError ? <span className="err">{payoutBatchError}</span> : null}
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date range</th>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutBatches.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No payout batches.
                      </td>
                    </tr>
                  ) : (
                    payoutBatches.map((b) => (
                      <tr
                        key={b.id}
                        style={b.id && b.id === selectedPayoutBatchId ? { background: '#f1f5f9' } : undefined}
                      >
                        <td>
                          {b.date_from} to {b.date_to}
                          {b.meta?.auto_draft ? <span className="badge-ghost" style={{ marginLeft: 6 }}>AUTO-DRAFT</span> : null}
                        </td>
                        <td>{b.status}</td>
                        <td>{fmtKES(b.total_amount)}</td>
                        <td>{b.created_at ? new Date(b.created_at).toLocaleString() : ''}</td>
                        <td className="row" style={{ gap: 6 }}>
                          <button type="button" className="btn ghost" onClick={() => loadPayoutBatchDetail(b.id || '')}>
                            View
                          </button>
                          {b.status === 'DRAFT' ? (
                            <button
                              type="button"
                              onClick={() => submitPayoutBatch(b.id || '')}
                              disabled={
                                b.id === selectedPayoutBatchId && batchSubmitCheck?.pass === false
                              }
                              title={
                                b.id === selectedPayoutBatchId && batchSubmitCheck?.pass === false
                                  ? batchSubmitCheck?.reason || 'Cannot submit'
                                  : ''
                              }
                            >
                              Submit
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
              <span className="muted small">{payoutBatchDetail ? payoutBatchDetail.status : 'Select a batch'}</span>
            </div>
            {payoutBatchDetail ? (
              <>
                <div className="row" style={{ gap: 12, marginTop: 8 }}>
                  <div className="badge-ghost">
                    {payoutBatchDetail.date_from} to {payoutBatchDetail.date_to}
                  </div>
                  <div className="badge-ghost">Total: {fmtKES(payoutBatchDetail.total_amount)}</div>
                </div>
                {payoutBatchReadiness ? (
                  <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
                    <div className="topline">
                      <h4 style={{ margin: 0 }}>Readiness</h4>
                      {payoutBatchDetail.status === 'DRAFT' ? (
                        <button
                          type="button"
                          onClick={() => submitPayoutBatch(payoutBatchDetail.id || '')}
                          disabled={batchSubmitCheck?.pass === false}
                        >
                          Submit batch
                        </button>
                      ) : null}
                    </div>
                    {batchSubmitCheck?.pass === false ? (
                      <div className="muted small">Submit blocked: {batchSubmitCheck.reason}</div>
                    ) : null}
                    <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                      <div className="badge-ghost">
                        Pending: {payoutBatchReadiness.items_summary?.pending_count || 0}
                      </div>
                      <div className="badge-ghost">
                        Blocked: {payoutBatchReadiness.items_summary?.blocked_count || 0}
                      </div>
                      <div className="badge-ghost">
                        Sent: {payoutBatchReadiness.items_summary?.sent_count || 0}
                      </div>
                      <div className="badge-ghost">
                        Confirmed: {payoutBatchReadiness.items_summary?.confirmed_count || 0}
                      </div>
                      <div className="badge-ghost">
                        Failed: {payoutBatchReadiness.items_summary?.failed_count || 0}
                      </div>
                    </div>
                    {payoutBatchReadiness.items_summary?.blocked_reasons?.length ? (
                      <div className="muted small" style={{ marginTop: 8 }}>
                        Blocked reasons:{' '}
                        {payoutBatchReadiness.items_summary.blocked_reasons
                          .map((r) => `${r.reason} (${r.count})`)
                          .join(', ')}
                      </div>
                    ) : null}
                    {payoutBatchReadiness.issues?.length ? (
                      <div className="muted small" style={{ marginTop: 8 }}>
                        Issues:
                        <ul style={{ marginTop: 6 }}>
                          {payoutBatchReadiness.issues.map((issue) => (
                            <li key={`${issue.code}-${issue.message}`}>
                              {issue.code}: {issue.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {payoutBatchDetail?.meta?.auto_draft ? (
                  <div className="card" style={{ marginTop: 12, boxShadow: 'none', background: '#f8fafc' }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>AUTO-DRAFT</strong> - Auto-drafted on{' '}
                        {payoutBatchDetail.meta?.auto_draft_run_id || payoutBatchDetail.date_to}
                      </div>
                      <div className="muted small">Review amounts and submit when ready.</div>
                    </div>
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
                          <th>Failure</th>
                          {payoutBatchDetail?.status === 'DRAFT' ? <th>Actions</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {payoutItems.length === 0 ? (
                          <tr>
                            <td colSpan={payoutBatchDetail?.status === 'DRAFT' ? 8 : 7} className="muted">
                              No payout items.
                            </td>
                          </tr>
                        ) : (
                          payoutItems.map((item) => {
                            const draft = payoutDraftItems.find((d) => d.id === item.id)
                            const editable = payoutBatchDetail?.status === 'DRAFT'
                            return (
                              <tr key={item.id}>
                                <td>
                                  {formatPayoutKind(item.wallet_kind, feeLabel)}
                                  {item.wallet_balance !== undefined ? (
                                    <div className="muted small">Avail: {fmtKES(item.wallet_balance)}</div>
                                  ) : null}
                                </td>
                                <td>
                                  {editable ? (
                                    <input
                                      type="number"
                                      value={draft?.amount || ''}
                                      onChange={(e) => updateDraftItem(item.id, 'amount')(e.target.value)}
                                      style={{ width: 120 }}
                                      step="0.01"
                                      min={0}
                                    />
                                  ) : (
                                    fmtKES(item.amount)
                                  )}
                                </td>
                                <td>
                                  {editable ? (
                                    <select
                                      value={draft?.destination_id || ''}
                                      onChange={(e) => updateDraftItem(item.id, 'destination_id')(e.target.value)}
                                      style={{ minWidth: 200 }}
                                    >
                                      <option value="">- select -</option>
                                      {payoutDestinations.map((dest) => (
                                        <option key={dest.id} value={dest.id}>
                                          {dest.destination_type} - {dest.destination_ref}
                                          {dest.destination_name ? ` (${dest.destination_name})` : ''}
                                          {dest.is_verified ? '' : ' (unverified)'}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
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
                                  )}
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
                                <td>{item.failure_reason || '-'}</td>
                                {editable ? (
                                  <td>
                                    <button type="button" className="btn ghost" onClick={() => removeDraftItem(item.id)}>
                                      Remove
                                    </button>
                                  </td>
                                ) : null}
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                    {payoutBatchDetail?.status === 'DRAFT' ? (
                      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        <button className="btn" type="button" onClick={saveDraftBatch}>
                          Save draft edits
                        </button>
                        <button className="btn ghost" type="button" onClick={discardDraftBatch}>
                          Discard draft
                        </button>
                        <span className="muted small">{payoutBatchMsg}</span>
                      </div>
                    ) : null}
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
                        {payoutEvents.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="muted">
                              No events.
                            </td>
                          </tr>
                        ) : (
                          payoutEvents.map((event) => (
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
                Pick a batch to see items and events.
              </div>
            )}
          </section>
        </>
      ) : null}

      {activeTab === 'staff' ? (
      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Organization staff</h3>
          <span className="muted small">{staff.length} staff</span>
        </div>
        {staffError ? <div className="err">Staff error: {staffError}</div> : null}
        <div className="grid g2" style={{ marginTop: 8 }}>
          <label className="muted small">
            Name
            <input
              className="input"
              value={staffForm.name}
              onChange={(e) => setStaffForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="muted small">
            Phone
            <input
              className="input"
              value={staffForm.phone}
              onChange={(e) => setStaffForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </label>
          <label className="muted small">
            Email
            <input
              className="input"
              value={staffForm.email}
              onChange={(e) => setStaffForm((f) => ({ ...f, email: e.target.value }))}
            />
          </label>
          <label className="muted small">
            Role
            <select
              value={staffForm.role}
              onChange={(e) => setStaffForm((f) => ({ ...f, role: e.target.value }))}
              style={{ padding: 10 }}
            >
              <option value="SACCO_STAFF">SACCO_STAFF</option>
              <option value="SACCO_ADMIN">SACCO_ADMIN</option>
            </select>
          </label>
          <label className="muted small">
            Temp password (optional)
            <input
              className="input"
              type="password"
              value={staffForm.password}
              onChange={(e) => setStaffForm((f) => ({ ...f, password: e.target.value }))}
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" className="btn" onClick={createStaff}>
            Create / Attach Staff
          </button>
          <span className="muted small">{staffMsg}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No staff found.
                  </td>
                </tr>
              ) : (
                staff.map((s) => {
                  const isEditing = !!s.id && staffEditId === s.id
                  return (
                    <Fragment key={s.id || s.email}>
                      <tr>
                        <td>{s.name || ''}</td>
                        <td>{s.phone || ''}</td>
                        <td>{s.email || ''}</td>
                        <td>{s.role || ''}</td>
                        <td className="row" style={{ gap: 6 }}>
                          <button className="btn ghost" type="button" onClick={() => startStaffEdit(s)}>
                            {isEditing ? 'Close' : 'Edit'}
                          </button>
                          <button className="btn bad ghost" type="button" onClick={() => deleteStaff(s.id)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                      {isEditing ? (
                        <tr>
                          <td colSpan={5}>
                            <div className="card" style={{ margin: '6px 0' }}>
                              <div className="topline">
                                <h4 style={{ margin: 0 }}>Edit staff</h4>
                                <span className="muted small">ID: {s.id}</span>
                              </div>
                              {staffEditError ? <div className="err">Update error: {staffEditError}</div> : null}
                              <div className="grid g2">
                                <label className="muted small">
                                  Name
                                  <input
                                    className="input"
                                    value={staffEditForm.name}
                                    onChange={(e) => setStaffEditForm((f) => ({ ...f, name: e.target.value }))}
                                  />
                                </label>
                                <label className="muted small">
                                  Phone
                                  <input
                                    className="input"
                                    value={staffEditForm.phone}
                                    onChange={(e) => setStaffEditForm((f) => ({ ...f, phone: e.target.value }))}
                                  />
                                </label>
                                <label className="muted small">
                                  Email
                                  <input
                                    className="input"
                                    value={staffEditForm.email}
                                    onChange={(e) => setStaffEditForm((f) => ({ ...f, email: e.target.value }))}
                                  />
                                </label>
                                <label className="muted small">
                                  Role
                                  <select
                                    value={staffEditForm.role}
                                    onChange={(e) => setStaffEditForm((f) => ({ ...f, role: e.target.value }))}
                                    style={{ padding: 10 }}
                                  >
                                    <option value="SACCO_STAFF">SACCO_STAFF</option>
                                    <option value="SACCO_ADMIN">SACCO_ADMIN</option>
                                  </select>
                                </label>
                              </div>
                              <div className="card" style={{ margin: '10px 0 0', boxShadow: 'none' }}>
                                <div className="topline">
                                  <h4 style={{ margin: 0 }}>Vehicle Care access</h4>
                                  <span className="muted small">Grant permissions for staff dashboards</span>
                                </div>
                                {accessGrantError ? <div className="err">Access error: {accessGrantError}</div> : null}
                                {!s.user_id ? (
                                  <div className="muted small">No login linked to this staff profile.</div>
                                ) : (
                                  <>
                                    <div className="grid g2" style={{ marginTop: 6 }}>
                                      <label className="muted small">
                                        Access role
                                        <select
                                          value={staffAccessForm.role}
                                          onChange={(e) => setStaffAccessForm((f) => ({ ...f, role: e.target.value }))}
                                          style={{ padding: 10 }}
                                        >
                                          <option value="STAFF">STAFF</option>
                                          <option value="MANAGER">MANAGER</option>
                                          <option value="ADMIN">ADMIN</option>
                                        </select>
                                      </label>
                                      <label className="muted small">
                                        <input
                                          type="checkbox"
                                          checked={staffAccessForm.is_active}
                                          onChange={(e) => setStaffAccessForm((f) => ({ ...f, is_active: e.target.checked }))}
                                          style={{ marginRight: 6 }}
                                        />
                                        Access active
                                      </label>
                                      <label className="muted small">
                                        <input
                                          type="checkbox"
                                          checked={staffAccessForm.can_manage_vehicle_care}
                                          onChange={(e) =>
                                            setStaffAccessForm((f) => ({ ...f, can_manage_vehicle_care: e.target.checked }))
                                          }
                                          style={{ marginRight: 6 }}
                                        />
                                        Manage Vehicle Care
                                      </label>
                                      <label className="muted small">
                                        <input
                                          type="checkbox"
                                          checked={staffAccessForm.can_manage_compliance}
                                          onChange={(e) =>
                                            setStaffAccessForm((f) => ({ ...f, can_manage_compliance: e.target.checked }))
                                          }
                                          style={{ marginRight: 6 }}
                                        />
                                        Manage compliance dates
                                      </label>
                                      <label className="muted small">
                                        <input
                                          type="checkbox"
                                          checked={staffAccessForm.can_manage_vehicles}
                                          onChange={(e) =>
                                            setStaffAccessForm((f) => ({ ...f, can_manage_vehicles: e.target.checked }))
                                          }
                                          style={{ marginRight: 6 }}
                                        />
                                        Manage vehicles
                                      </label>
                                      <label className="muted small">
                                        <input
                                          type="checkbox"
                                          checked={staffAccessForm.can_manage_staff}
                                          onChange={(e) =>
                                            setStaffAccessForm((f) => ({ ...f, can_manage_staff: e.target.checked }))
                                          }
                                          style={{ marginRight: 6 }}
                                        />
                                        Manage staff access
                                      </label>
                                      <label className="muted small">
                                        <input
                                          type="checkbox"
                                          checked={staffAccessForm.can_view_analytics}
                                          onChange={(e) =>
                                            setStaffAccessForm((f) => ({ ...f, can_view_analytics: e.target.checked }))
                                          }
                                          style={{ marginRight: 6 }}
                                        />
                                        View analytics
                                      </label>
                                    </div>
                                    <div className="row" style={{ marginTop: 8, gap: 8 }}>
                                      <button className="btn" type="button" onClick={() => saveStaffAccess(s.user_id)}>
                                        Save access
                                      </button>
                                      <span className="muted small">{accessGrantMsg}</span>
                                    </div>
                                  </>
                                )}
                              </div>
                              <div className="row" style={{ marginTop: 8 }}>
                                <button className="btn" type="button" onClick={saveStaffEdit}>
                                  Save changes
                                </button>
                                <button
                                  className="btn ghost"
                                  type="button"
                                  onClick={() => {
                                    setStaffEditId('')
                                    setStaffEditMsg('')
                                    setStaffEditError(null)
                                  }}
                                >
                                  Close
                                </button>
                                <span className="muted small">{staffEditMsg}</span>
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
      ) : null}


    </DashboardShell>
  )
}


