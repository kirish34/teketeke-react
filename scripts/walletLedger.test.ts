import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key])
if (!dbUrl) missingEnv.push('SUPABASE_DB_URL or DATABASE_URL')
const describeIf = missingEnv.length ? describe.skip : describe

describeIf('wallet ledger services', () => {
  let pool: any
  let createWalletRecord: any
  let creditWalletWithLedger: any
  let debitWalletWithLedger: any
  let walletId = ''
  const runId = crypto.randomUUID()

  beforeAll(async () => {
    const poolModule = await import('../server/db/pool.js')
    pool = poolModule.default || poolModule

    const walletModule = await import('../server/wallet/wallet.service.js')
    createWalletRecord = walletModule.createWalletRecord || walletModule.default?.createWalletRecord

    const ledgerModule = await import('../server/services/walletLedger.service.js')
    creditWalletWithLedger =
      ledgerModule.creditWalletWithLedger || ledgerModule.default?.creditWalletWithLedger
    debitWalletWithLedger = ledgerModule.debitWalletWithLedger || ledgerModule.default?.debitWalletWithLedger

    const wallet = await createWalletRecord({
      entityType: 'SYSTEM',
      entityId: crypto.randomUUID(),
      walletType: 'system',
      walletKind: null,
      saccoId: null,
      matatuId: null,
      numericRef: Math.floor(Math.random() * 90000 + 10000),
    })
    walletId = wallet.id
  })

  afterAll(async () => {
  })

  it('credits wallet and writes ledger entry', async () => {
    const refId = `${runId}-credit`
    const result = await creditWalletWithLedger({
      walletId,
      amount: 75,
      entryType: 'MANUAL_ADJUSTMENT',
      referenceType: 'ADMIN',
      referenceId: refId,
      description: 'Test credit',
    })

    expect(result.balanceAfter).toBeGreaterThan(result.balanceBefore)

    const ledgerRes = await pool.query(
      `SELECT direction, entry_type, reference_type FROM wallet_ledger WHERE reference_id = $1 LIMIT 1`,
      [refId],
    )
    expect(ledgerRes.rows[0]?.direction).toBe('CREDIT')
    expect(ledgerRes.rows[0]?.entry_type).toBe('MANUAL_ADJUSTMENT')
    expect(ledgerRes.rows[0]?.reference_type).toBe('ADMIN')
  })

  it('prevents overdraft debits', async () => {
    await expect(
      debitWalletWithLedger({
        walletId,
        amount: 10_000_000,
        entryType: 'MANUAL_ADJUSTMENT',
        referenceType: 'ADMIN',
        referenceId: `${runId}-overdraft`,
      }),
    ).rejects.toThrow()
  })

  it('ledger rows cannot be updated or deleted', async () => {
    const refId = `${runId}-immutable`
    const insertRes = await creditWalletWithLedger({
      walletId,
      amount: 10,
      entryType: 'MANUAL_ADJUSTMENT',
      referenceType: 'ADMIN',
      referenceId: refId,
      description: 'Immutable test',
    })
    const ledgerIdRes = await pool.query(
      `SELECT id FROM wallet_ledger WHERE reference_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [refId],
    )
    const ledgerId = ledgerIdRes.rows[0]?.id
    expect(ledgerId).toBeTruthy()

    await expect(pool.query(`UPDATE wallet_ledger SET amount = 0 WHERE id = $1`, [ledgerId])).rejects.toThrow()
    await expect(pool.query(`DELETE FROM wallet_ledger WHERE id = $1`, [ledgerId])).rejects.toThrow()
  })
})
