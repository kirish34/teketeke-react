import { useCallback, useEffect, useState } from "react"
import { authFetch } from "../lib/auth"

type WalletResponse = {
  ok: boolean
  wallet?: {
    wallet_id: string
    account_number?: string | null
    wallet_code?: string | null
    virtual_account_code?: string | null
    paybill?: string | null
    entity_type?: string | null
    entity_id?: string | null
    balance?: number | null
    created_at?: string | null
  }
  error?: string
  code?: string
  request_id?: string | null
}

export function useEntityWallet(kind: "taxi" | "boda") {
  const [wallet, setWallet] = useState<WalletResponse["wallet"] | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(`/api/${kind}/wallet`, { headers: { Accept: "application/json" } })
      if (!res.ok) {
        const text = await res.text()
        const msg = text || res.statusText
        if (res.status === 403) {
          setError("No access / not assigned. Contact operator admin.")
        } else {
          setError(msg || "Failed to load wallet")
        }
        setWallet(null)
        return
      }
      const data = (await res.json()) as WalletResponse
      setWallet(data.wallet || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load wallet")
      setWallet(null)
    } finally {
      setLoading(false)
    }
  }, [kind])

  useEffect(() => {
    void load()
  }, [load])

  return { wallet, loading, error, refresh: load }
}
