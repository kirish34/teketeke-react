function pad(num, size = 4) {
  const s = String(num || '');
  if (s.length >= size) return s;
  return '0'.repeat(size - s.length) + s;
}

/**
 * Generate a virtual account code using a numeric reference.
 * MATATU -> MATxxxx, SACCO -> SACxxx, TAXI -> TAXxxxx, BODA -> BODxxxx
 */
function generateVirtualAccountCode(entityType, numericRef) {
  const n = Number(numericRef);
  switch ((entityType || '').toUpperCase()) {
    case 'MATATU':
      return `MAT${pad(n, 4)}`;
    case 'SACCO':
      return `SAC${pad(n, 3)}`;
    case 'TAXI':
      return `TAX${pad(n, 4)}`;
    case 'BODA':
    case 'BODABODA':
      return `BOD${pad(n, 4)}`;
    default:
      throw new Error(`Unknown entityType for wallet code: ${entityType}`);
  }
}

module.exports = {
  pad,
  generateVirtualAccountCode,
};
