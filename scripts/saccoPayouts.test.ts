import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key])
if (!dbUrl) missingEnv.push('SUPABASE_DB_URL or DATABASE_URL')
const describeIf = missingEnv.length ? describe.skip : describe

describeIf('SACCO payouts smoke', () => {
  let app: any
  let server: any
  let baseUrl = ''
  let pool: any
  let supabaseAdmin: any
  let supabaseAnon: any
  let createWalletRecord: any

  const runId = crypto.randomUUID()
  const saccoIds: string[] = []
  const walletIds: string[] = []
  const batchIds: string[] = []
  const destinationIds: string[] = []
  const itemIds: string[] = []
  const aliasIds: string[] = []
  const paymentIds: string[] = []
  const userIds: string[] = []

  let saccoId = ''
  let feeWalletId = ''
  let payoutItemId = ''
  let blockedItemId = ''
  let payoutIdempotency = ''
  let destinationId = ''
  let paybillDestinationId = ''
  let aliasRef = ''
  let saccoToken = ''
  let adminToken = ''
  let adminUserId = ''
  let webhookSecret = ''
  const todayDate = new Date().toISOString().slice(0, 10)

  async function fetchJson(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    })
    const payload = await res.json()
    return { res, payload }
  }

  beforeAll(async () => {
    process.env.VERCEL = '1'
    if (!process.env.SUPABASE_DB_URL && process.env.DATABASE_URL) {
      process.env.SUPABASE_DB_URL = process.env.DATABASE_URL
    }
    process.env.DARAJA_WEBHOOK_SECRET =
      process.env.DARAJA_WEBHOOK_SECRET || `payout-${runId.slice(0, 8)}`
    webhookSecret = process.env.DARAJA_WEBHOOK_SECRET || ''
    process.env.MPESA_B2C_MOCK = process.env.MPESA_B2C_MOCK || '1'

    const appModule = await import('../server/server.js')
    app = appModule.default || appModule

    const poolModule = await import('../server/db/pool.js')
    pool = poolModule.default || poolModule

    const walletModule = await import('../server/wallet/wallet.service.js')
    createWalletRecord = walletModule.createWalletRecord || walletModule.default?.createWalletRecord

    const supabaseModule = await import('../server/supabase.js')
    supabaseAdmin = supabaseModule.supabaseAdmin || supabaseModule.default?.supabaseAdmin
    supabaseAnon = supabaseModule.supabaseAnon || supabaseModule.default?.supabaseAnon

    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    const port = typeof address === 'string' ? 0 : address?.port
    baseUrl = `http://127.0.0.1:${port}`

    const saccoRes = await pool.query(`INSERT INTO saccos (name) VALUES ($1) RETURNING id`, [
      `Payout Sacco ${runId}`,
    ])
    saccoId = saccoRes.rows[0].id
    saccoIds.push(saccoId)

    const feeWallet = await createWalletRecord({
      entityType: 'SACCO',
      entityId: saccoId,
      walletType: 'sacco',
      walletKind: 'SACCO_DAILY_FEE',
      saccoId,
      numericRef: 1000,
    })
    feeWalletId = feeWallet.id
    walletIds.push(feeWalletId)

    const loanWallet = await createWalletRecord({
      entityType: 'SACCO',
      entityId: saccoId,
      walletType: 'sacco',
      walletKind: 'SACCO_LOAN',
      saccoId,
      numericRef: 2000,
    })
    walletIds.push(loanWallet.id)

    const savingsWallet = await createWalletRecord({
      entityType: 'SACCO',
      entityId: saccoId,
      walletType: 'sacco',
      walletKind: 'SACCO_SAVINGS',
      saccoId,
      numericRef: 3000,
    })
    walletIds.push(savingsWallet.id)

    await pool.query(`UPDATE wallets SET balance = 2000 WHERE id = $1`, [feeWalletId])

    aliasRef = `7${Math.floor(Math.random() * 900000 + 100000)}`
    const aliasRes = await pool.query(
      `
        INSERT INTO wallet_aliases (wallet_id, alias, alias_type)
        VALUES ($1, $2, 'PAYBILL_CODE')
        RETURNING id
      `,
      [feeWalletId, aliasRef],
    )
    aliasIds.push(aliasRes.rows[0].id)

    const destRes = await pool.query(
      `
        INSERT INTO payout_destinations
          (entity_type, entity_id, destination_type, destination_ref, destination_name, is_verified)
        VALUES
          ('SACCO', $1, 'MSISDN', $2, $3, false)
        RETURNING id
      `,
      [saccoId, `+2547${Math.floor(Math.random() * 90000000 + 10000000)}`, 'Main MSISDN'],
    )
    destinationId = destRes.rows[0].id
    destinationIds.push(destinationId)

    const paybillDestRes = await pool.query(
      `
        INSERT INTO payout_destinations
          (entity_type, entity_id, destination_type, destination_ref, destination_name, is_verified)
        VALUES
          ('SACCO', $1, 'PAYBILL_TILL', $2, $3, true)
        RETURNING id
      `,
      [saccoId, `9988${Math.floor(Math.random() * 900 + 100)}`, 'Manual PayBill'],
    )
    paybillDestinationId = paybillDestRes.rows[0].id
    destinationIds.push(paybillDestinationId)

    const saccoEmail = `sacco-${runId}@example.com`
    const saccoPassword = `Test!${runId.slice(0, 8)}a`
    const saccoUser = await supabaseAdmin.auth.admin.createUser({
      email: saccoEmail,
      password: saccoPassword,
      email_confirm: true,
    })
    if (saccoUser.error) throw saccoUser.error
    const saccoUserId = saccoUser.data.user?.id
    if (!saccoUserId) throw new Error('Failed to create sacco user')
    userIds.push(saccoUserId)
    await pool.query(
      `INSERT INTO user_roles (user_id, role, sacco_id) VALUES ($1, 'SACCO_ADMIN', $2)`,
      [saccoUserId, saccoId],
    )
    const saccoLogin = await supabaseAnon.auth.signInWithPassword({ email: saccoEmail, password: saccoPassword })
    if (saccoLogin.error) throw saccoLogin.error
    saccoToken = saccoLogin.data.session?.access_token || ''

    const adminEmail = `admin-${runId}@example.com`
    const adminPassword = `Test!${runId.slice(0, 8)}b`
    const adminRes = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    })
    if (adminRes.error) throw adminRes.error
    adminUserId = adminRes.data.user?.id || ''
    if (!adminUserId) throw new Error('Failed to create admin user')
    userIds.push(adminUserId)
    await pool.query(
      `INSERT INTO staff_profiles (user_id, role, name, email) VALUES ($1, 'SYSTEM_ADMIN', $2, $3)`,
      [adminUserId, `Payout Admin ${runId}`, adminEmail],
    )
    const adminLogin = await supabaseAnon.auth.signInWithPassword({ email: adminEmail, password: adminPassword })
    if (adminLogin.error) throw adminLogin.error
    adminToken = adminLogin.data.session?.access_token || ''
  })

  afterAll(async () => {
    try {
      if (itemIds.length) {
        await pool.query(`DELETE FROM payout_events WHERE item_id = ANY($1)`, [itemIds])
      }
      if (batchIds.length) {
        await pool.query(`DELETE FROM payout_events WHERE batch_id = ANY($1)`, [batchIds])
        await pool.query(`DELETE FROM payout_items WHERE batch_id = ANY($1)`, [batchIds])
        await pool.query(`DELETE FROM payout_batches WHERE id = ANY($1)`, [batchIds])
      }
      if (destinationIds.length) {
        await pool.query(`DELETE FROM payout_destinations WHERE id = ANY($1)`, [destinationIds])
      }
      if (paymentIds.length) {
        await pool.query(`DELETE FROM mpesa_c2b_payments WHERE id = ANY($1)`, [paymentIds])
      }
      if (aliasIds.length) {
        await pool.query(`DELETE FROM wallet_aliases WHERE id = ANY($1)`, [aliasIds])
      }
      if (walletIds.length) {
        await pool.query(`DELETE FROM wallet_transactions WHERE wallet_id = ANY($1)`, [walletIds])
        await pool.query(`DELETE FROM wallets WHERE id = ANY($1)`, [walletIds])
      }
      if (saccoIds.length) {
        await pool.query(`DELETE FROM saccos WHERE id = ANY($1)`, [saccoIds])
      }
      if (userIds.length) {
        await pool.query(`DELETE FROM user_roles WHERE user_id = ANY($1)`, [userIds])
        await pool.query(`DELETE FROM staff_profiles WHERE user_id = ANY($1)`, [userIds])
        for (const uid of userIds) {
          await supabaseAdmin.auth.admin.deleteUser(uid)
        }
      }
    } catch {}
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('creates payout batch with idempotency keys', async () => {
    const res = await fetchJson(
      '/api/sacco/payout-batches',
      {
        date_from: todayDate,
        date_to: todayDate,
        wallet_kinds: ['SACCO_FEE', 'SACCO_LOAN'],
        destination_id_by_kind: { SACCO_FEE: destinationId, SACCO_LOAN: paybillDestinationId },
      },
      { Authorization: `Bearer ${saccoToken}` },
    )
    expect(res.res.status).toBe(200)
    expect(res.payload?.items?.length).toBeGreaterThan(1)

    const items = res.payload.items as Array<any>
    const msisdnItem = items.find((row) => row.destination_type === 'MSISDN')
    const paybillItem = items.find((row) => row.destination_type === 'PAYBILL_TILL')
    expect(msisdnItem?.status).toBe('PENDING')
    expect(paybillItem?.status).toBe('BLOCKED')
    expect(paybillItem?.block_reason).toBe('B2B_NOT_SUPPORTED')

    expect(msisdnItem.idempotency_key).toMatch(/^BATCH:/)
    payoutItemId = msisdnItem.id
    payoutIdempotency = msisdnItem.idempotency_key
    blockedItemId = paybillItem?.id || ''
    batchIds.push(res.payload.batch_id)
    itemIds.push(msisdnItem.id)
    if (paybillItem?.id) itemIds.push(paybillItem.id)
  })

  it('submits payout batch', async () => {
    const submit = await fetchJson(
      `/api/sacco/payout-batches/${encodeURIComponent(batchIds[0])}/submit`,
      {},
      { Authorization: `Bearer ${saccoToken}` },
    )
    expect(submit.res.status).toBe(200)
  })

  it('blocks approval when destination is unverified', async () => {
    const approve = await fetchJson(
      `/api/admin/payout-batches/${encodeURIComponent(batchIds[0])}/approve`,
      {},
      { Authorization: `Bearer ${adminToken}` },
    )
    expect(approve.res.status).toBe(400)
  })

  it('blocks approval when quarantines exist, then approves', async () => {
    const verify = await fetchJson(
      `/api/admin/payout-destinations/${encodeURIComponent(destinationId)}/verify`,
      {},
      { Authorization: `Bearer ${adminToken}` },
    )
    expect(verify.res.status).toBe(200)

    const receipt = `Q-${runId.slice(0, 8)}`
    const paymentRes = await pool.query(
      `
        INSERT INTO mpesa_c2b_payments
          (paybill_number, account_reference, amount, msisdn, receipt, status, raw, created_at)
        VALUES
          ('4814003', $1, 100, '254700000000', $2, 'QUARANTINED', '{}'::jsonb, now())
        RETURNING id
      `,
      [aliasRef, receipt],
    )
    const paymentId = paymentRes.rows[0].id
    paymentIds.push(paymentId)

    const blocked = await fetchJson(
      `/api/admin/payout-batches/${encodeURIComponent(batchIds[0])}/approve`,
      {},
      { Authorization: `Bearer ${adminToken}` },
    )
    expect(blocked.res.status).toBe(400)

    await pool.query(`DELETE FROM mpesa_c2b_payments WHERE id = $1`, [paymentId])

    const approve = await fetchJson(
      `/api/admin/payout-batches/${encodeURIComponent(batchIds[0])}/approve`,
      {},
      { Authorization: `Bearer ${adminToken}` },
    )
    expect(approve.res.status).toBe(200)
  })

  it('process marks items SENT and is idempotent', async () => {
    const process = await fetchJson(
      `/api/admin/payout-batches/${encodeURIComponent(batchIds[0])}/process`,
      {},
      { Authorization: `Bearer ${adminToken}` },
    )
    expect(process.res.status).toBe(200)

    const after = await pool.query(
      `SELECT status, provider_request_id FROM payout_items WHERE id = $1`,
      [payoutItemId],
    )
    expect(after.rows[0].status).toBe('SENT')
    expect(after.rows[0].provider_request_id).toBeTruthy()

    const again = await fetchJson(
      `/api/admin/payout-batches/${encodeURIComponent(batchIds[0])}/process`,
      {},
      { Authorization: `Bearer ${adminToken}` },
    )
    expect(again.res.status).toBe(200)
    const afterAgain = await pool.query(`SELECT status FROM payout_items WHERE id = $1`, [payoutItemId])
    expect(afterAgain.rows[0].status).toBe('SENT')
  })

  it('B2C callback confirms payout and debits wallet', async () => {
    const beforeWallet = await pool.query(`SELECT balance FROM wallets WHERE id = $1`, [feeWalletId])
    const beforeBalance = Number(beforeWallet.rows[0].balance || 0)

    const callbackPayload = {
      Result: {
        ResultCode: 0,
        ResultDesc: 'Success',
        OriginatorConversationID: payoutIdempotency,
        ConversationID: `CONV-${runId}`,
        TransactionID: `TXN-${runId}`,
      },
    }

    const callbackRes = await fetch(`${baseUrl}/api/mpesa/b2c/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': webhookSecret,
      },
      body: JSON.stringify(callbackPayload),
    })
    expect(callbackRes.status).toBe(200)

    const itemRes = await pool.query(`SELECT status, provider_receipt FROM payout_items WHERE id = $1`, [payoutItemId])
    expect(itemRes.rows[0].status).toBe('CONFIRMED')
    expect(itemRes.rows[0].provider_receipt).toBe(`TXN-${runId}`)

    const afterWallet = await pool.query(`SELECT balance FROM wallets WHERE id = $1`, [feeWalletId])
    const afterBalance = Number(afterWallet.rows[0].balance || 0)
    expect(afterBalance).toBeLessThan(beforeBalance)

    const txRes = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM wallet_transactions
        WHERE wallet_id = $1 AND source = 'SACCO_PAYOUT' AND source_ref = $2
      `,
      [feeWalletId, payoutItemId],
    )
    expect(txRes.rows[0].total).toBe(1)
  })

  it('B2C callback failure marks item FAILED', async () => {
    const batchFailId = crypto.randomUUID()
    const itemFailId = crypto.randomUUID()
    const idempotencyKey = `BATCH:${batchFailId}:SACCO_FEE:50:${aliasRef}`

    await pool.query(
      `
        INSERT INTO payout_batches
          (id, sacco_id, date_from, date_to, status, created_by, total_amount, currency, meta)
        VALUES
          ($1, $2, $3, $4, 'PROCESSING', $5, 50, 'KES', '{}'::jsonb)
      `,
      [batchFailId, saccoId, todayDate, todayDate, adminUserId],
    )
    batchIds.push(batchFailId)

    await pool.query(
      `
        INSERT INTO payout_items
          (id, batch_id, wallet_id, wallet_kind, amount, destination_type, destination_ref, status, idempotency_key, provider_request_id)
        VALUES
          ($1, $2, $3, 'SACCO_FEE', 50, 'MSISDN', $4, 'SENT', $5, $5)
      `,
      [itemFailId, batchFailId, feeWalletId, `+2547${Math.floor(Math.random() * 90000000 + 10000000)}`, idempotencyKey],
    )
    itemIds.push(itemFailId)

    const failPayload = {
      Result: {
        ResultCode: 1,
        ResultDesc: 'Failed',
        OriginatorConversationID: idempotencyKey,
        ConversationID: `CONV-FAIL-${runId}`,
        TransactionID: `TXN-FAIL-${runId}`,
      },
    }

    const failRes = await fetch(`${baseUrl}/api/mpesa/b2c/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': webhookSecret,
      },
      body: JSON.stringify(failPayload),
    })
    expect(failRes.status).toBe(200)

    const itemRes = await pool.query(`SELECT status, failure_reason FROM payout_items WHERE id = $1`, [itemFailId])
    expect(itemRes.rows[0].status).toBe('FAILED')
    expect(itemRes.rows[0].failure_reason || '').toContain('Failed')
  })
})
