const REQUIRED_B2C_ENV_KEYS = [
  'MPESA_B2C_SHORTCODE',
  'MPESA_B2C_INITIATOR_NAME',
  'MPESA_B2C_SECURITY_CREDENTIAL',
  'MPESA_B2C_PAYOUT_RESULT_URL',
  'MPESA_B2C_PAYOUT_TIMEOUT_URL',
];

const ISSUE_DEFINITIONS = {
  DESTINATION_NOT_VERIFIED: {
    message: 'Unverified MSISDN destinations selected.',
    hint: 'Ask a system admin to verify the MSISDN destination.',
  },
  QUARANTINES_PRESENT: {
    message: 'Quarantined payments exist in the date window.',
    hint: 'Resolve quarantined payments before approving payouts.',
  },
  NO_PENDING_ITEMS: {
    message: 'No pending MSISDN items are available.',
    hint: 'Ensure at least one MSISDN item is pending for this batch.',
  },
  INVALID_STATUS: {
    message: 'Batch status does not allow this action.',
    hint: 'Move the batch to the required status before continuing.',
  },
  ZERO_BALANCE: {
    message: 'Wallet balance is zero.',
    hint: 'Wait for collections or top up before submitting payouts.',
  },
  B2C_ENV_MISSING: {
    message: 'B2C environment configuration is missing.',
    hint: 'Set the MPESA_B2C_* environment variables on the server.',
  },
  B2B_NOT_SUPPORTED: {
    message: 'PayBill/Till payouts require manual transfer.',
    hint: 'Use MSISDN destinations for automated payouts.',
  },
};

function checkB2CEnvPresence(env = process.env) {
  const missing = REQUIRED_B2C_ENV_KEYS.filter((key) => !env[key]);
  const pass = missing.length === 0;
  return {
    pass,
    reason: pass ? 'B2C env present' : `Missing ${missing.length} B2C env keys`,
    details: { missing_keys: missing },
  };
}

function buildIssue(code, level, details = {}) {
  const def = ISSUE_DEFINITIONS[code] || {};
  return {
    code,
    level,
    message: def.message || 'Payout readiness issue.',
    hint: def.hint || null,
    details,
  };
}

function pushIssue(list, issue) {
  const existing = list.find((item) => item.code === issue.code);
  if (!existing) {
    list.push(issue);
    return;
  }
  if (issue.details && typeof issue.details === 'object') {
    existing.details = { ...(existing.details || {}), ...issue.details };
  }
}

function buildBatchReadiness({
  batch,
  summary,
  pendingMsisdnCount = 0,
  unverifiedMsisdnCount = 0,
  quarantinesCount = 0,
  envCheck = null,
} = {}) {
  const issues = [];
  const pendingCount = Number(summary?.pending_count || 0);
  const blockedCount = Number(summary?.blocked_count || 0);

  const submitFailures = [];
  if (batch?.status !== 'DRAFT') {
    submitFailures.push('Batch status must be DRAFT to submit.');
    pushIssue(issues, buildIssue('INVALID_STATUS', 'BLOCK', { action: 'submit', status: batch?.status }));
  }
  if (pendingCount < 1) {
    submitFailures.push('No pending items to submit.');
    pushIssue(issues, buildIssue('NO_PENDING_ITEMS', 'BLOCK', { action: 'submit' }));
  }

  const approveFailures = [];
  if (batch?.status !== 'SUBMITTED') {
    approveFailures.push('Batch status must be SUBMITTED to approve.');
    pushIssue(issues, buildIssue('INVALID_STATUS', 'BLOCK', { action: 'approve', status: batch?.status }));
  }
  if (pendingMsisdnCount < 1) {
    approveFailures.push('No pending MSISDN items to approve.');
    pushIssue(issues, buildIssue('NO_PENDING_ITEMS', 'BLOCK', { action: 'approve' }));
  }
  if (unverifiedMsisdnCount > 0) {
    approveFailures.push('Unverified MSISDN destinations selected.');
    pushIssue(
      issues,
      buildIssue('DESTINATION_NOT_VERIFIED', 'BLOCK', { count: unverifiedMsisdnCount }),
    );
  }
  if (quarantinesCount > 0) {
    approveFailures.push('Quarantined payments in date window.');
    pushIssue(
      issues,
      buildIssue('QUARANTINES_PRESENT', 'BLOCK', { count: quarantinesCount }),
    );
  }

  const processFailures = [];
  if (batch?.status !== 'APPROVED') {
    processFailures.push('Batch status must be APPROVED to process.');
    pushIssue(issues, buildIssue('INVALID_STATUS', 'BLOCK', { action: 'process', status: batch?.status }));
  }
  if (pendingMsisdnCount < 1) {
    processFailures.push('No pending MSISDN items to process.');
    pushIssue(issues, buildIssue('NO_PENDING_ITEMS', 'BLOCK', { action: 'process' }));
  }
  if (envCheck && envCheck.pass === false) {
    processFailures.push('B2C environment configuration missing.');
    pushIssue(
      issues,
      buildIssue('B2C_ENV_MISSING', 'BLOCK', { missing_keys: envCheck.details?.missing_keys || [] }),
    );
  }

  if (blockedCount > 0) {
    pushIssue(issues, buildIssue('B2B_NOT_SUPPORTED', 'WARN', { count: blockedCount }));
  }

  return {
    checks: {
      can_submit: {
        pass: submitFailures.length === 0,
        reason: submitFailures[0] || 'Ready to submit.',
      },
      can_approve: {
        pass: approveFailures.length === 0,
        reason: approveFailures[0] || 'Ready to approve.',
      },
      can_process: {
        pass: processFailures.length === 0,
        reason: processFailures[0] || 'Ready to process.',
      },
    },
    issues,
  };
}

module.exports = {
  REQUIRED_B2C_ENV_KEYS,
  checkB2CEnvPresence,
  buildBatchReadiness,
};
