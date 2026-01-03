export const PAYBILL_NUMBER = '4814003'
export const PAYBILL_HELP =
  'Account Number is 7 digits (last digit is checksum). Always type all 7 digits.'

export type PaybillAliasRow = {
  entity_id?: string
  entity_type?: string
  wallet_kind?: string
  alias?: string
  alias_type?: string
}

type PaybillCodes = {
  fee?: string
  loan?: string
  savings?: string
  owner?: string
  vehicle?: string
  plate?: string
  driver?: string
  rider?: string
}

const PREFIX_KIND_MAP: Record<string, string> = {
  '30': 'SACCO_DAILY_FEE',
  '31': 'SACCO_LOAN',
  '32': 'SACCO_SAVINGS',
  '10': 'MATATU_OWNER',
  '11': 'MATATU_VEHICLE',
  '40': 'TAXI_DRIVER',
  '50': 'BODA_RIDER',
}

export function resolveWalletKind(row: PaybillAliasRow) {
  const kind = String(row.wallet_kind || '').trim().toUpperCase()
  if (kind) return kind
  const alias = String(row.alias || '')
  const prefix = alias.slice(0, 2)
  return PREFIX_KIND_MAP[prefix] || ''
}

export function mapPaybillCodes(rows: PaybillAliasRow[]) {
  const codes: PaybillCodes = {
    fee: '',
    loan: '',
    savings: '',
    owner: '',
    vehicle: '',
    plate: '',
    driver: '',
    rider: '',
  }

  rows.forEach((row) => {
    const alias = row.alias || ''
    const aliasType = String(row.alias_type || '').toUpperCase()
    if (aliasType === 'PLATE') {
      codes.plate = alias
      return
    }
    if (aliasType !== 'PAYBILL_CODE') return

    const kind = resolveWalletKind(row)
    if (kind === 'SACCO_DAILY_FEE') codes.fee = alias
    if (kind === 'SACCO_LOAN') codes.loan = alias
    if (kind === 'SACCO_SAVINGS') codes.savings = alias
    if (kind === 'MATATU_OWNER') codes.owner = alias
    if (kind === 'MATATU_VEHICLE') codes.vehicle = alias
    if (kind === 'TAXI_DRIVER') codes.driver = alias
    if (kind === 'BODA_RIDER') codes.rider = alias
  })

  return codes
}
