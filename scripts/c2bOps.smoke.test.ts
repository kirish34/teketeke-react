import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]
const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key])
if (!dbUrl) missingEnv.push('SUPABASE_DB_URL or DATABASE_URL')
const describeIf = missingEnv.length ? describe.skip : describe

describeIf('C2B/STK + ops smoke', () => {
  let app: any
  let server: any
  let baseUrl = ''
  let pool: any
  let registerWalletForEntity: any
  let supabaseAdmin: any
  let supabaseAnon: any
  let runDailyReconciliation: any
  let validatePaybillCode: ((code: string) => boolean) | null = null

  const runId = crypto.randomUUID()
  const receipts: string[] = []
  const checkoutIds: string[] = []
  const paymentIds: string[] = []
  const extraWalletIds: string[] = []
  const extraSaccoIds: string[] = []
  const extraMatatuIds: string[] = []
  let walletId = ''
  let paybillAlias = ''
  let plateAlias = ''
  let matatuId = ''
  let saccoId = ''
  let adminUserId = ''
  let adminToken = ''

  let webhookSecret = ''
  let webhookHeader: Record<string, string> = {}

  const msisdn1 = `254799${Math.floor(Math.random() * 900000 + 100000)}`
  const msisdn2 = `254798${Math.floor(Math.random() * 900000 + 100000)}`

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

  async function getPaymentByReceipt(receipt: string) {
    const { rows } = await pool.query(
      `
        SELECT id, status, risk_level, risk_score, risk_flags
        FROM mpesa_c2b_payments
        WHERE receipt = $1
        LIMIT 1
      `,
      [receipt],
    )
    return rows[0] || null
  }

  async function getWalletTxCount(source: string, sourceRef: string) {
    const { rows } = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM wallet_transactions
        WHERE source = $1 AND source_ref = $2
      `,
      [source, sourceRef],
    )
    return rows[0]?.total || 0
  }

  async function getOpsAlertCount(paymentId: string, type: string) {
    const { rows } = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM ops_alerts
        WHERE payment_id = $1 AND type = $2
      `,
      [paymentId, type],
    )
    return rows[0]?.total || 0
  }

  function makeInvalidChecksum(code: string) {
    const raw = String(code || '')
    if (!/^\d{7}$/.test(raw)) return raw
    const last = Number(raw.slice(-1))
    const next = Number.isFinite(last) ? (last + 1) % 10 : 0
    return `${raw.slice(0, 6)}${next}`
  }

  beforeAll(async () => {
    process.env.VERCEL = '1'
    if (!process.env.SUPABASE_DB_URL && process.env.DATABASE_URL) {
      process.env.SUPABASE_DB_URL = process.env.DATABASE_URL
    }
    process.env.DARAJA_WEBHOOK_SECRET =
      process.env.DARAJA_WEBHOOK_SECRET || `smoke-${runId.slice(0, 8)}`
    process.env.C2B_RISK_MULTI_ALIAS_COUNT =
      process.env.C2B_RISK_MULTI_ALIAS_COUNT || '2'
    process.env.C2B_RISK_RAPID_FIRE_COUNT =
      process.env.C2B_RISK_RAPID_FIRE_COUNT || '3'
    webhookSecret = process.env.DARAJA_WEBHOOK_SECRET || ''
    webhookHeader = webhookSecret ? { 'x-webhook-secret': webhookSecret } : {}

    const appModule = await import('../server/server.js')
    app = appModule.default || appModule

    const poolModule = await import('../server/db/pool.js')
    pool = poolModule.default || poolModule

    const walletService = await import('../server/wallet/wallet.service.js')
    registerWalletForEntity =
      walletService.registerWalletForEntity || walletService.default?.registerWalletForEntity

    const supabaseModule = await import('../server/supabase.js')
    supabaseAdmin = supabaseModule.supabaseAdmin || supabaseModule.default?.supabaseAdmin
    supabaseAnon = supabaseModule.supabaseAnon || supabaseModule.default?.supabaseAnon

    const reconModule = await import('../server/services/reconciliation.service.js')
    runDailyReconciliation =
      reconModule.runDailyReconciliation || reconModule.default?.runDailyReconciliation

    const paybillModule = await import('../server/wallet/paybillCode.util.js')
    validatePaybillCode =
      paybillModule.validatePaybillCode || paybillModule.default?.validatePaybillCode || null
    if (!validatePaybillCode) {
      throw new Error('Missing validatePaybillCode')
    }

    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    const port = typeof address === 'string' ? 0 : address?.port
    baseUrl = `http://127.0.0.1:${port}`

    const saccoRes = await pool.query(
      `INSERT INTO saccos (name) VALUES ($1) RETURNING id`,
      [`Smoke Sacco ${runId}`],
    )
    saccoId = saccoRes.rows[0].id

    const plate = `TST${String(Math.floor(Math.random() * 900)).padStart(3, '0')}A`
    const matatuRes = await pool.query(
      `INSERT INTO matatus (sacco_id, number_plate, vehicle_type) VALUES ($1, $2, 'MATATU') RETURNING id`,
      [saccoId, plate],
    )
    matatuId = matatuRes.rows[0].id

    const wallet = await registerWalletForEntity({ entityType: 'MATATU', entityId: matatuId, numericRef: 10000 })
    walletId = wallet.id

    const aliasRes = await pool.query(
      `SELECT alias, alias_type FROM wallet_aliases WHERE wallet_id = $1`,
      [walletId],
    )
    const paybillRow = aliasRes.rows.find((row: any) => row.alias_type === 'PAYBILL_CODE')
    const plateRow = aliasRes.rows.find((row: any) => row.alias_type === 'PLATE')
    paybillAlias = paybillRow?.alias
    plateAlias = plateRow?.alias || plate
    if (!paybillAlias) throw new Error('Missing PAYBILL_CODE alias')

    const adminEmail = `system-${runId}@example.com`
    const adminPassword = `Test!${runId.slice(0, 8)}a`
    const adminRes = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    })
    if (adminRes.error) throw adminRes.error
    adminUserId = adminRes.data.user?.id
    if (!adminUserId) throw new Error('Failed to create admin user')

    await pool.query(
      `INSERT INTO staff_profiles (user_id, role, name, email) VALUES ($1, 'SYSTEM_ADMIN', $2, $3)`,
      [adminUserId, `Test Admin ${runId}`, adminEmail],
    )

    const signIn = await supabaseAnon.auth.signInWithPassword({ email: adminEmail, password: adminPassword })
    if (signIn.error) throw signIn.error
    adminToken = signIn.data.session?.access_token || ''
    if (!adminToken) throw new Error('Failed to obtain admin token')
  })

  afterAll(async () => {
    try {
      if (paymentIds.length) {
        await pool.query(`DELETE FROM c2b_actions_audit WHERE payment_id = ANY($1)`, [paymentIds])
        await pool.query(`DELETE FROM ops_alerts WHERE payment_id = ANY($1)`, [paymentIds])
      }
      if (receipts.length) {
        await pool.query(`DELETE FROM ops_alerts WHERE meta->>'receipt' = ANY($1)`, [receipts])
        await pool.query(`DELETE FROM wallet_transactions WHERE source_ref = ANY($1)`, [receipts])
        await pool.query(`DELETE FROM mpesa_c2b_payments WHERE receipt = ANY($1)`, [receipts])
      }
      if (checkoutIds.length) {
        await pool.query(`DELETE FROM mpesa_c2b_payments WHERE checkout_request_id = ANY($1)`, [checkoutIds])
      }
      await pool.query(`DELETE FROM mpesa_c2b_quarantine WHERE raw->>'TestRunId' = $1`, [runId])
      await pool.query(`DELETE FROM reconciliation_daily WHERE date IN ('2025-01-15', '2025-01-16')`)
      await pool.query(`DELETE FROM reconciliation_daily_channels WHERE date IN ('2025-01-15', '2025-01-16')`)
      if (walletId) {
        await pool.query(`DELETE FROM wallet_aliases WHERE wallet_id = $1`, [walletId])
        await pool.query(`DELETE FROM wallets WHERE id = $1`, [walletId])
      }
      if (extraWalletIds.length) {
        await pool.query(`DELETE FROM wallet_aliases WHERE wallet_id = ANY($1)`, [extraWalletIds])
        await pool.query(`DELETE FROM wallets WHERE id = ANY($1)`, [extraWalletIds])
      }
      if (matatuId) await pool.query(`DELETE FROM matatus WHERE id = $1`, [matatuId])
      if (extraMatatuIds.length) {
        await pool.query(`DELETE FROM matatus WHERE id = ANY($1)`, [extraMatatuIds])
      }
      if (extraSaccoIds.length) {
        await pool.query(`DELETE FROM saccos WHERE id = ANY($1)`, [extraSaccoIds])
      }
      if (saccoId) await pool.query(`DELETE FROM saccos WHERE id = $1`, [saccoId])
      if (adminUserId) {
        await pool.query(`DELETE FROM staff_profiles WHERE user_id = $1`, [adminUserId])
        if (supabaseAdmin) {
          await supabaseAdmin.auth.admin.deleteUser(adminUserId)
        }
      }
    } finally {
      if (server) server.close()
      if (pool) await pool.end()
    }
  })

  it('credits wallet once for valid paybill + numeric alias', async () => {
    const receipt = `RCPT_${runId.slice(0, 8)}`
    receipts.push(receipt)
    const payload = {
      TransID: receipt,
      TransAmount: 120,
      MSISDN: msisdn1,
      BusinessShortCode: '4814003',
      BillRefNumber: paybillAlias,
      TestRunId: runId,
    }
    const { res } = await fetchJson('/mpesa/callback', payload, webhookHeader)
    expect(res.status).toBe(200)

    const payment = await getPaymentByReceipt(receipt)
    expect(payment?.status).toBe('CREDITED')
    if (payment?.id) paymentIds.push(payment.id)

    const firstTx = await getWalletTxCount('MPESA_C2B', receipt)
    expect(firstTx).toBe(1)

    const dup = await fetchJson('/mpesa/callback', payload, webhookHeader)
    expect(dup.res.status).toBe(200)

    const secondTx = await getWalletTxCount('MPESA_C2B', receipt)
    expect(secondTx).toBe(1)

    if (payment?.id) {
      const dupAlert = await getOpsAlertCount(payment.id, 'DUPLICATE_RECEIPT')
      expect(dupAlert).toBeGreaterThan(0)
    }
  })

  it('registers sacco paybill codes with correct prefixes and checksum', async () => {
    const authHeader = { Authorization: `Bearer ${adminToken}` }
    const { res, payload } = await fetchJson(
      '/api/admin/register-sacco',
      { display_name: `Smoke Sacco Codes ${runId.slice(0, 6)}` },
      authHeader,
    )
    expect(res.status).toBe(200)
    if (payload?.id) extraSaccoIds.push(payload.id)

    const codes = payload?.paybill_codes || {}
    expect(typeof codes.daily_fee).toBe('string')
    expect(typeof codes.loan).toBe('string')
    expect(typeof codes.savings).toBe('string')
    expect(codes.daily_fee?.startsWith('30')).toBe(true)
    expect(codes.loan?.startsWith('31')).toBe(true)
    expect(codes.savings?.startsWith('32')).toBe(true)
    expect(validatePaybillCode?.(codes.daily_fee)).toBe(true)
    expect(validatePaybillCode?.(codes.loan)).toBe(true)
    expect(validatePaybillCode?.(codes.savings)).toBe(true)

    const walletIds = payload?.wallet_ids || {}
    Object.values(walletIds).forEach((id: any) => {
      if (id) extraWalletIds.push(String(id))
    })
  })

  it('registers matatu paybill codes with correct prefixes and checksum', async () => {
    const authHeader = { Authorization: `Bearer ${adminToken}` }
    const plate = `KTA${String(Math.floor(Math.random() * 900)).padStart(3, '0')}A`
    const { res, payload } = await fetchJson(
      '/api/admin/register-matatu',
      { sacco_id: saccoId, number_plate: plate, vehicle_type: 'MATATU' },
      authHeader,
    )
    expect(res.status).toBe(200)
    if (payload?.id) extraMatatuIds.push(payload.id)

    const codes = payload?.paybill_codes || {}
    expect(typeof codes.owner).toBe('string')
    expect(typeof codes.vehicle).toBe('string')
    expect(codes.owner?.startsWith('10')).toBe(true)
    expect(codes.vehicle?.startsWith('11')).toBe(true)
    expect(validatePaybillCode?.(codes.owner)).toBe(true)
    expect(validatePaybillCode?.(codes.vehicle)).toBe(true)

    const walletIds = payload?.wallet_ids || {}
    Object.values(walletIds).forEach((id: any) => {
      if (id) extraWalletIds.push(String(id))
    })
  })

  it('quarantines wrong paybill without crediting', async () => {
    const receipt = `RCPT_BAD_${runId.slice(0, 6)}`
    receipts.push(receipt)
    const payload = {
      TransID: receipt,
      TransAmount: 90,
      MSISDN: msisdn1,
      BusinessShortCode: '999999',
      BillRefNumber: paybillAlias,
      TestRunId: runId,
    }
    const { res } = await fetchJson('/mpesa/callback', payload, webhookHeader)
    expect(res.status).toBe(200)

    const payment = await getPaymentByReceipt(receipt)
    expect(payment?.status).toBe('QUARANTINED')
    if (payment?.id) paymentIds.push(payment.id)
    expect(payment?.risk_level).toBe('HIGH')
    expect(Number(payment?.risk_score || 0)).toBeGreaterThanOrEqual(80)

    const txCount = await getWalletTxCount('MPESA_C2B', receipt)
    expect(txCount).toBe(0)

    if (payment?.id) {
      const alertCount = await getOpsAlertCount(payment.id, 'PAYBILL_MISMATCH')
      expect(alertCount).toBeGreaterThan(0)
    }

    const replay = await fetchJson(
      '/mpesa/callback',
      { ...payload, BusinessShortCode: '4814003' },
      webhookHeader,
    )
    expect(replay.res.status).toBe(200)
    const afterReplay = await getPaymentByReceipt(receipt)
    expect(afterReplay?.status).toBe('QUARANTINED')
  })

  it('quarantines invalid checksum without crediting', async () => {
    const receipt = `RCPT_BADCHK_${runId.slice(0, 6)}`
    receipts.push(receipt)
    const invalidRef = makeInvalidChecksum(paybillAlias)
    expect(validatePaybillCode?.(paybillAlias)).toBe(true)
    expect(validatePaybillCode?.(invalidRef)).toBe(false)

    const payload = {
      TransID: receipt,
      TransAmount: 88,
      MSISDN: msisdn1,
      BusinessShortCode: '4814003',
      BillRefNumber: invalidRef,
      TestRunId: runId,
    }
    const { res } = await fetchJson('/mpesa/callback', payload, webhookHeader)
    expect(res.status).toBe(200)

    const payment = await getPaymentByReceipt(receipt)
    expect(payment?.status).toBe('QUARANTINED')
    if (payment?.id) paymentIds.push(payment.id)

    const txCount = await getWalletTxCount('MPESA_C2B', receipt)
    expect(txCount).toBe(0)

    if (payment?.id) {
      const alertCount = await getOpsAlertCount(payment.id, 'INVALID_CHECKSUM_REF')
      expect(alertCount).toBeGreaterThan(0)
    }
  })

  it('returns 200 on webhook secret mismatch without crediting', async () => {
    const receipt = `RCPT_SECRET_${runId.slice(0, 6)}`
    receipts.push(receipt)
    const payload = {
      TransID: receipt,
      TransAmount: 75,
      MSISDN: msisdn1,
      BusinessShortCode: '4814003',
      BillRefNumber: paybillAlias,
      TestRunId: runId,
    }
    const { res } = await fetchJson('/mpesa/callback', payload, { 'x-webhook-secret': 'bad-secret' })
    expect(res.status).toBe(200)

    const payment = await getPaymentByReceipt(receipt)
    expect(payment?.status).toBe('QUARANTINED')
    if (payment?.id) paymentIds.push(payment.id)

    const txCount = await getWalletTxCount('MPESA_C2B', receipt)
    expect(txCount).toBe(0)

    if (payment?.id) {
      const alertCount = await getOpsAlertCount(payment.id, 'WEBHOOK_SECRET_MISMATCH')
      expect(alertCount).toBeGreaterThan(0)
    }
  })

  it('flags multiple aliases for the same MSISDN', async () => {
    const msisdn = `254733${Math.floor(Math.random() * 900000 + 100000)}`
    const plate = `TST${String(Math.floor(Math.random() * 900)).padStart(3, '0')}B`
    const matatuRes = await pool.query(
      `INSERT INTO matatus (sacco_id, number_plate, vehicle_type) VALUES ($1, $2, 'MATATU') RETURNING id`,
      [saccoId, plate],
    )
    const otherMatatuId = matatuRes.rows[0].id
    extraMatatuIds.push(otherMatatuId)

    const otherWallet = await registerWalletForEntity({
      entityType: 'MATATU',
      entityId: otherMatatuId,
      numericRef: 10001,
    })
    extraWalletIds.push(otherWallet.id)

    const aliasRes = await pool.query(
      `SELECT alias, alias_type FROM wallet_aliases WHERE wallet_id = $1`,
      [otherWallet.id],
    )
    const otherPaybill = aliasRes.rows.find((row: any) => row.alias_type === 'PAYBILL_CODE')?.alias
    if (!otherPaybill) throw new Error('Missing PAYBILL_CODE alias for second wallet')

    const receipt1 = `RCPT_MA_${runId.slice(0, 5)}_1`
    const receipt2 = `RCPT_MA_${runId.slice(0, 5)}_2`
    receipts.push(receipt1, receipt2)

    const payload1 = {
      TransID: receipt1,
      TransAmount: 70,
      MSISDN: msisdn,
      BusinessShortCode: '4814003',
      BillRefNumber: paybillAlias,
      TestRunId: runId,
    }
    const payload2 = {
      TransID: receipt2,
      TransAmount: 80,
      MSISDN: msisdn,
      BusinessShortCode: '4814003',
      BillRefNumber: otherPaybill,
      TestRunId: runId,
    }

    const res1 = await fetchJson('/mpesa/callback', payload1, webhookHeader)
    expect(res1.res.status).toBe(200)
    const res2 = await fetchJson('/mpesa/callback', payload2, webhookHeader)
    expect(res2.res.status).toBe(200)

    const payment2 = await getPaymentByReceipt(receipt2)
    if (payment2?.id) paymentIds.push(payment2.id)
    expect(payment2?.risk_flags?.MULTIPLE_ALIASES_SAME_MSISDN).toBeTruthy()
    expect(Number(payment2?.risk_score || 0)).toBeGreaterThanOrEqual(25)

    if (payment2?.id) {
      const alertCount = await getOpsAlertCount(payment2.id, 'MULTIPLE_ALIASES_SAME_MSISDN')
      expect(alertCount).toBeGreaterThan(0)
    }
  })

  it('credits wallet for STK plate alias', async () => {
    const receipt = `RCPT_STK_${runId.slice(0, 6)}`
    const checkoutId = `CHK_${runId.slice(0, 10)}`
    receipts.push(receipt)
    checkoutIds.push(checkoutId)

    const insertRes = await pool.query(
      `
        INSERT INTO mpesa_c2b_payments
          (paybill_number, account_reference, amount, msisdn, receipt, status, raw, checkout_request_id)
        VALUES
          ($1, $2, $3, $4, $5, 'RECEIVED', $6, $7)
        RETURNING id
      `,
      ['4814003', plateAlias, 150, msisdn2, null, { TestRunId: runId }, checkoutId],
    )
    paymentIds.push(insertRes.rows[0].id)

    const callbackPayload = {
      TestRunId: runId,
      Body: {
        stkCallback: {
          ResultCode: 0,
          CheckoutRequestID: checkoutId,
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 150 },
              { Name: 'MpesaReceiptNumber', Value: receipt },
              { Name: 'PhoneNumber', Value: msisdn2 },
            ],
          },
        },
      },
    }
    const { res } = await fetchJson('/api/pay/stk/callback', callbackPayload, webhookHeader)
    expect(res.status).toBe(200)

    const txCount = await getWalletTxCount('MPESA_STK', receipt)
    expect(txCount).toBe(1)
  })

  it('does not downgrade risk on duplicate callback', async () => {
    const receipt = receipts[0]
    await pool.query(
      `UPDATE mpesa_c2b_payments SET risk_score = 90, risk_level = 'HIGH' WHERE receipt = $1`,
      [receipt],
    )

    const payload = {
      TransID: receipt,
      TransAmount: 120,
      MSISDN: msisdn1,
      BusinessShortCode: '4814003',
      BillRefNumber: paybillAlias,
      TestRunId: runId,
    }
    const { res } = await fetchJson('/mpesa/callback', payload, webhookHeader)
    expect(res.status).toBe(200)

    const payment = await getPaymentByReceipt(receipt)
    expect(payment?.status).toBe('CREDITED')
    expect(payment?.risk_level).toBe('HIGH')
  })

  it('creates rapid-fire ops alert for repeated MSISDN', async () => {
    const rapidMsisdn = `254712${Math.floor(Math.random() * 900000 + 100000)}`
    let lastPaymentId = ''

    for (let i = 0; i < 4; i += 1) {
      const receipt = `RCPT_RF_${runId.slice(0, 4)}_${i}`
      receipts.push(receipt)
      const payload = {
        TransID: receipt,
        TransAmount: 60 + i,
        MSISDN: rapidMsisdn,
        BusinessShortCode: '999999',
        BillRefNumber: paybillAlias,
        TestRunId: runId,
      }
      const { res } = await fetchJson('/mpesa/callback', payload, webhookHeader)
      expect(res.status).toBe(200)
      const payment = await getPaymentByReceipt(receipt)
      if (payment?.id) {
        paymentIds.push(payment.id)
        lastPaymentId = payment.id
      }
    }

    if (lastPaymentId) {
      const alertCount = await getOpsAlertCount(lastPaymentId, 'RAPID_FIRE_SAME_MSISDN')
      expect(alertCount).toBeGreaterThan(0)
    }
  })

  it('admin resolve CREDIT is idempotent and audits', async () => {
    const receipt = `RCPT_RESOLVE_${runId.slice(0, 5)}`
    receipts.push(receipt)
    const insertRes = await pool.query(
      `
        INSERT INTO mpesa_c2b_payments
          (paybill_number, account_reference, amount, msisdn, receipt, status, raw)
        VALUES
          ($1, $2, $3, $4, $5, 'QUARANTINED', $6)
        RETURNING id
      `,
      ['4814003', paybillAlias, 200, msisdn1, receipt, { TestRunId: runId }],
    )
    const paymentId = insertRes.rows[0].id
    paymentIds.push(paymentId)

    const authHeader = { Authorization: `Bearer ${adminToken}` }
    const first = await fetchJson(
      `/api/admin/c2b/${encodeURIComponent(paymentId)}/resolve`,
      { action: 'CREDIT', wallet_id: walletId, note: 'smoke credit' },
      authHeader,
    )
    expect(first.res.status).toBe(200)

    const second = await fetchJson(
      `/api/admin/c2b/${encodeURIComponent(paymentId)}/resolve`,
      { action: 'CREDIT', wallet_id: walletId, note: 'smoke credit duplicate' },
      authHeader,
    )
    expect(second.res.status).toBe(200)

    const txCount = await getWalletTxCount('MPESA_C2B', receipt)
    expect(txCount).toBe(1)

    const auditRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM c2b_actions_audit WHERE payment_id = $1 AND action = 'CREDIT'`,
      [paymentId],
    )
    expect(auditRes.rows[0]?.total || 0).toBeGreaterThan(0)
  })

  it('admin resolve REJECT is terminal and audits', async () => {
    const receipt = `RCPT_REJECT_${runId.slice(0, 5)}`
    receipts.push(receipt)
    const insertRes = await pool.query(
      `
        INSERT INTO mpesa_c2b_payments
          (paybill_number, account_reference, amount, msisdn, receipt, status, raw)
        VALUES
          ($1, $2, $3, $4, $5, 'QUARANTINED', $6)
        RETURNING id
      `,
      ['4814003', paybillAlias, 180, msisdn1, receipt, { TestRunId: runId }],
    )
    const paymentId = insertRes.rows[0].id
    paymentIds.push(paymentId)

    const authHeader = { Authorization: `Bearer ${adminToken}` }
    const reject = await fetchJson(
      `/api/admin/c2b/${encodeURIComponent(paymentId)}/resolve`,
      { action: 'REJECT', note: 'smoke reject' },
      authHeader,
    )
    expect(reject.res.status).toBe(200)

    const creditAttempt = await fetchJson(
      `/api/admin/c2b/${encodeURIComponent(paymentId)}/resolve`,
      { action: 'CREDIT', wallet_id: walletId, note: 'should fail' },
      authHeader,
    )
    expect(creditAttempt.res.status).toBe(400)

    const paymentRes = await pool.query(
      `SELECT status FROM mpesa_c2b_payments WHERE id = $1`,
      [paymentId],
    )
    expect(paymentRes.rows[0]?.status).toBe('REJECTED')

    const auditRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM c2b_actions_audit WHERE payment_id = $1 AND action = 'REJECT'`,
      [paymentId],
    )
    expect(auditRes.rows[0]?.total || 0).toBeGreaterThan(0)
  })

  it('reconciliation respects Africa/Nairobi boundaries', async () => {
    const date = '2025-01-15'
    const nextDate = '2025-01-16'
    const at2359 = new Date(`${date}T23:59:00+03:00`)
    const at0001 = new Date(`${nextDate}T00:01:00+03:00`)

    const receipt1 = `RCPT_TZ_${runId.slice(0, 6)}`
    const receipt2 = `RCPT_TZ_${runId.slice(6, 12)}`
    receipts.push(receipt1, receipt2)

    await pool.query(
      `
        INSERT INTO mpesa_c2b_payments
          (mpesa_receipt, amount, msisdn, paybill, account_number, trans_time, raw_payload,
           created_at, paybill_number, account_reference, receipt, status, raw)
        VALUES
          ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7, $8, $9, $10, 'CREDITED', $11),
          ($12, $13, $14, $15, $16, $17, '{}'::jsonb, $18, $19, $20, $21, 'CREDITED', $22)
      `,
      [
        `LEG_${receipt1}`,
        100,
        '254799000111',
        '4814003',
        '10011',
        at2359.toISOString(),
        at2359.toISOString(),
        '4814003',
        '10011',
        receipt1,
        { TestRunId: runId },
        `LEG_${receipt2}`,
        120,
        '254799000222',
        '4814003',
        '10012',
        at0001.toISOString(),
        at0001.toISOString(),
        '4814003',
        '10012',
        receipt2,
        { TestRunId: runId },
      ],
    )

    const day1 = await runDailyReconciliation({ date, client: pool })
    const day2 = await runDailyReconciliation({ date: nextDate, client: pool })

    expect(Number(day1.paybill_c2b?.credited_count || 0)).toBe(1)
    expect(Number(day2.paybill_c2b?.credited_count || 0)).toBe(1)
  })
})
