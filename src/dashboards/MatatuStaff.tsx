import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import DashboardShell from "../components/DashboardShell"
import { authFetch } from "../lib/auth"
import { api } from "../services/api"
import { useAuth } from "../state/auth"
import VehicleCarePage from "../modules/vehicleCare/VehicleCarePage"
import { fetchAccessGrants, type AccessGrant } from "../modules/vehicleCare/vehicleCare.api"

type Sacco = { sacco_id?: string; name?: string }
type Matatu = { id?: string; number_plate?: string; sacco_id?: string; owner_name?: string; owner_phone?: string }
type Route = { id?: string; name?: string; code?: string }
type Tx = {
  id?: string
  created_at?: string
  kind?: string
  status?: string
  matatu_id?: string
  fare_amount_kes?: number
  amount?: number
  msisdn?: string
  passenger_msisdn?: string
  notes?: string
  created_by_name?: string
  created_by_email?: string
  shift_id?: string | null
  trip_id?: string | null
  confirmed_at?: string | null
  confirmed_by?: string | null
  confirmed_shift_id?: string | null
  assigned_at?: string | null
  assigned_by?: string | null
  auto_assigned?: boolean
}
type LedgerRow = {
  id?: string
  wallet_id?: string
  direction?: "CREDIT" | "DEBIT" | string
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
type Trip = {
  id?: string
  status?: string
  started_at?: string
  ended_at?: string | null
  route_id?: string | null
  mpesa_amount?: number
  mpesa_count?: number
  cash_amount?: number
  cash_count?: number
  auto_started?: boolean
}

const fmtKES = (val?: number | null) => `KES ${(Number(val || 0)).toLocaleString("en-KE")}`
const todayKey = () => new Date().toISOString().slice(0, 10)
const manualKey = (matatuId: string) => `tt_staff_manual_${matatuId || "na"}`
const paymentKey = (p: Tx) =>
  (p.id ||
    p.created_at ||
    `${(p as any)?.msisdn || (p as any)?.payer_msisdn || (p as any)?.passenger_msisdn || "payer"}-${(p as any)?.amount || p.fare_amount_kes || "amt"}`) as string

const MatatuStaffDashboard = () => {
  const { token, user, logout } = useAuth()

  const [saccos, setSaccos] = useState<Sacco[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [matatus, setMatatus] = useState<Matatu[]>([])
  const [saccoId, setSaccoId] = useState("")
  const [routeId, setRouteId] = useState("")
  const [matatuId, setMatatuId] = useState("")

  const [txs, setTxs] = useState<Tx[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ledgerStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const ledgerEnd = new Date().toISOString().slice(0, 10)
  const [wallets, setWallets] = useState<LedgerWallet[]>([])
  const [walletError, setWalletError] = useState<string | null>(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [ledgerFrom] = useState(ledgerStart)
  const [ledgerTo] = useState(ledgerEnd)

  const [manualAmount, setManualAmount] = useState("")
  const [manualNote, setManualNote] = useState("")
  const [manualMsg, setManualMsg] = useState("")
  const [manualEntries, setManualEntries] = useState<{ id: string; amount: number; note?: string; created_at: string }[]>([])
  const [tripCashAmount, setTripCashAmount] = useState("")
  const [tripCashNote, setTripCashNote] = useState("")
  const [tripCashMsg, setTripCashMsg] = useState("")
  const [tripCashSaving, setTripCashSaving] = useState(false)
  const [staffName, setStaffName] = useState("")
  const [timeLabel, setTimeLabel] = useState("")
  const [trip, setTrip] = useState<Trip | null>(null)
  const [tripLoading, setTripLoading] = useState(false)
  const [tripError, setTripError] = useState<string | null>(null)
  const [tripHistory, setTripHistory] = useState<Trip[]>([])
  const [tripHistoryLoading, setTripHistoryLoading] = useState(false)
  const [tripHistoryError, setTripHistoryError] = useState<string | null>(null)
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null)

  const [accessGrants, setAccessGrants] = useState<AccessGrant[]>([])
  const [activeTab, setActiveTab] = useState<"live_payments" | "trips" | "transactions" | "vehicle_care">("live_payments")
  const [livePays, setLivePays] = useState<Tx[]>([])
  const [livePaysLoading, setLivePaysLoading] = useState(false)
  const [livePaysError, setLivePaysError] = useState<string | null>(null)
  const [activeShift, setActiveShift] = useState<any | null>(null)
  const [shiftLoading, setShiftLoading] = useState(false)
  const [shiftError, setShiftError] = useState<string | null>(null)
  const [shiftLoaded, setShiftLoaded] = useState(false)
  const [isMobile, setIsMobile] = useState<boolean>(() => (typeof window !== "undefined" ? window.matchMedia("(max-width: 640px)").matches : false))
  const [showEndShiftConfirm, setShowEndShiftConfirm] = useState(false)
  const [isHoldingEndShift, setIsHoldingEndShift] = useState(false)
  const [holdProgress, setHoldProgress] = useState(0)
  const [endShiftBusy, setEndShiftBusy] = useState(false)
  const holdIntervalRef = useRef<number | null>(null)
  const holdStartRef = useRef<number | null>(null)
  const appbarRef = useRef<HTMLDivElement | null>(null)
  const bottomNavRef = useRef<HTMLDivElement | null>(null)
  const bottomActionsRef = useRef<HTMLDivElement | null>(null)
  const [liveHeight, setLiveHeight] = useState<number | null>(null)
  const [liveSubTab, setLiveSubTab] = useState<"live" | "confirmed" | "unassigned">("live")
  const [confirmedPays, setConfirmedPays] = useState<Tx[]>([])
  const [confirmedLoading, setConfirmedLoading] = useState(false)
  const [confirmedError, setConfirmedError] = useState<string | null>(null)
  const [unassignedPays, setUnassignedPays] = useState<Tx[]>([])
  const [unassignedLoading, setUnassignedLoading] = useState(false)
  const [unassignedError, setUnassignedError] = useState<string | null>(null)
  const visiblePayments =
    liveSubTab === "confirmed" ? confirmedPays : liveSubTab === "unassigned" ? unassignedPays : livePays
  const isLiveView = liveSubTab === "live"
  const isConfirmedView = liveSubTab === "confirmed"
  const isUnassignedView = liveSubTab === "unassigned"
  const currentPaymentsLoading = isConfirmedView ? confirmedLoading : isUnassignedView ? unassignedLoading : livePaysLoading

  const fetchJson = useCallback(<T,>(path: string) => api<T>(path, { token }), [token])

  const loadTransactions = useCallback(async () => {
    if (!saccoId || !matatuId) {
      setTxs([])
      return
    }
    try {
      const tRes = await fetchJson<{ items?: Tx[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/transactions?limit=500`)
      const items = tRes.items || []
      let scoped = items.filter((t) => t.matatu_id === matatuId)
      if (activeShift?.opened_at) {
        const startMs = new Date(activeShift.opened_at).getTime()
        const endMs = activeShift.closed_at ? new Date(activeShift.closed_at).getTime() : Date.now()
        scoped = scoped.filter((t) => {
          const ts = t.created_at ? new Date(t.created_at).getTime() : null
          return ts !== null && ts >= startMs && ts <= endMs
        })
      }
      setTxs(scoped)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transactions")
    }
  }, [activeShift?.closed_at, activeShift?.opened_at, fetchJson, matatuId, saccoId])

  const loadWallets = useCallback(async () => {
    if (!matatuId) {
      setWallets([])
      setWalletError("No matatu assigned yet — contact SACCO admin.")
      return
    }
    setWalletLoading(true)
    setWalletError(null)
    try {
      const params = new URLSearchParams()
      params.set("limit", "100")
      const fromVal = activeShift?.opened_at ? new Date(activeShift.opened_at).toISOString() : ledgerFrom
      if (fromVal) params.set("from", fromVal)
      if (ledgerTo) params.set("to", ledgerTo)
      params.set("matatu_id", matatuId)
      const res = await authFetch(`/api/wallets/owner-ledger?${params.toString()}`, {
        headers: { Accept: "application/json" },
      })
      if (!res.ok) {
        let msg = "Failed to load wallets"
        try {
          const body = await res.json()
          if (res.status === 403 && (body?.code === "MATATU_ACCESS_DENIED" || body?.code === "SACCO_SCOPE_MISMATCH")) {
            msg = "No matatu assignment found for this account. Contact SACCO admin."
          }
        } catch {
          const text = await res.text()
          msg = text || msg
        }
        setWalletError(msg)
        setWallets([])
        return
      }
      const data = (await res.json()) as any
      setWallets(data.wallets || [])
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Failed to load wallets")
      setWallets([])
    } finally {
      setWalletLoading(false)
    }
  }, [activeShift?.opened_at, authFetch, ledgerFrom, ledgerTo, matatuId])

  useEffect(() => {
    async function loadSaccos() {
      try {
        const res = await fetchJson<{ items?: Sacco[] }>("/u/my-saccos")
        const items = res.items || []
        setSaccos(items)
        if (items.length) setSaccoId(items[0].sacco_id || "")
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load SACCOs")
      }
    }
    void loadSaccos()
  }, [fetchJson])

  useEffect(() => {
    if (user?.matatu_id) {
      setMatatuId(user.matatu_id)
    }
  }, [user?.matatu_id])

  useEffect(() => {
    if (!saccoId) return
    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const [mRes, rRes] = await Promise.all([
          fetchJson<{ items?: Matatu[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/matatus`),
          fetchJson<{ items?: Route[] }>(`/u/sacco/${encodeURIComponent(saccoId)}/routes`).catch(() => ({ items: [] })),
        ])
        const mats = mRes.items || []
        setMatatus(mats)
        if (!user?.matatu_id) setMatatuId("")
        setRoutes(rRes.items || [])
        if (!routeId && rRes.items?.length) setRouteId(rRes.items[0].id || "")
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data")
      } finally {
        setLoading(false)
      }
    }
    void loadData()
  }, [fetchJson, saccoId, routeId, user?.matatu_id])

  useEffect(() => {
    if (!saccoId) return
    if (activeTab === "transactions") {
      void loadTransactions()
      void loadWallets()
    }
  }, [activeTab, loadTransactions, loadWallets, saccoId])

  useEffect(() => {
    void (async () => {
      try {
        const items = await fetchAccessGrants()
        setAccessGrants(items)
      } catch {
        setAccessGrants([])
      }
    })()
  }, [])

  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia("(max-width: 640px)") : null
    const handler = () => setIsMobile(Boolean(mq?.matches))
    handler()
    mq?.addEventListener("change", handler)
    return () => mq?.removeEventListener("change", handler)
  }, [])

  const recomputeLiveHeight = useCallback(() => {
    if (!isMobile) {
      setLiveHeight(null)
      return
    }
    const viewportH = typeof window !== "undefined"
      ? (window.visualViewport?.height ?? window.innerHeight)
      : null
    if (!viewportH) {
      setLiveHeight(null)
      return
    }
    const headerH = appbarRef.current?.getBoundingClientRect().height ?? 0
    const navH = bottomNavRef.current?.getBoundingClientRect().height ?? 0
    const buffer = 32 // small padding/margins
    const h = Math.max(240, Math.floor(viewportH - headerH - navH - buffer))
    setLiveHeight(h)
  }, [isMobile])

useEffect(() => {
  recomputeLiveHeight()
}, [recomputeLiveHeight, activeTab, livePays.length, confirmedPays.length, isMobile])

useEffect(() => {
  const resizeHandler = () => recomputeLiveHeight()
  window.addEventListener("resize", resizeHandler)
  window.addEventListener("orientationchange", resizeHandler)
  const vv = window.visualViewport
  vv?.addEventListener("resize", resizeHandler)
  return () => {
    window.removeEventListener("resize", resizeHandler)
    window.removeEventListener("orientationchange", resizeHandler)
    vv?.removeEventListener("resize", resizeHandler)
  }
}, [recomputeLiveHeight])

  useEffect(() => {
    if (!matatuId || !user?.id) {
      setStaffName("")
      return
    }
    void (async () => {
      try {
        const res = await fetchJson<{ items?: Array<{ user_id?: string; name?: string; email?: string }> }>(
          `/u/matatu/${encodeURIComponent(matatuId)}/staff`,
        )
        const items = res.items || []
        const match =
          items.find((s) => s.user_id === user.id) ||
          items.find(
            (s) =>
              s.email &&
              user.email &&
              s.email.toString().trim().toLowerCase() === user.email.toString().trim().toLowerCase(),
          ) ||
          null
        setStaffName(match?.name || "")
      } catch {
        setStaffName("")
      }
    })()
  }, [fetchJson, matatuId, user?.id, user?.email])

  useEffect(() => {
    const updateTime = () => {
      setTimeLabel(
        new Date().toLocaleTimeString("en-KE", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      )
    }
    updateTime()
    const timer = setInterval(updateTime, 60000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(manualKey(matatuId))
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setManualEntries(parsed)
      } else {
        setManualEntries([])
      }
    } catch {
      setManualEntries([])
    }
  }, [matatuId])

  const loadTrip = useCallback(
    async (background = false) => {
      if (!matatuId) {
        setTrip(null)
        return
      }
      if (!activeShift) {
        setTrip(null)
        return
      }
      if (!background) setTripLoading(true)
      setTripError(null)
      try {
        const res = await authFetch(`/api/staff/trips/current?matatu_id=${encodeURIComponent(matatuId)}`, {
          headers: { Accept: "application/json" },
        })
        if (!res.ok) {
          if (res.status === 404) {
            setTrip(null)
          } else {
            const data = await res.json().catch(() => ({}))
            setTripError(data?.error || res.statusText || "Failed to load trip")
          }
          return
        }
        const data = await res.json().catch(() => ({}))
        setTrip(data?.trip || null)
      } catch (err) {
        setTripError(err instanceof Error ? err.message : "Failed to load trip")
      } finally {
        if (!background) setTripLoading(false)
      }
    },
    [activeShift, authFetch, matatuId],
  )

  const loadTripHistory = useCallback(async () => {
    if (!matatuId) {
      setTripHistory([])
      setTripHistoryError(null)
      setTripHistoryLoading(false)
      return
    }
    if (!activeShift) {
      setTripHistory([])
      setTripHistoryError(null)
      setTripHistoryLoading(false)
      return
    }
    setTripHistoryLoading(true)
    setTripHistoryError(null)
    try {
      const params = new URLSearchParams()
      params.set("matatu_id", matatuId)
      params.set("limit", "20")
      const res = await authFetch(`/api/staff/trips/history?${params.toString()}`, {
        headers: { Accept: "application/json" },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTripHistoryError(data?.error || res.statusText || "Failed to load trips")
        setTripHistory([])
        return
      }
      let trips = Array.isArray(data?.trips) ? data.trips : []
      if (activeShift?.opened_at) {
        const startMs = new Date(activeShift.opened_at).getTime()
        const endMs = activeShift.closed_at ? new Date(activeShift.closed_at).getTime() : Date.now()
        trips = trips.filter((t: Trip) => {
          const ts = t.started_at ? new Date(t.started_at).getTime() : null
          return ts !== null && ts >= startMs && ts <= endMs
        })
      }
      setTripHistory(trips)
    } catch (err) {
      setTripHistoryError(err instanceof Error ? err.message : "Failed to load trips")
      setTripHistory([])
    } finally {
      setTripHistoryLoading(false)
    }
  }, [activeShift, authFetch, matatuId])

  const loadPayments = useCallback(
    async (bucket: "live" | "confirmed" | "unassigned", silent?: boolean) => {
      if (!matatuId) {
        setLivePays([])
        setConfirmedPays([])
        setUnassignedPays([])
        setLivePaysError("No matatu assigned found for this account. Contact SACCO admin.")
        return
      }

      if (bucket === "confirmed") {
        setConfirmedLoading(!silent)
        setConfirmedError(null)
      } else if (bucket === "unassigned") {
        setUnassignedLoading(!silent)
        setUnassignedError(null)
      } else if (!silent) {
        setLivePaysLoading(true)
        setLivePaysError(null)
      }

      try {
        const params = new URLSearchParams()
        params.set("matatu_id", matatuId)
        params.set("limit", "50")
        params.set("bucket", bucket)
        const res = await authFetch(`/api/matatu/live-payments?${params.toString()}`, {
          headers: { Accept: "application/json" },
        })
        if (!res.ok) {
          let msg = "Failed to load payments"
          try {
            const body = await res.json().catch(() => ({}))
            if (res.status === 403 && (body?.code === "MATATU_ACCESS_DENIED" || body?.error === "forbidden")) {
              msg = "No matatu assigned found for this account. Contact SACCO admin."
            } else if (body?.error) {
              msg = body.error
            }
          } catch {
            const text = await res.text().catch(() => "")
            msg = text || msg
          }
          if (bucket === "confirmed") {
            setConfirmedError(msg)
            setConfirmedPays([])
          } else if (bucket === "unassigned") {
            setUnassignedError(msg)
            setUnassignedPays([])
          } else {
            setLivePaysError(msg)
            setLivePays([])
          }
          return
        }
        const data = await res.json().catch(() => ({}))
        const payments: Tx[] = data?.items || data?.payments || []

        if (bucket === "confirmed") setConfirmedPays(payments)
        else if (bucket === "unassigned") setUnassignedPays(payments)
        else setLivePays(payments)
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load payments"
        if (bucket === "confirmed") {
          setConfirmedError(msg)
          setConfirmedPays([])
        } else if (bucket === "unassigned") {
          setUnassignedError(msg)
          setUnassignedPays([])
        } else {
          setLivePaysError(msg)
          setLivePays([])
        }
      } finally {
        if (bucket === "confirmed") setConfirmedLoading(false)
        else if (bucket === "unassigned") setUnassignedLoading(false)
        else if (!silent) setLivePaysLoading(false)
      }
    },
    [authFetch, matatuId],
  )

  useEffect(() => {
    if (activeTab !== "live_payments") return
    if (liveSubTab === "confirmed") {
      void loadPayments("confirmed")
    } else if (liveSubTab === "unassigned") {
      void loadPayments("unassigned")
    } else {
      void loadPayments("live")
    }
  }, [activeTab, liveSubTab, loadPayments])

  const confirmPayment = useCallback(
    async (paymentId: string) => {
      if (!paymentId) return
      const target = livePays.find((p) => paymentKey(p) === paymentId)
      if (!target) return
      setLivePays((prev) => prev.filter((p) => paymentKey(p) !== paymentId))
      setConfirmedPays((prev) => [target, ...prev])
      try {
        const res = await authFetch(`/api/matatu/payments/${encodeURIComponent(paymentId)}/confirm`, {
          method: "POST",
          headers: { Accept: "application/json" },
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.error || res.statusText || "Confirm failed")
        }
      } catch (err) {
        setConfirmedPays((prev) => prev.filter((p) => paymentKey(p) !== paymentId))
        setLivePays((prev) => [target, ...prev])
        setLivePaysError(err instanceof Error ? err.message : "Confirm failed")
      }
    },
    [authFetch, livePays],
  )

  const assignPayment = useCallback(
    async (paymentId: string) => {
      if (!paymentId) return
      const target = unassignedPays.find((p) => paymentKey(p) === paymentId)
      if (!target) return
      setUnassignedPays((prev) => prev.filter((p) => paymentKey(p) !== paymentId))
      setLivePays((prev) => [{ ...target, auto_assigned: false }, ...prev])
      try {
        const res = await authFetch(`/api/matatu/payments/${encodeURIComponent(paymentId)}/assign`, {
          method: "POST",
          headers: { Accept: "application/json" },
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.error || res.statusText || "Assign failed")
        }
        const updated = (data?.item as Tx) || target
        setLivePays((prev) => [{ ...updated, auto_assigned: false }, ...prev.filter((p) => paymentKey(p) !== paymentId)])
      } catch (err) {
        setLivePays((prev) => prev.filter((p) => paymentKey(p) !== paymentId))
        setUnassignedPays((prev) => [target, ...prev])
        setUnassignedError(err instanceof Error ? err.message : "Assign failed")
      }
    },
    [authFetch, unassignedPays],
  )

  const loadActiveShift = useCallback(async () => {
    if (!matatuId) {
      setActiveShift(null)
      setShiftLoaded(true)
      return
    }
    setShiftLoading(true)
    setShiftError(null)
    try {
      const res = await authFetch("/api/matatu/shifts/active", { headers: { Accept: "application/json" } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setShiftError(data?.error || res.statusText || "Failed to load shift")
        setActiveShift(null)
      } else {
        setActiveShift(data?.shift || null)
      }
    } catch (err) {
      setShiftError(err instanceof Error ? err.message : "Failed to load shift")
      setActiveShift(null)
    } finally {
      setShiftLoading(false)
      setShiftLoaded(true)
    }
  }, [authFetch, matatuId])

  const startShiftSession = useCallback(async () => {
    if (!matatuId) {
      setShiftError("No matatu assigned found for this account. Contact SACCO admin.")
      return
    }
    setShiftLoading(true)
    setShiftError(null)
    try {
      const res = await authFetch("/api/matatu/shifts/open", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ matatu_id: matatuId || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setShiftError(data?.error || res.statusText || "Failed to start shift")
        setActiveShift(data?.shift || null)
        return
      }
      setActiveShift(data?.shift || null)
      setShiftLoaded(true)
    } catch (err) {
      setShiftError(err instanceof Error ? err.message : "Failed to start shift")
    } finally {
      setShiftLoading(false)
    }
  }, [authFetch, matatuId])

  const confirmEndShift = useCallback(async () => {
    if (!activeShift) return
    setEndShiftBusy(true)
    setShiftError(null)
    try {
      const res = await authFetch("/api/matatu/shifts/close", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ shift_id: activeShift.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setShiftError(data?.error || res.statusText || "Failed to close shift")
        return
      }
      setActiveShift(null)
      setLivePays([])
      setTrip(null)
      setTripHistory([])
      setTxs([])
      setWallets([])
    } catch (err) {
      setShiftError(err instanceof Error ? err.message : "Failed to close shift")
    } finally {
      setEndShiftBusy(false)
      setShowEndShiftConfirm(false)
    }
  }, [activeShift, authFetch])

  useEffect(() => {
    if (activeTab !== "trips" && activeTab !== "live_payments") return
    void loadTrip(true)
    if (activeTab === "trips") {
      void loadTripHistory()
    }
  }, [activeTab, loadTrip, loadTripHistory])

  useEffect(() => {
    if (activeTab !== "trips") return
    const id = setInterval(() => {
      void loadTrip(true)
      void loadTripHistory()
    }, 5000)
    return () => clearInterval(id)
  }, [activeTab, loadTrip, loadTripHistory])

  useEffect(() => {
    if (activeTab !== "live_payments") return
    // keep unassigned count fresh for banner confidence
    void loadPayments("unassigned", true)
    const id = setInterval(() => {
      void loadTrip(true)
    }, 5000)
    return () => clearInterval(id)
  }, [activeTab, loadTrip, loadPayments])

  useEffect(() => {
    let id: number | null = null
    if (activeTab === "live_payments") {
      void loadPayments(liveSubTab, false)
      if (liveSubTab === "live") {
        id = window.setInterval(() => void loadPayments("live", true), 3000)
      }
    }
    return () => {
      if (id) window.clearInterval(id)
    }
  }, [activeTab, liveSubTab, loadPayments])

  useEffect(() => {
    void loadActiveShift()
  }, [loadActiveShift])

  const startTrip = useCallback(async () => {
    if (!saccoId || !matatuId) {
      setTripError("Select SACCO and matatu first")
      return
    }
    setTripLoading(true)
    setTripError(null)
    try {
      const res = await authFetch("/api/staff/trips/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sacco_id: saccoId, matatu_id: matatuId, route_id: routeId || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.trip) setTrip(data.trip)
        setTripError(data?.error || res.statusText || "Failed to start trip")
        return
      }
      setTrip(data?.trip || null)
      void loadTripHistory()
    } catch (err) {
      setTripError(err instanceof Error ? err.message : "Failed to start trip")
    } finally {
      setTripLoading(false)
    }
  }, [authFetch, saccoId, matatuId, routeId, loadTripHistory])

  const endTrip = useCallback(async () => {
    if (!trip?.id) return
    setTripLoading(true)
    setTripError(null)
    try {
      const res = await authFetch("/api/staff/trips/end", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ trip_id: trip.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTripError(data?.error || res.statusText || "Failed to end trip")
        return
      }
      setTrip(data?.trip || null)
      void loadTripHistory()
    } catch (err) {
      setTripError(err instanceof Error ? err.message : "Failed to end trip")
    } finally {
      setTripLoading(false)
    }
  }, [authFetch, trip?.id, loadTripHistory])

  const filteredTx = useMemo(() => (matatuId ? txs.filter((t) => t.matatu_id === matatuId) : []), [txs, matatuId])
  const currentMatatu = useMemo(
    () => matatus.find((m) => m.id && m.id === matatuId) || null,
    [matatuId, matatus],
  )
  const currentSacco = useMemo(() => saccos.find((s) => s.sacco_id === saccoId) || null, [saccos, saccoId])
  const operatorLabel = currentSacco?.name || currentSacco?.sacco_id || "Unassigned"
  const assignedMatatuLabel = useMemo(() => {
    if (currentMatatu?.number_plate) return currentMatatu.number_plate
    if (currentMatatu?.id) return currentMatatu.id
    if (matatuId) return matatuId
    return "Unassigned"
  }, [currentMatatu, matatuId])
  const assignedMatatuCount = matatuId ? 1 : 0

  const transactionTotals = useMemo(() => {
    const manualLocal = manualEntries.reduce((acc, m) => acc + Number(m.amount || 0), 0)
    let manualCash = 0
    let mpesa = 0
    let mpesaCount = 0
    let walletTotal = 0
    let withdrawals = 0
    let withdrawalsCount = 0
    let autoFees = 0
    let autoFeesCount = 0
    let dailyFee = 0
    let savings = 0
    let loans = 0
    wallets.forEach((w) => {
      walletTotal += Number(w.balance || 0)
    })
    filteredTx.forEach((t) => {
      const kind = (t.kind || "").toUpperCase()
      const amount = Number(t.fare_amount_kes || 0)
      if (kind === "CASH") manualCash += amount
      if (kind === "SACCO_FEE" || kind === "DAILY_FEE") dailyFee += amount
      if (kind === "SAVINGS") savings += amount
      if (kind === "LOAN_REPAY") loans += amount
      if (kind === "WITHDRAW" || kind === "WITHDRAWAL") {
        withdrawals += amount
        withdrawalsCount += 1
      }
      if (kind === "AUTO_FEE" || kind === "DAILY_FEE") {
        autoFees += amount
        autoFeesCount += 1
      }
      if (!["CASH", "SACCO_FEE", "DAILY_FEE", "SAVINGS", "LOAN_REPAY"].includes(kind)) {
        mpesa += amount
        mpesaCount += 1
      }
    })
    const manualTotal = manualCash + manualLocal
    const accountTotal = dailyFee + savings + loans
    return {
      manualCash: manualTotal,
      mpesa,
      mpesaCount,
      walletTotal,
      withdrawals,
      withdrawalsCount,
      autoFees,
      autoFeesCount,
      dailyFee,
      savings,
      loans,
      accountTotal,
      collectedTotal: manualTotal + accountTotal + mpesa,
    }
  }, [filteredTx, manualEntries, wallets])

  const ownerScopeId = user?.matatu_id || ""
  const vehicleCareGrant = useMemo(
    () =>
      accessGrants.find(
        (grant) => grant.scope_type === "OWNER" && String(grant.scope_id || "") === String(ownerScopeId || "")
      ) || null,
    [accessGrants, ownerScopeId],
  )
  const hasVehicleCareAccess = Boolean(vehicleCareGrant)
  const canManageVehicleCare = Boolean(vehicleCareGrant?.can_manage_vehicle_care)
  const canManageCompliance = Boolean(vehicleCareGrant?.can_manage_compliance)
  const canViewVehicleCareAnalytics = vehicleCareGrant?.can_view_analytics !== false


  async function recordManualCash() {
    if (!saccoId || !matatuId) {
      setManualMsg("Missing SACCO or assigned matatu")
      return
    }
    const amt = Number(manualAmount || 0)
    if (!(amt > 0)) {
      setManualMsg("Enter amount")
      return
    }
    setManualMsg("Saving...")
    try {
      await api("/api/staff/cash", {
        method: "POST",
        body: {
          sacco_id: saccoId,
          matatu_id: matatuId,
          kind: "CASH",
          amount: amt,
          payer_name: manualNote.trim() || "Manual cash entry",
          payer_phone: "",
        },
        token,
      })
      const entry = { id: `MAN_${Date.now()}`, amount: amt, note: manualNote, created_at: new Date().toISOString() }
      const next = [entry, ...manualEntries]
      setManualEntries(next)
      localStorage.setItem(manualKey(matatuId), JSON.stringify(next))
      setManualAmount("")
      setManualNote("")
      setManualMsg("Saved")
    } catch (err) {
      setManualMsg(err instanceof Error ? err.message : "Save failed")
    }
  }

  const recordTripCash = useCallback(async () => {
    if (!saccoId || !matatuId) {
      setTripCashMsg("Select SACCO and matatu first")
      return
    }
    const amt = Number(tripCashAmount || 0)
    if (!(amt > 0)) {
      setTripCashMsg("Enter amount")
      return
    }
    setTripCashSaving(true)
    setTripCashMsg("Saving...")
    try {
      const res = await authFetch("/api/staff/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sacco_id: saccoId,
          matatu_id: matatuId,
          kind: "CASH",
          amount: amt,
          payer_name: tripCashNote.trim() || "Trip cash entry",
          payer_phone: "",
          notes: tripCashNote || "",
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTripCashMsg(data?.error || res.statusText || "Save failed")
        return
      }
      setTripCashMsg("Saved")
      setTripCashAmount("")
      setTripCashNote("")
      await loadTrip(true)
      await loadTripHistory()
    } catch (err) {
      setTripCashMsg(err instanceof Error ? err.message : "Save failed")
    } finally {
      setTripCashSaving(false)
    }
  }, [authFetch, saccoId, matatuId, tripCashAmount, tripCashNote, loadTrip, loadTripHistory])

  function refresh() {
    if (activeTab === "transactions") {
      void loadTransactions()
      void loadWallets()
    }
    if (activeTab === "trips") {
      void loadTrip(true)
      void loadTripHistory()
    }
    if (activeTab === "live_payments") {
      void loadActiveShift()
      void loadPayments(liveSubTab)
    }
  }

  const staffLabel = staffName || user?.name || (user?.email ? user.email.split("@")[0] : "") || "Staff"
  const heroRight = activeShift?.opened_at
    ? `On shift • opened ${new Date(activeShift.opened_at).toLocaleTimeString("en-KE")}`
    : user?.role
      ? `Role: ${user.role}`
      : "Matatu Staff"
  const heroSection = (
    <div className="hero-bar" style={{ marginBottom: 16 }}>
      <div className="hero-left">
        <div className="hero-chip">MATATU STAFF</div>
        <h2 style={{ margin: "6px 0 4px" }}>Hello, {staffLabel}</h2>
        <div className="muted">Staff dashboard overview</div>
        <div className="hero-inline">
          <span className="sys-pill-lite">Operate Under: {operatorLabel}</span>
          <span className="sys-pill-lite">{todayKey()}</span>
          <span className="sys-pill-lite">{timeLabel}</span>
          <span className="sys-pill-lite">{assignedMatatuCount} matatu(s)</span>
        </div>
      </div>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <div className="badge-ghost">{heroRight}</div>
        <button type="button" className="btn btn-danger" onClick={logout}>
          Logout
        </button>
      </div>
    </div>
  )

  const appbar = (
    <div className="ms-appbar" ref={appbarRef}>
      <div className="ms-appbar-row">
          <div className="ms-appbar-left">
            <div className="ms-appbar-title">MATATU STAFF</div>
            <div className="ms-appbar-name">{staffLabel}</div>
          </div>
          <div className="ms-appbar-right">
            <span className={`ms-pill ${activeShift ? "on" : "off"}`}>{activeShift ? "Shift on" : "Shift off"}</span>
            {activeShift ? (
              <button
                type="button"
                className={`btn btn-danger ms-endshift-btn ms-endshift-header${isHoldingEndShift ? " holding" : ""}`}
                disabled={endShiftBusy}
                onPointerDown={
                  isMobile
                    ? () => {
                        if (endShiftBusy || !activeShift) return
                      setIsHoldingEndShift(true)
                      holdStartRef.current = Date.now()
                      holdIntervalRef.current = window.setInterval(() => {
                        if (!holdStartRef.current) return
                        const elapsed = Date.now() - holdStartRef.current
                        const pct = Math.min(100, (elapsed / 3000) * 100)
                        setHoldProgress(pct)
                        if (elapsed >= 3000) {
                          if (holdIntervalRef.current) window.clearInterval(holdIntervalRef.current)
                          holdIntervalRef.current = null
                          holdStartRef.current = null
                          setIsHoldingEndShift(false)
                          setHoldProgress(100)
                          setShowEndShiftConfirm(true)
                        }
                      }, 50)
                    }
                  : undefined
              }
              onPointerUp={
                isMobile
                  ? () => {
                      if (holdIntervalRef.current) window.clearInterval(holdIntervalRef.current)
                      holdIntervalRef.current = null
                      holdStartRef.current = null
                      setIsHoldingEndShift(false)
                      setHoldProgress(0)
                    }
                  : undefined
              }
              onPointerLeave={
                isMobile
                  ? () => {
                      if (holdIntervalRef.current) window.clearInterval(holdIntervalRef.current)
                      holdIntervalRef.current = null
                      holdStartRef.current = null
                      setIsHoldingEndShift(false)
                      setHoldProgress(0)
                    }
                  : undefined
              }
              onClick={
                isMobile
                  ? undefined
                  : () => {
                      if (endShiftBusy) return
                      setShowEndShiftConfirm(true)
                    }
              }
              style={
                isMobile
                  ? {
                      background: `linear-gradient(90deg, rgba(255,77,79,0.9) ${holdProgress}%, rgba(255,77,79,0.25) ${holdProgress}%)`,
                    }
                  : undefined
              }
            >
              {isMobile ? (isHoldingEndShift ? "Hold 3s…" : "End shift") : "End shift"}
            </button>
          ) : null}
          <button type="button" className="btn btn-danger" onClick={logout}>
            Logout
          </button>
        </div>
      </div>
      <div className="ms-appbar-row ms-appbar-chips">
        <span className="ms-chip">{operatorLabel}</span>
        <span className="ms-chip">{assignedMatatuLabel}</span>
        <span className="ms-chip">{trip?.status ? `Trip: ${trip.status}` : "Trip: none"}</span>
      </div>
    </div>
  )

  if (shiftLoaded && !activeShift) {
    return (
      <DashboardShell title="Matatu Staff" subtitle="Staff Dashboard" navLabel="Matatu navigation" hideShellChrome>
        <div className="app-header sticky">
          <div className="ms-header-hero">{heroSection}</div>
        </div>
        {isMobile ? appbar : null}
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Start Shift</h3>
            {shiftLoading ? <span className="muted small">Loading shift...</span> : null}
          </div>
          <p className="muted">Start your shift to view live payments and record cash.</p>
          {shiftError ? <div className="err">{shiftError}</div> : null}
          <button type="button" className="btn btn-start" disabled={shiftLoading || !matatuId} onClick={startShiftSession}>
            {shiftLoading ? "Starting..." : "Start Shift"}
          </button>
        </section>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell title="Matatu Staff" subtitle="Staff Dashboard" navLabel="Matatu navigation" hideShellChrome>
      <div className="app-header sticky">
        <div className="ms-header-hero">{heroSection}</div>
      </div>
      {isMobile ? appbar : null}
      {isMobile && activeShift ? (
        <div className="ms-bottom-actions" ref={bottomActionsRef}>
          <span className="ms-chip">Shift on</span>
          <button
            type="button"
            className={`btn btn-danger ms-endshift-btn${isHoldingEndShift ? " holding" : ""}`}
            disabled={endShiftBusy}
            onPointerDown={() => {
              if (endShiftBusy || !activeShift) return
              setIsHoldingEndShift(true)
              holdStartRef.current = Date.now()
              holdIntervalRef.current = window.setInterval(() => {
                if (!holdStartRef.current) return
                const elapsed = Date.now() - holdStartRef.current
                const pct = Math.min(100, (elapsed / 3000) * 100)
                setHoldProgress(pct)
                if (elapsed >= 3000) {
                  if (holdIntervalRef.current) window.clearInterval(holdIntervalRef.current)
                  holdIntervalRef.current = null
                  holdStartRef.current = null
                  setIsHoldingEndShift(false)
                  setHoldProgress(100)
                  setShowEndShiftConfirm(true)
                }
              }, 50)
            }}
            onPointerUp={() => {
              if (holdIntervalRef.current) window.clearInterval(holdIntervalRef.current)
              holdIntervalRef.current = null
              holdStartRef.current = null
              setIsHoldingEndShift(false)
              setHoldProgress(0)
            }}
            onPointerLeave={() => {
              if (holdIntervalRef.current) window.clearInterval(holdIntervalRef.current)
              holdIntervalRef.current = null
              holdStartRef.current = null
              setIsHoldingEndShift(false)
              setHoldProgress(0)
            }}
            style={{
              background: `linear-gradient(90deg, rgba(255,77,79,0.9) ${holdProgress}%, rgba(255,77,79,0.25) ${holdProgress}%)`,
            }}
          >
            {isHoldingEndShift ? "Hold 3s…" : "End shift"}
          </button>
        </div>
      ) : null}

      {showEndShiftConfirm && (
        <div className="ms-confirm-backdrop">
          <div className="ms-confirm-modal">
            <h4>End shift?</h4>
            <p className="muted small">This will close the day and deposit today’s collections. Continue?</p>
            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn ghost" onClick={() => setShowEndShiftConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" disabled={shiftLoading} onClick={() => void confirmEndShift()}>
                {shiftLoading || endShiftBusy ? "Closing..." : "End shift"}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="card ms-context-panel" style={{ paddingBottom: 10 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label>
            <div className="muted small">Route</div>
            <select value={routeId} onChange={(e) => setRouteId(e.target.value)} style={{ minWidth: 180, padding: 10 }}>
              {routes.map((r) => (
                <option key={r.id || r.code} value={r.id || r.code || ""}>
                  {r.code ? `${r.code} - ${r.name}` : r.name || r.id}
                </option>
              ))}
              {!routes.length ? <option value="">- no routes -</option> : null}
            </select>
          </label>
          <label>
            <div className="muted small">SACCO</div>
            <select value={saccoId} onChange={(e) => setSaccoId(e.target.value)} style={{ minWidth: 160, padding: 10 }}>
              {saccos.map((s) => (
                <option key={s.sacco_id} value={s.sacco_id || ""}>
                  {s.name || s.sacco_id}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div className="muted small">Assigned Matatu</div>
            <input className="input" value={assignedMatatuLabel} readOnly style={{ minWidth: 160 }} />
          </label>
          <button type="button" className="btn ghost" onClick={refresh}>
            Reload
          </button>
          {loading ? <span className="muted small">Loading...</span> : null}
          {error ? <span className="err">{error}</span> : null}
        </div>
      </section>

      <nav className="sys-nav ms-top-tabs" aria-label="Matatu staff sections">
        {[
          { id: "live_payments", label: "Live Payments" },
          { id: "trips", label: "Trips" },
          { id: "transactions", label: "Transactions" },
          { id: "vehicle_care", label: "Vehicle Care" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={`sys-tab${activeTab === t.id ? " active" : ""}`}
            onClick={() => setActiveTab(t.id as typeof activeTab)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {isMobile ? (
        <nav className="bottom-nav" aria-label="Matatu staff mobile nav" ref={bottomNavRef}>
          {[
            { id: "live_payments", label: "Live" },
            { id: "trips", label: "Trips" },
            { id: "transactions", label: "Txns" },
            { id: "vehicle_care", label: "Care" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              className={`bottom-nav-btn${activeTab === t.id ? " active" : ""}`}
              onClick={() => setActiveTab(t.id as typeof activeTab)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      ) : null}

      {activeTab === "live_payments" ? (
        <section
          className="card ms-live-card"
          style={isMobile && liveHeight ? { height: liveHeight } : undefined}
        >
          <div className="ms-live-stickyhead">
            <div className="ms-live-head">
              <div>
                <h3 style={{ margin: 0 }}>Live Payments (Current Trip)</h3>
                <div className="muted small ms-live-sub">
                  Shows payments only for the active trip.{activeShift?.opened_at ? ` Shift opened at ${new Date(activeShift.opened_at).toLocaleTimeString("en-KE")}.` : ""}
                </div>
                {unassignedPays.length > 0 ? (
                  <div className="muted small" style={{ color: "#d97706", marginTop: 4 }}>
                    ⚠ {unassignedPays.length} unassigned payments. Review in Unassigned.
                  </div>
                ) : null}
              </div>
              <div className="ms-live-head-actions">
                <button className="btn ms-refresh-btn" type="button" onClick={() => void loadPayments(liveSubTab)}>
                  {currentPaymentsLoading ? <span className="spinner small" aria-hidden /> : null}
                  <span>Refresh</span>
                </button>
          {livePaysError && liveSubTab === "live" ? <span className="err small">{livePaysError}</span> : null}
          {confirmedError && liveSubTab === "confirmed" ? <span className="err small">{confirmedError}</span> : null}
          {unassignedError && liveSubTab === "unassigned" ? <span className="err small">{unassignedError}</span> : null}
        </div>
      </div>
      <div className="ms-live-subtabs">
        {[
          { id: "live", label: "Live" },
          { id: "confirmed", label: "Confirmed" },
          { id: "unassigned", label: "Unassigned" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ms-live-subtab${liveSubTab === t.id ? " active" : ""}`}
            onClick={() => setLiveSubTab(t.id as typeof liveSubTab)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <span
          className="badge"
          style={{
            background: activeShift ? "#ecfdf3" : "#fef3c7",
            color: activeShift ? "#166534" : "#92400e",
            border: "1px solid rgba(0,0,0,0.08)",
          }}
        >
          Shift {activeShift ? "ON" : "OFF"} {activeShift?.auto_opened ? "• AUTO" : ""}
        </span>
        <span
          className="badge"
          style={{
            background: trip ? "#eff6ff" : "#fef3c7",
            color: trip ? "#1d4ed8" : "#92400e",
            border: "1px solid rgba(0,0,0,0.08)",
          }}
        >
          Trip {trip ? "ON" : "OFF"} {trip?.auto_started ? "• AUTO" : ""}
        </span>
      </div>
    </div>
          <div className="ms-live-scroll">
            {!matatuId ? (
              <div className="muted small" style={{ marginTop: 8 }}>
                No matatu assigned found for this account. Contact SACCO admin.
              </div>
            ) : !trip ? (
              <div className="muted small" style={{ marginTop: 8 }}>
                No active trip. Start a trip in Trips tab.
              </div>
            ) : (
              <>
                {!isMobile ? (
                  <div className="table-wrap" style={{ marginTop: 12 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Payer</th>
                          <th>Amount</th>
                          {isConfirmedView ? <th>Status</th> : <th>Action</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {visiblePayments.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="muted">
                              {(isLiveView
                                ? livePaysLoading
                                : isConfirmedView
                                ? confirmedLoading
                                : unassignedLoading) ? (
                                <span className="spinner small" aria-label="Loading payments" />
                              ) : isLiveView ? (
                                "No payments yet."
                              ) : isConfirmedView ? (
                                "No confirmed payments."
                              ) : (
                                "No unassigned payments."
                              )}
                            </td>
                          </tr>
                        ) : (
                          visiblePayments.map((p) => {
                            const key = paymentKey(p)
                            const t = p.created_at
                              ? new Date(p.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })
                              : "-"
                            const nameParts = [
                              (p as any)?.sender_name,
                              (p as any)?.payer_name,
                              (p as any)?.created_by_name,
                            ].filter(Boolean)
                            const uniqueNames = nameParts.filter((v, i, arr) => arr.indexOf(v) === i)
                            const nameDisplay = uniqueNames.slice(0, 2).join(" • ")
                            const msisdn = (p as any)?.payer_msisdn || p.msisdn || p.passenger_msisdn || null
                            const identity = nameDisplay || msisdn || "-"
                            const amt = fmtKES((p as any)?.amount || p.fare_amount_kes)
                            const offShift = !p.shift_id
                            const offTrip = !p.trip_id
                            return (
                              <tr key={key}>
                                <td>{t}</td>
                                <td>{identity}</td>
                                <td>{amt}</td>
                                <td>
                                  {isLiveView ? (
                                    <button
                                      type="button"
                                      className="btn ghost small ms-credit-btn"
                                      onClick={() => void confirmPayment(key)}
                                    >
                                      Confirm
                                    </button>
                                  ) : isConfirmedView ? (
                                    <span className="ms-pay-confirmed">Confirmed ✓</span>
                                  ) : (
                                    <div className="row" style={{ gap: 6, alignItems: "center" }}>
                                      <div className="row" style={{ gap: 4 }}>
                                        {offShift ? <span className="badge warn">OFF SHIFT</span> : null}
                                        {offTrip ? <span className="badge warn">OFF TRIP</span> : null}
                                      </div>
                                      <button
                                        type="button"
                                        className="btn ghost small ms-credit-btn"
                                        onClick={() => void assignPayment(key)}
                                      >
                                        Assign
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="live-cards">
                    {visiblePayments.length === 0 ? (
                      <div className="muted small">
                        {(isLiveView
                          ? livePaysLoading
                          : isConfirmedView
                          ? confirmedLoading
                          : unassignedLoading) ? (
                          <span className="spinner small" aria-label="Loading payments" />
                        ) : isLiveView ? (
                          "No payments yet."
                        ) : isConfirmedView ? (
                          confirmedError || "No confirmed payments."
                        ) : (
                          unassignedError || "No unassigned payments."
                        )}
                      </div>
                    ) : (
                      visiblePayments.map((p) => {
                        const t = p.created_at
                          ? new Date(p.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })
                          : "-"
                        const amt = fmtKES((p as any)?.amount || p.fare_amount_kes)
                        const key = paymentKey(p)
                        const nameParts = [
                          (p as any)?.sender_name,
                          (p as any)?.payer_name,
                          (p as any)?.created_by_name,
                        ].filter(Boolean)
                        const uniqueNames = nameParts.filter((v, i, arr) => arr.indexOf(v) === i)
                        const nameDisplay = uniqueNames.slice(0, 2).join(" • ")
                        const msisdn = (p as any)?.payer_msisdn || p.msisdn || p.passenger_msisdn || null
                        const identity = nameDisplay || msisdn || "-"
                        const offShift = !p.shift_id
                        const offTrip = !p.trip_id
                        return (
                          <div key={key} className="live-card ms-pay-card">
                            <div className="ms-pay-main">
                              <div className="live-card-amount ms-pay-amount">{amt}</div>
                              <div className="ms-pay-meta">
                                <span>{identity}</span>
                                <span className="ms-pay-sep">•</span>
                                <span className="mono">{t}</span>
                              </div>
                            </div>
                            {isLiveView ? (
                              <button
                                type="button"
                                className="btn ghost small ms-credit-btn ms-pay-action"
                                onClick={() => void confirmPayment(key)}
                              >
                                Confirm
                              </button>
                            ) : isConfirmedView ? (
                              <span className="ms-pay-confirmed">Confirmed ✓</span>
                            ) : (
                              <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                <div className="row" style={{ gap: 4 }}>
                                  {offShift ? <span className="badge warn">OFF SHIFT</span> : null}
                                  {offTrip ? <span className="badge warn">OFF TRIP</span> : null}
                                </div>
                                <button
                                  type="button"
                                  className="btn ghost small ms-credit-btn ms-pay-action"
                                  onClick={() => void assignPayment(key)}
                                >
                                  Assign
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      ) : null}


      {activeTab === "trips" ? (
        <section className="card">
          <div className="topline">
            <h3 style={{ margin: 0 }}>Trips</h3>
            <span className="muted small">Route {routeId || "n/a"} - Matatu {assignedMatatuLabel}</span>
          </div>
          <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {!trip || trip?.status === "ENDED" ? (
              <button type="button" className="btn btn-start" disabled={tripLoading || !matatuId} onClick={startTrip}>
                {tripLoading ? "Starting..." : "Start Trip"}
              </button>
            ) : (
              <button type="button" className="btn btn-danger" disabled={tripLoading} onClick={endTrip}>
                {tripLoading ? "Ending..." : "End Trip"}
              </button>
            )}
            <span className="muted small">
              {trip
                ? trip.status === "ENDED"
                  ? `Ended ${trip.ended_at ? new Date(trip.ended_at).toLocaleTimeString("en-KE") : ""}`
                  : `Started ${trip.started_at ? new Date(trip.started_at).toLocaleTimeString("en-KE") : ""}`
                : "Start and end trips for the selected route."}
            </span>
            {tripError ? <span className="err">{tripError}</span> : null}
          </div>
          {trip ? (
            <div className="grid g3" style={{ gap: 12, marginTop: 12 }}>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">M-Pesa payments</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtKES(trip.mpesa_amount)}</div>
                <div className="muted small">Count: {trip.mpesa_count ?? 0}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Manual cash</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtKES(trip.cash_amount)}</div>
                <div className="muted small">Entries: {trip.cash_count ?? 0}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Status</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{(trip.status || "").replaceAll("_", " ")}</div>
                <div className="muted small">
                  {trip.started_at ? new Date(trip.started_at).toLocaleString("en-KE") : ""}{" "}
                  {trip.ended_at ? `-> ${new Date(trip.ended_at).toLocaleTimeString("en-KE")}` : "(in progress)"}
                </div>
                <div className="muted small">Total: {fmtKES(Number(trip.mpesa_amount || 0) + Number(trip.cash_amount || 0))}</div>
              </div>
            </div>
          ) : (
            <div className="muted small" style={{ marginTop: 12 }}>
              No trip running. Start a trip to track collections.
            </div>
          )}

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
            <div className="topline" style={{ alignItems: "center" }}>
              <div>
                <div className="muted small">Manual cash during trip</div>
                <div style={{ fontWeight: 600 }}>Record cash collected</div>
              </div>
              <span className="muted small">{tripCashMsg}</span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
              <input
                type="number"
                placeholder="Amount (KES)"
                value={tripCashAmount}
                onChange={(e) => setTripCashAmount(e.target.value)}
                style={{ width: 180 }}
              />
              <input
                placeholder="Note / payer name (optional)"
                value={tripCashNote}
                onChange={(e) => setTripCashNote(e.target.value)}
                style={{ flex: "1 1 240px" }}
              />
              <button
                type="button"
                className="btn"
                disabled={tripCashSaving || !matatuId}
                onClick={() => void recordTripCash()}
              >
                {tripCashSaving ? "Saving..." : "Record Trip Cash"}
              </button>
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              Adds a CASH entry against this matatu and counts it in the current trip totals.
            </div>
          </div>

          <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
            <div className="topline" style={{ alignItems: "center" }}>
              <div>
                <div className="muted small">Trip history</div>
                <div style={{ fontWeight: 600 }}>Recent trips with M-Pesa + cash totals</div>
              </div>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                {tripHistoryLoading ? <span className="muted small">Loading...</span> : null}
                {tripHistoryError ? <span className="err">{tripHistoryError}</span> : null}
                <button type="button" className="btn ghost" onClick={() => { void loadTrip(true); void loadTripHistory(); }}>
                  Refresh
                </button>
              </div>
            </div>
            {!isMobile ? (
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Start</th>
                      <th>End</th>
                      <th>Status</th>
                      <th>Paybill (M-Pesa)</th>
                      <th>Cash</th>
                      <th>Total</th>
                      <th>Entries</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tripHistory.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="muted">
                          No trips yet.
                        </td>
                      </tr>
                    ) : (
                      tripHistory.map((t) => {
                        const total = Number(t.mpesa_amount || 0) + Number(t.cash_amount || 0)
                        return (
                          <tr key={t.id || t.started_at}>
                            <td>{t.started_at ? new Date(t.started_at).toLocaleString("en-KE") : "-"}</td>
                            <td>
                              {t.ended_at
                                ? new Date(t.ended_at).toLocaleString("en-KE")
                                : t.status === "IN_PROGRESS"
                                ? "In progress"
                                : "-"}
                            </td>
                            <td>{(t.status || "").replaceAll("_", " ")}</td>
                            <td>{fmtKES(t.mpesa_amount)}</td>
                            <td>{fmtKES(t.cash_amount)}</td>
                            <td>{fmtKES(total)}</td>
                            <td className="muted small">
                              M-Pesa: {t.mpesa_count ?? 0} / Cash: {t.cash_count ?? 0}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="live-cards" style={{ marginTop: 10 }}>
                {tripHistory.length === 0 ? (
                  <div className="muted small">No trips yet.</div>
                ) : (
                  tripHistory.map((t) => {
                    const startLabel = t.started_at
                      ? new Date(t.started_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })
                      : "-"
                    const endLabel = t.ended_at
                      ? new Date(t.ended_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })
                      : t.status === "IN_PROGRESS"
                      ? "In progress"
                      : "-"
                    const key = t.id || t.started_at || Math.random().toString(36)
                    const expanded = expandedTripId === key
                    const total = Number(t.mpesa_amount || 0) + Number(t.cash_amount || 0)
                    return (
                      <div key={key} className="live-card" style={{ padding: 12 }}>
                        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <div>
                            <div className="muted mini">Start</div>
                            <div style={{ fontWeight: 700 }}>{startLabel}</div>
                          </div>
                          <div>
                            <div className="muted mini">End</div>
                            <div style={{ fontWeight: 700 }}>{endLabel}</div>
                          </div>
                          <button
                            type="button"
                            className="ms-trip-view"
                            onClick={() => setExpandedTripId(expanded ? null : (key as string))}
                          >
                            {expanded ? "Hide" : "View"}
                          </button>
                        </div>
                        {expanded ? (
                          <div className="muted small" style={{ marginTop: 8, display: "grid", gap: 4 }}>
                            <div>Status: {(t.status || "").replaceAll("_", " ")}</div>
                            <div>M-Pesa: {fmtKES(t.mpesa_amount)} (count {t.mpesa_count ?? 0})</div>
                            <div>Cash: {fmtKES(t.cash_amount)} (count {t.cash_count ?? 0})</div>
                            <div>Total: {fmtKES(total)}</div>
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </section>
      ) : null}
      {activeTab === "transactions" ? (
        <>
          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Collections summary</h3>
              <button type="button" className="btn ghost" onClick={refresh}>
                Reload
              </button>
            </div>
            {walletLoading ? <div className="muted small">Loading wallet balances...</div> : null}
            {walletError ? <div className="err">{walletError}</div> : null}
            <div
              className="grid"
              style={{ gap: 12, marginTop: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
            >
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Manual cash collected</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKES(transactionTotals.manualCash)}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">M-Pesa collected</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKES(transactionTotals.mpesa)}</div>
                <div className="muted small">Count: {transactionTotals.mpesaCount}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Account deductions</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKES(transactionTotals.accountTotal)}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Total collected</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKES(transactionTotals.collectedTotal)}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Wallet balance total</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKES(transactionTotals.walletTotal)}</div>
              </div>
            </div>
            <div className="grid g3" style={{ gap: 12, marginTop: 12 }}>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Daily fee deducted</div>
                <div style={{ fontWeight: 700 }}>{fmtKES(transactionTotals.dailyFee)}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Savings deducted</div>
                <div style={{ fontWeight: 700 }}>{fmtKES(transactionTotals.savings)}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Loan repayments</div>
                <div style={{ fontWeight: 700 }}>{fmtKES(transactionTotals.loans)}</div>
              </div>
            </div>

            <div className="grid g4" style={{ gap: 12, marginTop: 12 }}>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Withdrawals</div>
                <div style={{ fontWeight: 700 }}>{fmtKES(transactionTotals.withdrawals)}</div>
                <div className="muted small">Count: {transactionTotals.withdrawalsCount}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Auto fee / Daily fee</div>
                <div style={{ fontWeight: 700 }}>{fmtKES(transactionTotals.autoFees)}</div>
                <div className="muted small">Count: {transactionTotals.autoFeesCount}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Savings deducted</div>
                <div style={{ fontWeight: 700 }}>{fmtKES(transactionTotals.savings)}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="muted small">Loan repayments</div>
                <div style={{ fontWeight: 700 }}>{fmtKES(transactionTotals.loans)}</div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Manual cash entry</h3>
              <span className="muted small">{manualMsg}</span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <input
                type="number"
                placeholder="Amount (KES)"
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
                style={{ width: 180 }}
              />
              <input
                placeholder="Note (optional)"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                style={{ flex: "1 1 260px" }}
              />
              <button type="button" onClick={recordManualCash}>
                Record Cash
              </button>
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              Records cash directly against the current matatu without affecting trip states.
            </div>
            {manualEntries.length ? (
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Amount</th>
                      <th>Note</th>
                      <th>ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualEntries.map((e) => (
                      <tr key={e.id}>
                        <td>{new Date(e.created_at).toLocaleString()}</td>
                        <td>{fmtKES(e.amount)}</td>
                        <td>{e.note || ""}</td>
                        <td className="mono">{e.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="card">
            <div className="topline">
              <h3 style={{ margin: 0 }}>Transactions</h3>
              <span className="muted small">{filteredTx.length} record(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Payer</th>
                    <th>Phone</th>
                    <th>Kind</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTx.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        No transactions in range.
                      </td>
                    </tr>
                  ) : (
                    filteredTx.map((tx) => (
                      <tr key={tx.id || tx.created_at}>
                        <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ""}</td>
                        <td>{(tx.notes || "").trim() || tx.created_by_name || tx.created_by_email || "-"}</td>
                        <td className="mono">{tx.passenger_msisdn || tx.msisdn || "-"}</td>
                        <td>{tx.kind || ""}</td>
                        <td>{fmtKES(tx.fare_amount_kes)}</td>
                        <td>{tx.status || ""}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
      {activeTab === "vehicle_care" ? (
        hasVehicleCareAccess && ownerScopeId ? (
          <VehicleCarePage
            context={{
              scope_type: "OWNER",
              scope_id: ownerScopeId,
              can_manage_vehicle_care: canManageVehicleCare,
              can_manage_compliance: canManageCompliance,
              can_view_analytics: canViewVehicleCareAnalytics,
            }}
          />
        ) : (
          <section className="card">
            <div className="muted">Vehicle Care access is not enabled. Contact your owner.</div>
          </section>
        )
      ) : null}

    </DashboardShell>
  )
}

export default MatatuStaffDashboard
