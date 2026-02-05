import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../components/DashboardShell'
import { requestJson } from '../../lib/api'

type SaccoOption = { sacco_id: string; name?: string }
type Matatu = {
  id?: string
  number_plate?: string
  owner_name?: string
  owner_phone?: string
  vehicle_type?: string
  tlb_number?: string
  till_number?: string
}

type Tx = {
  id?: string
  created_at?: string
  kind?: string
  status?: string
  matatu_id?: string
  fare_amount_kes?: number
  created_by_name?: string
  created_by_email?: string
}

type Staff = {
  id?: string
  name?: string
  phone?: string
  email?: string
  role?: string
}

type SummaryBuckets = {
  SACCO_FEE: { today: number; week: number; month: number }
  SAVINGS: { today: number; week: number; month: number }
  LOAN_REPAY: { today: number; week: number; month: number }
}

type LoanRequest = {
  id?: string
  created_at?: string
  owner_name?: string
  matatu_id?: string
  amount_kes?: number
  model?: string
  term_months?: number
  payout_method?: string
  payout_phone?: string
  payout_account?: string
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
}

type NotificationItem = {
  id: string
  message: string
  severity: 'INFO' | 'WARN' | 'CRITICAL'
  is_read?: boolean
}

function fmtKES(v: number | undefined | null) {
  return `KES ${(Number(v || 0)).toLocaleString('en-KE')}`
}

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function SaccoDashboard() {
  const [saccos, setSaccos] = useState<SaccoOption[]>([])
  const [currentSacco, setCurrentSacco] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState('Loading SACCOs...')

  const [fromDate, setFromDate] = useState(todayIso())
  const [toDate, setToDate] = useState(todayIso())
  const [txStatus, setTxStatus] = useState<string>('')

  const [matatus, setMatatus] = useState<Matatu[]>([])
  const [matatuFilter, setMatatuFilter] = useState('')
  const [txs, setTxs] = useState<Tx[]>([])
  const [staff, setStaff] = useState<Staff[]>([])

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
  const [feeRates, setFeeRates] = useState<DailyFeeRate[]>([])
  const [feeForm, setFeeForm] = useState({ vehicle_type: '', amount: '' })
  const [feeMsg, setFeeMsg] = useState('')
  const [routes, setRoutes] = useState<SaccoRoute[]>([])
  const [routesMsg, setRoutesMsg] = useState('')
  const [stkForm, setStkForm] = useState({ code: '', amount: '', phone: '' })
  const [stkResp, setStkResp] = useState('')
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
  const [routeForm, setRouteForm] = useState({ name: '', code: '', start: '', end: '' })

  const matatuMap = useMemo(() => {
    const map = new Map<string, string>()
    matatus.forEach((m) => {
      if (m.id) map.set(m.id, m.number_plate || '')
    })
    return map
  }, [matatus])

  const vehicleTypes = useMemo(() => {
    const fromMatatus = matatus.map((m) => (m.vehicle_type || '').trim()).filter(Boolean)
    const fromRates = feeRates.map((r) => (r.vehicle_type || '').trim()).filter(Boolean)
    return Array.from(new Set([...fromMatatus, ...fromRates])).sort()
  }, [matatus, feeRates])

  useEffect(() => {
    async function loadSaccos() {
      try {
        const data = await requestJson<{ items: SaccoOption[] }>('/u/my-saccos')
        const items = data.items || []
        setSaccos(items)
        setStatusMsg(`${items.length} SACCO(s)`)
        if (items.length) {
          setCurrentSacco(items[0].sacco_id)
        } else {
          setCurrentSacco(null)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load SACCOs')
        setStatusMsg('Load error')
      }
    }
    loadSaccos()
  }, [])

  useEffect(() => {
    if (!currentSacco) return
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [matatuRes, txRes, staffRes] = await Promise.all([
          requestJson<{ items: Matatu[] }>(`/u/sacco/${currentSacco}/matatus`),
          requestJson<{ items: Tx[] }>(`/u/sacco/${currentSacco}/transactions?limit=2000`),
          requestJson<{ items: Staff[] }>(`/u/sacco/${currentSacco}/staff`),
        ])
        setMatatus(matatuRes.items || [])
        setTxs(txRes.items || [])
        setStaff(staffRes.items || [])
        await Promise.all([
          loadLoanRequests(),
          loadLoanDisbursements(),
          loadDailyFeeRates(),
          loadRoutes(),
          loadNotifications(),
          loadLoans(),
        ])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentSacco])

  const filteredTx = useMemo(() => {
    return txs.filter((tx) => {
      if (!tx) return false
      const created = tx.created_at ? tx.created_at.slice(0, 10) : ''
      if (created < fromDate || created > toDate) return false
      if (txStatus && (tx.status || '').toUpperCase() !== txStatus) return false
      return true
    })
  }, [txs, fromDate, toDate, txStatus])

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

  const kinds = useMemo(() => {
    const norm = (k?: string) => (k || '').toUpperCase()
    return {
      daily: filteredTx.filter((tx) => norm(tx.kind) === 'SACCO_FEE'),
      savings: filteredTx.filter((tx) => norm(tx.kind) === 'SAVINGS'),
      loans: filteredTx.filter((tx) => norm(tx.kind) === 'LOAN_REPAY'),
    }
  }, [filteredTx])

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
    const headers = ['created_at', 'kind', 'status', 'amount', 'matatu', 'staff_name', 'staff_email']
    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'sacco-transactions.csv'
    a.click()
  }

  async function loadLoanRequests() {
    if (!currentSacco) return
    setLoanReqMsg('Loading...')
    try {
      const res = await requestJson<{ items?: LoanRequest[] }>(
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
      const res = await requestJson<{ items?: LoanRequest[] }>(
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

  async function handleLoanRequest(id: string, action: 'APPROVE' | 'REJECT') {
    if (!currentSacco) return
    const payload: Record<string, string> = { action }
    if (action === 'REJECT') {
      const reason = prompt('Optional reason for rejection (shown to owner):', '')
      if (reason && reason.trim()) payload.rejection_reason = reason.trim()
    }
    try {
      await requestJson(`/u/sacco/${currentSacco}/loan-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      await loadLoanRequests()
      await loadLoanDisbursements()
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
      await requestJson(`/u/sacco/${currentSacco}/loan-requests/${req.id}/disburse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
      setLoanDisbMsg('Marked disbursed')
      await loadLoanDisbursements()
    } catch (err) {
      setLoanDisbMsg(err instanceof Error ? err.message : 'Disburse failed')
    }
  }

  async function loadDailyFeeRates() {
    if (!currentSacco) return
    setFeeMsg('Loading rates...')
    try {
      const res = await requestJson<{ items?: DailyFeeRate[] }>(
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
      await requestJson(`/u/sacco/${currentSacco}/daily-fee-rates`, {
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
      const res = await requestJson<{ items?: SaccoRoute[] }>(`/u/sacco/${currentSacco}/routes`)
      setRoutes(res.items || [])
      setRoutesMsg('')
    } catch (err) {
      setRoutes([])
      setRoutesMsg(err instanceof Error ? err.message : 'Load failed')
    }
  }

  async function toggleRoute(id?: string, active?: boolean) {
    if (!currentSacco || !id) return
    setRoutesMsg('Saving...')
    try {
      await requestJson(`/u/sacco/${currentSacco}/routes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ active: !active }),
      })
      await loadRoutes()
      setRoutesMsg('Updated')
    } catch (err) {
      setRoutesMsg(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function loadLoans() {
    if (!currentSacco) return
    setLoanMsg('Loading loans...')
    try {
      const res = await requestJson<{ items?: Loan[] }>(`/u/sacco/${currentSacco}/loans`)
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
      await requestJson(`/u/sacco/${currentSacco}/loans`, {
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
    } catch (err) {
      setLoanMsg(err instanceof Error ? err.message : 'Create failed')
    }
  }

  async function viewLoanHistory(id: string | undefined) {
    if (!currentSacco || !id) return
    setLoanHistory((prev) => ({ ...prev, msg: 'Loading history...', items: [], loanId: id }))
    try {
      const res = await requestJson<{ items?: Tx[]; total?: number }>(
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
      await requestJson(`/u/sacco/${currentSacco}/loans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ status }),
      })
      await loadLoans()
      setLoanMsg('Updated')
    } catch (err) {
      setLoanMsg(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function deleteLoan(id: string | undefined) {
    if (!currentSacco || !id) return
    setLoanMsg('Deleting...')
    try {
      await requestJson(`/u/sacco/${currentSacco}/loans/${id}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      })
      await loadLoans()
      setLoanMsg('Deleted')
    } catch (err) {
      setLoanMsg(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function createRoute() {
    if (!currentSacco) return
    if (!routeForm.name.trim()) {
      setRoutesMsg('Route name required')
      return
    }
    setRoutesMsg('Saving...')
    try {
      await requestJson(`/u/sacco/${currentSacco}/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: routeForm.name.trim(),
          code: routeForm.code.trim() || null,
          start_stop: routeForm.start.trim() || null,
          end_stop: routeForm.end.trim() || null,
        }),
      })
      setRouteForm({ name: '', code: '', start: '', end: '' })
      await loadRoutes()
      setRoutesMsg('Route saved')
    } catch (err) {
      setRoutesMsg(err instanceof Error ? err.message : 'Create failed')
    }
  }

  async function loadNotifications() {
    if (!currentSacco) return
    const prevRead = new Map<string, boolean>()
    notifications.forEach((n) => prevRead.set(`${n.severity}:${n.message}`, Boolean(n.is_read)))
    const items: NotificationItem[] = []
    try {
      const res = await requestJson<{ items?: LoanRequest[] }>(
        `/u/sacco/${currentSacco}/loan-requests?status=PENDING`,
      )
      const pending = (res.items || []).length
      if (pending > 0) {
        const message = `${pending} pending loan request${pending > 1 ? 's' : ''}`
        items.push({
          id: `loan-requests-${pending}`,
          message,
          severity: 'WARN',
          is_read: prevRead.get(`WARN:${message}`) || false,
        })
      }
    } catch {}
    try {
      const loans = await requestJson<{ items?: any[]; data?: any[] }>('/u/transactions?kind=loans')
      const rows = (loans.items || loans.data || []) as any[]
      const todayISO = new Date().toISOString().slice(0, 10)
      const count = rows.filter((r) => String(r.created_at || '').slice(0, 10) === todayISO).length
      if (count > 0) {
        const message = `${count} loan repayment${count > 1 ? 's' : ''} recorded today`
        items.push({
          id: `loan-repay-${count}`,
          message,
          severity: 'INFO',
          is_read: prevRead.get(`INFO:${message}`) || false,
        })
      }
    } catch {}
    try {
      if (matatuMap.size) {
        const y = new Date()
        y.setDate(y.getDate() - 1)
        const yISO = y.toISOString().slice(0, 10)
        const tx = await requestJson<{ items?: any[] }>(
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
          const message = `Daily fee missing yesterday for ${unpaid.length} matatu(s)`
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
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: !n.is_read } : n)))
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

  return (
    <DashboardShell title="SACCO Dashboard" subtitle="React port of SACCO console">
      <section className="card">
        <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
          <label>
            <div className="muted small">SACCO</div>
            <select
              value={currentSacco || ''}
              onChange={(e) => setCurrentSacco(e.target.value || null)}
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

      {notifications.length ? (
        <section className="card" style={{ background: '#f8fafc' }}>
          <div className="topline" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Notifications</h3>
              <span className="badge-ghost">Unread: {unreadNotificationCount}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
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

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Collections summary</h3>
        <div className="grid metrics">
          <div className="metric">
            <div className="k">Daily Fee (today / week / month)</div>
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
          <h3 style={{ margin: 0 }}>Matatus</h3>
          <input
            placeholder="Search plate"
            value={matatuFilter}
            onChange={(e) => setMatatuFilter(e.target.value)}
            className="input"
            style={{ maxWidth: 200 }}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Plate</th>
                <th>Owner</th>
                <th>Phone</th>
                <th>Type</th>
                <th>TLB</th>
                <th>Till</th>
              </tr>
            </thead>
            <tbody>
              {matatus
                .filter((m) => {
                  if (!matatuFilter.trim()) return true
                  const q = matatuFilter.trim().toUpperCase()
                  return (m.number_plate || '').toUpperCase().includes(q)
                })
                .map((m) => (
                  <tr key={m.id || m.number_plate}>
                    <td>{m.number_plate || ''}</td>
                    <td>{m.owner_name || ''}</td>
                    <td>{m.owner_phone || ''}</td>
                    <td>{m.vehicle_type || ''}</td>
                    <td>{m.tlb_number || ''}</td>
                    <td>{m.till_number || ''}</td>
                  </tr>
                ))}
              {!matatus.length ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No matatus.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="topline">
            <h4 style={{ margin: 0 }}>Daily fee rates</h4>
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
              <div className="muted small">Daily fee (KES)</div>
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
                  <th>Daily fee</th>
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
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Transactions in range ({filteredTx.length})</h3>
        <div className="grid g2">
          <div className="card" style={{ boxShadow: 'none' }}>
            <h4 style={{ margin: '0 0 6px' }}>Daily Fee</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Matatu</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {kinds.daily.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No daily fee transactions.
                      </td>
                    </tr>
                  ) : (
                    kinds.daily.map((tx) => (
                      <tr key={tx.id || tx.created_at}>
                        <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                        <td>{matatuMap.get(tx.matatu_id || '') || ''}</td>
                        <td>{fmtKES(tx.fare_amount_kes)}</td>
                        <td>{tx.status || ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ boxShadow: 'none' }}>
            <h4 style={{ margin: '0 0 6px' }}>Savings</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Matatu</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {kinds.savings.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No savings transactions.
                      </td>
                    </tr>
                  ) : (
                    kinds.savings.map((tx) => (
                      <tr key={tx.id || tx.created_at}>
                        <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                        <td>{matatuMap.get(tx.matatu_id || '') || ''}</td>
                        <td>{fmtKES(tx.fare_amount_kes)}</td>
                        <td>{tx.status || ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ boxShadow: 'none' }}>
            <h4 style={{ margin: '0 0 6px' }}>Loan Repay</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Matatu</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {kinds.loans.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No loan repayments.
                      </td>
                    </tr>
                  ) : (
                    kinds.loans.map((tx) => (
                      <tr key={tx.id || tx.created_at}>
                        <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                        <td>{matatuMap.get(tx.matatu_id || '') || ''}</td>
                        <td>{fmtKES(tx.fare_amount_kes)}</td>
                        <td>{tx.status || ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
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
                <th>Owner</th>
                <th>Plate</th>
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
                <th>Owner</th>
                <th>Plate</th>
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
                      <button type="button" onClick={() => handleDisburse(r)}>Mark disbursed</button>
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
          <h3 style={{ margin: 0 }}>Routes</h3>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn ghost" onClick={loadRoutes}>
              Reload
            </button>
            <span className="muted small">{routesMsg}</span>
          </div>
        </div>
        <div className="grid g2" style={{ gap: 12 }}>
          <div className="card" style={{ boxShadow: 'none' }}>
            <h4 style={{ margin: '0 0 6px' }}>Add route</h4>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                placeholder="Name"
                value={routeForm.name}
                onChange={(e) => setRouteForm((f) => ({ ...f, name: e.target.value }))}
                style={{ flex: '1 1 160px' }}
              />
              <input
                placeholder="Code"
                value={routeForm.code}
                onChange={(e) => setRouteForm((f) => ({ ...f, code: e.target.value }))}
                style={{ flex: '1 1 120px' }}
              />
              <input
                placeholder="Start stop"
                value={routeForm.start}
                onChange={(e) => setRouteForm((f) => ({ ...f, start: e.target.value }))}
                style={{ flex: '1 1 180px' }}
              />
              <input
                placeholder="End stop"
                value={routeForm.end}
                onChange={(e) => setRouteForm((f) => ({ ...f, end: e.target.value }))}
                style={{ flex: '1 1 180px' }}
              />
              <button type="button" onClick={createRoute}>
                Save
              </button>
            </div>
          </div>
          <div className="table-wrap" style={{ gridColumn: '1 / -1' }}>
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {routes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No routes.
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
                      <td>
                        <button type="button" onClick={() => toggleRoute(r.id, r.active)}>
                          {r.active ? 'Disable' : 'Enable'}
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
              <option value="">- Matatu (optional) -</option>
              {matatus.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.number_plate} - {m.owner_name}
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
                  <th>Matatu</th>
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
          <h3 style={{ margin: 0 }}>Payments (STK)</h3>
          <button type="button" className="btn ghost" onClick={sendStk}>
            Send
          </button>
        </div>
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
        <pre className="mono" style={{ background: '#f8fafc', padding: 12 }}>{stkResp || '{}'}</pre>
      </section>

      <section className="card">
        <div className="topline">
          <h3 style={{ margin: 0 }}>Staff</h3>
          <span className="muted small">{staff.length} staff</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No staff found.
                  </td>
                </tr>
              ) : (
                staff.map((s) => (
                  <tr key={s.id || s.email}>
                    <td>{s.name || ''}</td>
                    <td>{s.phone || ''}</td>
                    <td>{s.email || ''}</td>
                    <td>{s.role || ''}</td>
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
                  <th>Daily Fee</th>
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
                  <th>Matatu</th>
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
                      <td>{row.kind}</td>
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

    </DashboardShell>
  )
}
