function normalizeMsisdn(input) {
  if (!input) return null;
  const cleaned = String(input).replace(/[^\d]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('254') && cleaned.length === 12 && cleaned.slice(3, 4) === '7') {
    return cleaned;
  }
  if (cleaned.length === 10 && cleaned.startsWith('07')) {
    return `254${cleaned.slice(1)}`;
  }
  if (cleaned.length === 9 && cleaned.startsWith('7')) {
    return `254${cleaned}`;
  }
  return null;
}

function maskMsisdn(msisdn) {
  const norm = normalizeMsisdn(msisdn);
  if (!norm) return null;
  // Mask middle digits: 2547******123
  const head = norm.slice(0, 4);
  const tail = norm.slice(-3);
  return `${head}******${tail}`;
}

function extractMsisdnFromRaw(raw) {
  if (!raw) return null;
  let payload = raw;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      return normalizeMsisdn(raw);
    }
  }
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [];
  const keys = ['MSISDN', 'msisdn', 'phone', 'phone_number', 'customer_phone'];
  keys.forEach((k) => {
    if (payload[k]) candidates.push(payload[k]);
  });
  if (payload.Body && typeof payload.Body === 'object') {
    keys.forEach((k) => {
      if (payload.Body[k]) candidates.push(payload.Body[k]);
    });
  }
  if (payload.Result && typeof payload.Result === 'object') {
    keys.forEach((k) => {
      if (payload.Result[k]) candidates.push(payload.Result[k]);
    });
  }
  const cbItems =
    payload?.Body?.stkCallback?.CallbackMetadata?.Item ||
    payload?.stkCallback?.CallbackMetadata?.Item ||
    payload?.CallbackMetadata?.Item ||
    payload?.Result?.CallbackMetadata?.Item ||
    null;
  if (Array.isArray(cbItems)) {
    cbItems.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const name = String(item.Name || item.name || '').toLowerCase();
      if (name === 'phonenumber' || name === 'msisdn' || name === 'phone') {
        candidates.push(item.Value || item.value || null);
      }
    });
  }
  for (const candidate of candidates) {
    const norm = normalizeMsisdn(candidate);
    if (norm) return norm;
  }
  return null;
}

function safeDisplayMsisdn({ display_msisdn, msisdn_normalized }) {
  return display_msisdn || maskMsisdn(msisdn_normalized) || 'Unknown';
}

// Backward compatibility alias
const msisdnDisplay = maskMsisdn;

module.exports = {
  normalizeMsisdn,
  maskMsisdn,
  msisdnDisplay,
  extractMsisdnFromRaw,
  safeDisplayMsisdn,
};
