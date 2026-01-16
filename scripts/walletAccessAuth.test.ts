import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type TableRows = Record<string, any[]>

function createSupabaseMock(tables: TableRows) {
  const builder = (table: string) => {
    let rows = tables[table] || []
    const api = {
      select: () => api,
      eq: (field: string, value: any) => {
        rows = rows.filter((r) => String(r[field] ?? '') === String(value ?? ''))
        return api
      },
      in: (field: string, values: any[]) => {
        rows = rows.filter((r) => values.includes(r[field]))
        return api
      },
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: rows[0] || null, error: null }),
    }
    return api
  }

  return {
    from: (table: string) => builder(table),
    auth: { admin: {} },
  }
}

function createPoolMock(store: { matatus: any[]; wallets: any[]; walletLedger: any[] }) {
  const query = vi.fn(async (text: string, params: any[] = []) => {
    const sql = text.toLowerCase()
    if (sql.includes('from matatus')) {
      if (sql.includes('where id = $1')) {
        const row = store.matatus.find((m) => String(m.id) === String(params[0]))
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }
      }
    }

    if (sql.includes('from wallets')) {
      if (sql.includes('where id = $1')) {
        const row = store.wallets.find((w) => String(w.id) === String(params[0]))
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }
      }
      if (sql.includes('where matatu_id = $1')) {
        const kind = params[1] || null
        const rows = store.wallets.filter(
          (w) =>
            String(w.matatu_id) === String(params[0]) &&
            ['MATATU_OWNER', 'MATATU_VEHICLE'].includes(w.wallet_kind) &&
            (kind === null || kind === '' || w.wallet_kind === kind),
        )
        return { rows, rowCount: rows.length }
      }
      if (sql.includes('where sacco_id = $1')) {
        const kind = params[1] || null
        const rows = store.wallets.filter(
          (w) =>
            String(w.sacco_id) === String(params[0]) &&
            ['SACCO_FEE', 'SACCO_LOAN', 'SACCO_SAVINGS'].includes(w.wallet_kind) &&
            (kind === null || kind === '' || w.wallet_kind === kind),
        )
        return { rows, rowCount: rows.length }
      }
    }

    if (sql.includes('from wallet_ledger')) {
      const walletId = params[0]
      const items = store.walletLedger.filter((l) => String(l.wallet_id) === String(walletId))
      if (sql.includes('count')) {
        return { rows: [{ total: items.length }], rowCount: 1 }
      }
      return { rows: items, rowCount: items.length }
    }

    return { rows: [], rowCount: 0 }
  })

  return { query }
}

function getRoute(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route && l.route.path === path)
  return layer?.route?.stack?.[0]?.handle
}

function createRes() {
  return {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: any) {
      this.body = payload
      return this
    },
  }
}

describe('wallet ledger auth guards (mocked)', () => {
  let tables: TableRows
  let store: { matatus: any[]; wallets: any[]; walletLedger: any[] }
  let router: any
  let canAccessWalletLedger: any

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    tables = {
      user_roles: [],
      staff_profiles: [],
      access_grants: [],
    }
    store = {
      matatus: [
        { id: 'mat1', sacco_id: 'sacco1', owner_name: 'Owner One', owner_phone: '111' },
        { id: 'mat2', sacco_id: 'sacco2', owner_name: 'Other Owner', owner_phone: '999' },
      ],
      wallets: [
        {
          id: 'wallet_owner',
          matatu_id: 'mat1',
          sacco_id: null,
          entity_type: 'MATATU',
          entity_id: 'mat1',
          wallet_kind: 'MATATU_OWNER',
          balance: 0,
        },
        {
          id: 'wallet_matatu_vehicle',
          matatu_id: 'mat1',
          sacco_id: 'sacco1',
          entity_type: 'MATATU',
          entity_id: 'mat1',
          wallet_kind: 'MATATU_VEHICLE',
          balance: 0,
        },
        {
          id: 'wallet_sacco',
          matatu_id: null,
          sacco_id: 'sacco1',
          entity_type: 'SACCO',
          entity_id: 'sacco1',
          wallet_kind: 'SACCO_FEE',
          balance: 0,
        },
      ],
      walletLedger: [],
    }

    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon'
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service'

    const supabaseAdminMock = createSupabaseMock(tables)
    const supabaseMod = await import('../server/supabase.js')
    supabaseMod.supabaseAdmin.from = supabaseAdminMock.from
    const poolMod = await import('../server/db/pool.js')
    const pool = createPoolMock(store)
    if (poolMod.default) poolMod.default.query = pool.query
    if (poolMod.query) poolMod.query = pool.query

    const mod = await import('../server/routes/wallet-ledger.js')
    router = mod.default || mod
    canAccessWalletLedger = router.__test.canAccessWalletLedger
  })

  it('allows MATATU_OWNER (stored as MATATU_OWNER) to access their wallet ledger', async () => {
    tables.user_roles = [{ user_id: 'owner1', role: 'MATATU_OWNER', matatu_id: 'mat1', sacco_id: null }]

    const allowed = await canAccessWalletLedger('owner1', {
      id: 'wallet_owner',
      sacco_id: null,
      matatu_id: 'mat1',
      entity_type: 'MATATU',
      entity_id: 'mat1',
    })
    expect(allowed).toBe(true)

    const ownerRoute = getRoute(router, '/wallets/owner-ledger')
    expect(ownerRoute).toBeTruthy()
    const res = createRes()
    await ownerRoute!({ user: { id: 'owner1' }, query: {} }, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.wallets.length).toBeGreaterThan(0)
  })

  it('allows sacco admin to access sacco and matatu wallets within their sacco', async () => {
    tables.user_roles = [{ user_id: 'admin1', role: 'SACCO_ADMIN', sacco_id: 'sacco1', matatu_id: null }]

    const saccoRoute = getRoute(router, '/sacco/wallet-ledger')
    expect(saccoRoute).toBeTruthy()
    const saccoRes = createRes()
    await saccoRoute!({ user: { id: 'admin1' }, query: {} }, saccoRes)
    expect(saccoRes.statusCode).toBe(200)
    expect(saccoRes.body.ok).toBe(true)
    expect(saccoRes.body.wallets.length).toBe(1)

    const ownerRoute = getRoute(router, '/wallets/:id/ledger')
    expect(ownerRoute).toBeTruthy()
    const ownerRes = createRes()
    await ownerRoute!(
      { user: { id: 'admin1' }, params: { id: 'wallet_matatu_vehicle' }, query: {} },
      ownerRes,
    )
    expect(ownerRes.statusCode).toBe(200)
    expect(ownerRes.body.ok).toBe(true)
  })

  it("blocks random users from accessing another matatu's wallet ledger", async () => {
    tables.user_roles = [{ user_id: 'stranger', role: 'OWNER', matatu_id: 'mat2', sacco_id: null }]
    store.matatus.push({ id: 'mat3', sacco_id: 'sacco3', owner_name: 'Stranger', owner_phone: '222' })
    store.wallets.push({
      id: 'wallet_other',
      matatu_id: 'mat3',
      sacco_id: 'sacco3',
      entity_type: 'MATATU',
      entity_id: 'mat3',
      wallet_kind: 'MATATU_OWNER',
      balance: 0,
    })

    const route = getRoute(router, '/wallets/:id/ledger')
    expect(route).toBeTruthy()
    const res = createRes()
    await route!({ user: { id: 'stranger' }, params: { id: 'wallet_owner' }, query: {} }, res)
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('forbidden')
  })
})
