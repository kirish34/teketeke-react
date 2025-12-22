/**
 * Fee for BANK withdrawals (EFT/RTGS).
 * 0.5% of amount.
 */
function calculateBankWithdrawalFee(amount) {
  const amt = Number(amount) || 0;
  if (amt <= 0) return 0;
  return amt * 0.005;
}

/**
 * Fee for M-PESA withdrawals.
 * payoutMode:
 *  - 'END_OF_DAY' => free
 *  - 'INSTANT'    => tiered fee
 */
function calculateMobileWithdrawalFee(amount, payoutMode = 'INSTANT') {
  const amt = Number(amount) || 0;
  if (amt <= 0) return 0;

  if (payoutMode === 'END_OF_DAY') {
    return 0;
  }

  if (amt >= 1 && amt <= 100) return 5;
  if (amt >= 101 && amt <= 1500) return 10;
  if (amt >= 1501 && amt <= 5000) return 15;
  if (amt >= 5001 && amt <= 20000) return 25;
  if (amt >= 20001 && amt <= 250000) return 35;

  // Cap at highest tier
  return 35;
}

module.exports = {
  calculateBankWithdrawalFee,
  calculateMobileWithdrawalFee,
};
