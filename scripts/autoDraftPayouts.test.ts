import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key])
if (!dbUrl) missingEnv.push('SUPABASE_DB_URL or DATABASE_URL')
const describeIf = missingEnv.length ? describe.skip : describe

describeIf('auto-draft payouts', () => {
  let pool: any
  let createWalletRecord: any
  let runAutoDraftForDate: any

  const runId = crypto.randomUUID()
  const saccoIds: string[] = []
  const walletIds: string[] = []
  const destIds: string[] = []
  const batchIds: string[] = []

  const settlementDate = '2026-01-15'

  beforeAll(async () => {
    const poolModule = await import('../server/db/pool.js')
    pool = poolModule.default || poolModule
    const walletModule = await import('../server/wallet/wallet.service.js')
    createWalletRecord = walletModule.createWalletRecord || walletModule.default?.createWalletRecord
    const autoDraftModule = await import('../server/services/autoDraftPayouts.service.js')
    runAutoDraftForDate =
      autoDraftModule.runAutoDraftForDate || autoDraftModule.default?.runAutoDraftForDate

    const saccoRes = await pool.query(`INSERT INTO saccos (name) VALUES ($1) RETURNING id`, [
      `AutoDraft Sacco ${runId}`,
    ])
    const saccoId = saccoRes.rows[0].id
    saccoIds.push(saccoId)

    const feeWallet = await createWalletRecord({
      entityType: 'SACCO',
      entityId: saccoId,
      walletType: 'sacco',
      walletKind: 'SACCO_DAILY_FEE',
      saccoId,
      numericRef: 4000,
    })
    const loanWallet = await createWalletRecord({
      entityType: 'SACCO',
      entityId: saccoId,
      walletType: 'sacco',
      walletKind: 'SACCO_LOAN',
      saccoId,
      numericRef: 5000,
    })
    const savingsWallet = await createWalletRecord({
      entityType: 'SACCO',
      entityId: saccoId,
      walletType: 'sacco',
      walletKind: 'SACCO_SAVINGS',
      saccoId,
      numericRef: 6000,
    })
    walletIds.push(feeWallet.id, loanWallet.id, savingsWallet.id)

    await pool.query(`UPDATE wallets SET balance = 500 WHERE id = $1`, [feeWallet.id])
    await pool.query(`UPDATE wallets SET balance = 200 WHERE id = $1`, [loanWallet.id])
    await pool.query(`UPDATE wallets SET balance = 0 WHERE id = $1`, [savingsWallet.id])

    const verifiedDest = await pool.query(
      `
        INSERT INTO payout_destinations (entity_type, entity_id, destination_type, destination_ref, is_verified)
        VALUES ('SACCO', $1, 'MSISDN', $2, true)
        RETURNING id
      `,
      [saccoId, `+2547${Math.floor(Math.random() * 90000000 + 10000000)}`],
    )
    destIds.push(verifiedDest.rows[0].id)

    const unverifiedDest = await pool.query(
      `
        INSERT INTO payout_destinations (entity_type, entity_id, destination_type, destination_ref, is_verified)
        VALUES ('SACCO', $1, 'MSISDN', $2, false)
        RETURNING id
      `,
      [saccoId, `+2547${Math.floor(Math.random() * 90000000 + 10000000)}`],
    )
    destIds.push(unverifiedDest.rows[0].id)
  })

  afterAll(async () => {
    if (batchIds.length) {
      await pool.query(`DELETE FROM payout_events WHERE batch_id = ANY($1)`, [batchIds])
      await pool.query(`DELETE FROM payout_items WHERE batch_id = ANY($1)`, [batchIds])
      await pool.query(`DELETE FROM payout_batches WHERE id = ANY($1)`, [batchIds])
    }
    if (destIds.length) {
      await pool.query(`DELETE FROM payout_destinations WHERE id = ANY($1)`, [destIds])
    }
    if (walletIds.length) {
      await pool.query(`DELETE FROM wallet_aliases WHERE wallet_id = ANY($1)`, [walletIds])
      await pool.query(`DELETE FROM wallets WHERE id = ANY($1)`, [walletIds])
    }
    if (saccoIds.length) {
      await pool.query(`DELETE FROM saccos WHERE id = ANY($1)`, [saccoIds])
    }
    if (pool) await pool.end()
  })

  it('creates auto-draft batch with pending + blocked items', async () => {
    const summary = await runAutoDraftForDate({ settlementDate })
    expect(summary.created).toBe(1)

    const { rows: batches } = await pool.query(
      `
        SELECT id, meta, total_amount
        FROM payout_batches
        WHERE sacco_id = $1
          AND date_to = $2
          AND COALESCE(meta->>'auto_draft','false') = 'true'
      `,
      [saccoIds[0], settlementDate],
    )
    expect(batches.length).toBe(1)
    batchIds.push(batches[0].id)
    expect(batches[0].meta?.auto_draft).toBe(true)
    expect(batches[0].meta?.auto_draft_run_id).toBe(settlementDate)

    const { rows: items } = await pool.query(
      `SELECT wallet_kind, amount, status, block_reason FROM payout_items WHERE batch_id = $1 ORDER BY wallet_kind`,
      [batches[0].id],
    )
    expect(items.length).toBeGreaterThan(0)
    const feeItem = items.find((i: any) => i.wallet_kind === 'SACCO_FEE')
    const loanItem = items.find((i: any) => i.wallet_kind === 'SACCO_LOAN')
    const savingsItem = items.find((i: any) => i.wallet_kind === 'SACCO_SAVINGS')
    expect(feeItem?.status).toBe('PENDING')
    expect(loanItem?.status).toBe('BLOCKED')
    expect(loanItem?.block_reason).toBe('DESTINATION_NOT_VERIFIED')
    if (savingsItem) {
      expect(savingsItem.status).toBe('BLOCKED')
    }
  })

  it('does not create duplicate auto-draft for same date', async () => {
    const summary = await runAutoDraftForDate({ settlementDate })
    expect(summary.created).toBe(0)

    const { rows: batches } = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM payout_batches
        WHERE sacco_id = $1
          AND date_to = $2
          AND COALESCE(meta->>'auto_draft','false') = 'true'
      `,
      [saccoIds[0], settlementDate],
    )
    expect(batches[0].total).toBe(1)
  })
})

