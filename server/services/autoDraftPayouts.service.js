const crypto = require('crypto');
const pool = require('../db/pool');
const { normalizePayoutWalletKind } = require('./saccoPayouts.service');

const AUTO_USER_ID = '00000000-0000-0000-0000-000000000000';
const WALLET_KINDS = ['SACCO_FEE', 'SACCO_LOAN', 'SACCO_SAVINGS'];

function nairobiDateISO(input) {
  if (input) return String(input).slice(0, 10);
  const now = new Date();
  const nairobi = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
  return nairobi.toISOString().slice(0, 10);
}

function pickDestination(destinations = []) {
  const msisdnVerified = destinations.find(
    (d) => d.destination_type === 'MSISDN' && d.is_verified === true,
  );
  if (msisdnVerified) return { destination: msisdnVerified, status: 'PENDING', block_reason: null };

  const msisdnUnverified = destinations.find(
    (d) => d.destination_type === 'MSISDN' && !d.is_verified,
  );
  if (msisdnUnverified) {
    return {
      destination: msisdnUnverified,
      status: 'BLOCKED',
      block_reason: 'DESTINATION_NOT_VERIFIED',
    };
  }

  const paybill = destinations.find((d) => d.destination_type === 'PAYBILL_TILL');
  if (paybill) {
    return { destination: paybill, status: 'BLOCKED', block_reason: 'B2B_NOT_SUPPORTED' };
  }

  return { destination: null, status: 'BLOCKED', block_reason: 'DESTINATION_MISSING' };
}

async function runAutoDraftForDate({ settlementDate = nairobiDateISO(), dryRun = false } = {}) {
  const client = await pool.connect();
  const summary = { date: settlementDate, created: 0, skipped: 0, details: [] };

  try {
    const { rows: saccos } = await client.query(`SELECT id, name FROM saccos`);

    for (const sacco of saccos) {
      const saccoId = sacco.id;

      const existing = await client.query(
        `
          SELECT id
          FROM payout_batches
          WHERE sacco_id = $1
            AND date_to = $2
            AND COALESCE(meta->>'auto_draft','false') = 'true'
          LIMIT 1
        `,
        [saccoId, settlementDate],
      );
      if (existing.rows.length) {
        summary.skipped += 1;
        summary.details.push({ sacco_id: saccoId, reason: 'EXISTS' });
        continue;
      }

      const { rows: wallets } = await client.query(
        `
          SELECT id, wallet_kind, balance
          FROM wallets
          WHERE sacco_id = $1
            AND wallet_kind IN ('SACCO_DAILY_FEE','SACCO_LOAN','SACCO_SAVINGS')
        `,
        [saccoId],
      );
      const normalizedWallets = wallets.map((w) => ({
        ...w,
        wallet_kind: normalizePayoutWalletKind(w.wallet_kind),
        balance: Number(w.balance || 0),
      }));

      if (!normalizedWallets.length || normalizedWallets.every((w) => w.balance <= 0)) {
        summary.skipped += 1;
        summary.details.push({ sacco_id: saccoId, reason: 'NO_BALANCE' });
        continue;
      }

      const { rows: destRows } = await client.query(
        `
          SELECT id, destination_type, destination_ref, destination_name, is_verified
          FROM payout_destinations
          WHERE entity_type = 'SACCO' AND entity_id = $1
        `,
        [saccoId],
      );

      const byType = (kind) => {
        return destRows.filter((d) => d.destination_type && d.destination_type.length);
      };

      const batchId = crypto.randomUUID();
      const items = [];
      const suggested = {};
      const destIdByKind = {};
      let totalAmount = 0;

      for (const kind of WALLET_KINDS) {
        const wallet = normalizedWallets.find((w) => w.wallet_kind === kind);
        if (!wallet || wallet.balance <= 0) continue;

        const { destination, status, block_reason } = pickDestination(byType(kind));
        const amount = Math.round(wallet.balance * 100) / 100;
        suggested[kind] = amount;
        if (destination?.id) destIdByKind[kind] = destination.id;

        const destinationType = destination?.destination_type || 'MSISDN';
        const destinationRef =
          destination?.destination_ref || `MISSING-${kind}-${settlementDate}`.slice(0, 32);

        if (status === 'PENDING') totalAmount += amount;

        items.push({
          id: crypto.randomUUID(),
          wallet_id: wallet.id,
          wallet_kind: kind,
          amount,
          destination_type: destinationType,
          destination_ref: destinationRef,
          status,
          block_reason,
          idempotency_key: `BATCH:${batchId}:${kind}:${amount}:${destinationRef}`,
        });
      }

      if (!items.length) {
        summary.skipped += 1;
        summary.details.push({ sacco_id: saccoId, reason: 'NO_ITEMS' });
        continue;
      }

      await client.query('BEGIN');
      await client.query(
        `
          INSERT INTO payout_batches
            (id, sacco_id, date_from, date_to, status, created_by, total_amount, meta)
          VALUES
            ($1, $2, $3, $4, 'DRAFT', $5, $6, $7)
        `,
        [
          batchId,
          saccoId,
          settlementDate,
          settlementDate,
          AUTO_USER_ID,
          totalAmount,
          {
            auto_draft: true,
            auto_draft_run_id: settlementDate,
            suggested_amounts: suggested,
            destination_id_by_kind: destIdByKind,
          },
        ],
      );

      await client.query(
        `
          INSERT INTO payout_events
            (batch_id, actor_id, event_type, message, meta)
          VALUES
            ($1, $2, 'BATCH_AUTO_DRAFTED', 'Auto-drafted batch created', $3)
        `,
        [batchId, AUTO_USER_ID, { total_amount: totalAmount, date: settlementDate }],
      );

      for (const item of items) {
        await client.query(
          `
            INSERT INTO payout_items
              (id, batch_id, wallet_id, wallet_kind, amount, destination_type, destination_ref, status, idempotency_key, block_reason)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `,
          [
            item.id,
            batchId,
            item.wallet_id,
            item.wallet_kind,
            item.amount,
            item.destination_type,
            item.destination_ref,
            item.status,
            item.idempotency_key,
            item.block_reason,
          ],
        );
        await client.query(
          `
            INSERT INTO payout_events
              (batch_id, item_id, actor_id, event_type, message, meta)
            VALUES
              ($1, $2, $3, 'ITEM_AUTO_CREATED', 'Auto-drafted payout item', $4)
          `,
          [
            batchId,
            item.id,
            AUTO_USER_ID,
            { wallet_kind: item.wallet_kind, amount: item.amount, status: item.status },
          ],
        );
      }

      if (dryRun) {
        await client.query('ROLLBACK');
      } else {
        await client.query('COMMIT');
        summary.created += 1;
        summary.details.push({ sacco_id: saccoId, batch_id: batchId, items: items.length });
      }
    }

    return summary;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  runAutoDraftForDate,
  nairobiDateISO,
};

