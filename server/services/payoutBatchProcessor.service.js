const pool = require('../db/pool');
const { sendB2CPayout } = require('../mpesa/mpesaB2C.service');
const { insertPayoutEvent, updateBatchStatusFromItems } = require('./saccoPayouts.service');
const { createOpsAlert } = require('./opsAlerts.service');
const { logAdminAction } = require('./audit.service');
const { shouldQuarantine, quarantineOperation } = require('./quarantine.service');

function buildAuditReq({ actorUserId, actorRole, requestId }) {
  return {
    user: { id: actorUserId || null, role: actorRole || null },
    requestId: requestId || null,
  };
}

async function processPayoutBatch({ batchId, actorUserId = null, actorRole = null, requestId = null }) {
  if (!batchId) throw new Error('batch id required');

  const auditReq = buildAuditReq({ actorUserId, actorRole, requestId });
  const batchRes = await pool.query(
    `
      SELECT *
      FROM payout_batches
      WHERE id = $1
      LIMIT 1
    `,
    [batchId],
  );
  if (!batchRes.rows.length) throw new Error('batch not found');
  const batch = batchRes.rows[0];
  if (!['APPROVED', 'PROCESSING'].includes(batch.status)) {
    throw new Error('batch not approved for processing');
  }

  if (batch.status !== 'PROCESSING') {
    await pool.query(`UPDATE payout_batches SET status = 'PROCESSING' WHERE id = $1`, [batchId]);
    await insertPayoutEvent({
      batchId,
      actorId: actorUserId || null,
      eventType: 'BATCH_PROCESSING',
      message: 'Batch processing started',
      meta: {},
    });
  }

  const itemsRes = await pool.query(
    `
      SELECT *
      FROM payout_items
      WHERE batch_id = $1
      ORDER BY created_at ASC
    `,
    [batchId],
  );
  const items = itemsRes.rows || [];
  const results = [];

  for (const item of items) {
    if (item.status !== 'PENDING') continue;
    if (item.provider_request_id) {
      results.push({ id: item.id, status: 'ALREADY_SENT' });
      continue;
    }

    const qDecision = await shouldQuarantine({
      operationType: 'PAYOUT_ITEM',
      entityType: 'MSISDN',
      entityId: item.destination_ref || null,
      db: pool,
    });
    if (qDecision.quarantine) {
      await quarantineOperation({
        operationType: 'PAYOUT_ITEM',
        operationId: item.id,
        entityType: 'MSISDN',
        entityId: item.destination_ref || null,
        reason: qDecision.reason || 'quarantined',
        source: qDecision.alert_id ? 'FRAUD_ALERT' : 'RISK_SCORE',
        severity: qDecision.severity || 'high',
        alert_id: qDecision.alert_id || null,
        incident_id: qDecision.incident_id || null,
        actorReq: auditReq,
        db: pool,
      });
      await insertPayoutEvent({
        batchId,
        itemId: item.id,
        actorId: actorUserId || null,
        eventType: 'ITEM_QUARANTINED',
        message: 'Payout quarantined by risk controls',
        meta: { reason: qDecision.reason || 'quarantined' },
      });
      results.push({ id: item.id, status: 'QUARANTINED' });
      continue;
    }

    if (item.destination_type !== 'MSISDN') {
      const updated = await pool.query(
        `
          UPDATE payout_items
          SET status = 'BLOCKED',
              block_reason = 'B2B_NOT_SUPPORTED'
          WHERE id = $1 AND status = 'PENDING'
          RETURNING *
        `,
        [item.id],
      );
      if (updated.rows.length) {
        await insertPayoutEvent({
          batchId,
          itemId: item.id,
          actorId: actorUserId || null,
          eventType: 'ITEM_BLOCKED',
          message: 'Manual transfer required (B2B not supported)',
          meta: { reason: 'B2B_NOT_SUPPORTED' },
        });
        results.push({ id: item.id, status: 'BLOCKED' });
      }
      continue;
    }

    const claim = await pool.query(
      `
        UPDATE payout_items
        SET status = 'SENDING',
            updated_at = now()
        WHERE id = $1
          AND status = 'PENDING'
          AND provider_request_id IS NULL
        RETURNING *
      `,
      [item.id],
    );
    if (!claim.rows.length) continue;
    const claimedItem = claim.rows[0];

    try {
      const b2cRes = await sendB2CPayout({
        payoutItemId: claimedItem.id,
        amount: claimedItem.amount,
        phoneNumber: claimedItem.destination_ref,
        idempotencyKey: claimedItem.idempotency_key,
      });
      if (b2cRes.providerRequestId || b2cRes.conversationId || b2cRes.originatorConversationId) {
        await pool.query(
          `
            UPDATE payout_items
            SET provider_request_id = COALESCE(provider_request_id, $2),
                provider_conversation_id = COALESCE(provider_conversation_id, $3),
                sent_at = COALESCE(sent_at, now()),
                provider_ack = CASE
                  WHEN provider_ack IS NULL OR provider_ack = '{}'::jsonb THEN $4
                  ELSE provider_ack
                END,
                status = 'SENT',
                updated_at = now()
            WHERE id = $1
              AND status = 'SENDING'
              AND provider_request_id IS NULL
          `,
          [
            claimedItem.id,
            b2cRes.originatorConversationId || b2cRes.providerRequestId || null,
            b2cRes.conversationId || null,
            b2cRes.response || null,
          ],
        );
      }
      await insertPayoutEvent({
        batchId,
        itemId: item.id,
        actorId: actorUserId || null,
        eventType: 'ITEM_SENT',
        message: 'B2C payout sent',
        meta: {
          provider_request_id: b2cRes.providerRequestId || null,
          provider_conversation_id: b2cRes.conversationId || null,
          response: b2cRes.response,
        },
      });
      results.push({ id: item.id, status: 'SENT' });
    } catch (err) {
      await pool.query(
        `
          UPDATE payout_items
          SET status = 'FAILED',
              failure_reason = $2
          WHERE id = $1
        `,
        [item.id, err.message || 'B2C send failed'],
      );
      await pool.query(
        `
          UPDATE wallet_holds
          SET status = 'released', released_at = now()
          WHERE reference_type = 'PAYOUT_ITEM'
            AND reference_id = $1
            AND status = 'active'
        `,
        [item.id],
      );
      await insertPayoutEvent({
        batchId,
        itemId: item.id,
        actorId: actorUserId || null,
        eventType: 'ITEM_FAILED',
        message: 'B2C send failed',
        meta: { error: err.message },
      });
      await createOpsAlert({
        type: 'PAYOUT_ITEM_FAILED',
        severity: 'WARN',
        entity_type: 'SACCO',
        entity_id: String(batch.sacco_id || ''),
        payment_id: null,
        message: 'B2C payout send failed.',
        meta: { batch_id: batchId, item_id: item.id, error: err.message },
      });
      results.push({ id: item.id, status: 'FAILED' });
    }
  }

  const updatedBatch = await updateBatchStatusFromItems({
    batchId,
    actorId: actorUserId || null,
  });

  await logAdminAction({
    req: auditReq,
    action: 'payout_batch_process',
    resource_type: 'payout_batch',
    resource_id: batchId,
    payload: { sacco_id: batch.sacco_id, total_amount: batch.total_amount, mode: 'worker' },
  });

  return { ok: true, results, batch_status: updatedBatch?.status || 'PROCESSING' };
}

module.exports = {
  processPayoutBatch,
};
