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

function extractSenderNameFromRaw(raw) {
  if (!raw) return null;
  let payload = raw;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== 'object') return null;

  const normalizeValue = (value) => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  };

  const buildFromParts = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    const first = normalizeValue(obj.FirstName || obj.first_name || obj.firstName || obj.firstname);
    const middle = normalizeValue(obj.MiddleName || obj.middle_name || obj.middleName || obj.middlename);
    const last = normalizeValue(obj.LastName || obj.last_name || obj.lastName || obj.lastname);
    const parts = [first, middle, last].filter(Boolean);
    if (parts.length) return parts.join(' ');
    const direct = normalizeValue(
      obj.FullName ||
        obj.full_name ||
        obj.fullName ||
        obj.fullname ||
        obj.Name ||
        obj.name ||
        obj.CustomerName ||
        obj.customer_name ||
        obj.SenderName ||
        obj.sender_name ||
        obj.PayerName ||
        obj.payer_name,
    );
    return direct || null;
  };

  const candidates = [
    payload,
    payload.callback,
    payload.Callback,
    payload.Body,
    payload.Result,
    payload.transaction,
    payload.sender,
    payload.data,
  ];

  for (const candidate of candidates) {
    const name = buildFromParts(candidate);
    if (name) return name;
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
  extractSenderNameFromRaw,
  safeDisplayMsisdn,
};
