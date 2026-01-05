const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { supabaseAdmin } = require('../supabase');
const { requireUser } = require('../middleware/auth');
const { insertPayoutEvent, normalizePayoutWalletKind } = require('../services/saccoPayouts.service');
const { checkB2CEnvPresence } = require('../services/payoutReadiness.service');

const router = express.Router();

if (!supabaseAdmin) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to serve sacco payout endpoints');
}

router.use(requireUser);

const DEST_TYPES = new Set(['PAYBILL_TILL', 'MSISDN']);
const WALLET_KINDS = ['SACCO_FEE', 'SACCO_LOAN', 'SACCO_SAVINGS'];

function normalizeRole(role) {
  return String(role || '').trim().toUpperCase();
}

function isSaccoAdminRole(role) {
  return role === 'SACCO' || role === 'SACCO_ADMIN';
}

async function getSaccoContext(userId) {
  const { data: roleRow, error } = await supabaseAdmin
    .from('user_roles')
    .select('role,sacco_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (roleRow?.sacco_id) {
    return { role: normalizeRole(roleRow.role), saccoId: roleRow.sacco_id };
  }
  const { data: staffRow, error: staffErr } = await supabaseAdmin
    .from('staff_profiles')
    .select('role,sacco_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (staffErr) throw staffErr;
  return { role: normalizeRole(staffRow?.role), saccoId: staffRow?.sacco_id || null };
}

async function requireSaccoAdmin(req, res, next) {
  try {
    const uid = req.user?.id;
    if (!uid) return res.status(401).json({ error: 'unauthorized' });
    const ctx = await getSaccoContext(uid);
    if (!ctx.saccoId || !isSaccoAdminRole(ctx.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    req.saccoId = ctx.saccoId;
    req.saccoRole = ctx.role;
    return next();
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to resolve sacco access' });
  }
}

function normalizeMsisdn(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  let normalized = digits;
  if (digits.startsWith('0')) normalized = `254${digits.slice(1)}`;
  else if (digits.startsWith('7') || digits.startsWith('1')) normalized = `254${digits}`;
  else if (digits.startsWith('254')) normalized = digits;
  else return '';
  return `+${normalized}`;
}

function isValidMsisdn(value) {
  return /^\+254(7\d{8}|1\d{8})$/.test(value);
}

function normalizeDestinationRef(type, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (type === 'MSISDN') return normalizeMsisdn(raw);
  return raw.replace(/\D/g, '');
}

function normalizeDateOnly(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

router.get('/payout-destinations', requireSaccoAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT *
        FROM payout_destinations
        WHERE entity_type = 'SACCO' AND entity_id = $1
        ORDER BY created_at DESC
      `,
      [req.saccoId],
    );
    return res.json({ ok: true, destinations: rows || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/payout-destinations', requireSaccoAdmin, async (req, res) => {
  try {
    const id = req.body?.id || null;
    const typeRaw = String(req.body?.destination_type || '').trim().toUpperCase();
    if (!DEST_TYPES.has(typeRaw)) {
      return res.status(400).json({ ok: false, error: 'Invalid destination_type' });
    }
    const normalizedRef = normalizeDestinationRef(typeRaw, req.body?.destination_ref);
    if (!normalizedRef) {
      return res.status(400).json({ ok: false, error: 'destination_ref required' });
    }
    if (typeRaw === 'MSISDN' && !isValidMsisdn(normalizedRef)) {
      return res.status(400).json({ ok: false, error: 'Invalid MSISDN format' });
    }
    const name = String(req.body?.destination_name || '').trim() || null;

    if (id) {
      const existing = await pool.query(
        `
          SELECT destination_type, destination_ref
          FROM payout_destinations
          WHERE id = $1 AND entity_id = $2
          LIMIT 1
        `,
        [id, req.saccoId],
      );
      if (!existing.rows.length) {
        return res.status(404).json({ ok: false, error: 'Destination not found' });
      }
      const resetVerify =
        existing.rows[0].destination_type !== typeRaw || existing.rows[0].destination_ref !== normalizedRef;
      const updateRes = await pool.query(
        `
          UPDATE payout_destinations
          SET destination_type = $1,
              destination_ref = $2,
              destination_name = $3,
              is_verified = CASE WHEN $4 THEN false ELSE is_verified END
          WHERE id = $5 AND entity_id = $6
          RETURNING *
        `,
        [typeRaw, normalizedRef, name, resetVerify, id, req.saccoId],
      );
      return res.json({ ok: true, destination: updateRes.rows[0] });
    }

    const insertRes = await pool.query(
      `
        INSERT INTO payout_destinations
          (entity_type, entity_id, destination_type, destination_ref, destination_name)
        VALUES
          ('SACCO', $1, $2, $3, $4)
        RETURNING *
      `,
      [req.saccoId, typeRaw, normalizedRef, name],
    );
    return res.json({ ok: true, destination: insertRes.rows[0] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/payout-readiness', requireSaccoAdmin, async (req, res) => {
  const dateFrom = normalizeDateOnly(req.query.date_from);
  const dateTo = normalizeDateOnly(req.query.date_to);
  if (!dateFrom || !dateTo) {
    return res.status(400).json({ ok: false, error: 'date_from and date_to are required (YYYY-MM-DD)' });
  }
  if (dateTo < dateFrom) {
    return res.status(400).json({ ok: false, error: 'date_to cannot be before date_from' });
  }

  try {
    const walletRes = await pool.query(
      `
        SELECT id, wallet_kind, balance
        FROM wallets
        WHERE sacco_id = $1
          AND wallet_kind IN ('SACCO_DAILY_FEE', 'SACCO_LOAN', 'SACCO_SAVINGS')
        ORDER BY wallet_kind
      `,
      [req.saccoId],
    );
    const walletBalances = walletRes.rows.map((row) => ({
      wallet_kind: normalizePayoutWalletKind(row.wallet_kind),
      wallet_id: row.id,
      balance: Number(row.balance || 0),
    }));

    const destRes = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total,
          SUM(
            CASE
              WHEN destination_type = 'MSISDN' AND is_verified THEN 1
              ELSE 0
            END
          )::int AS verified_msisdn_count
        FROM payout_destinations
        WHERE entity_type = 'SACCO' AND entity_id = $1
      `,
      [req.saccoId],
    );
    const destinations = destRes.rows[0] || { total: 0, verified_msisdn_count: 0 };

    const quarantinedRes = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM mpesa_c2b_payments p
        JOIN wallet_aliases wa
          ON wa.alias = p.account_reference
         AND wa.is_active = true
        JOIN wallets w
          ON w.id = wa.wallet_id
        WHERE w.sacco_id = $1
          AND p.status = 'QUARANTINED'
          AND p.created_at::date BETWEEN $2 AND $3
      `,
      [req.saccoId, dateFrom, dateTo],
    );
    const quarantineCount = quarantinedRes.rows[0]?.total || 0;

    const quarantineSampleRes = await pool.query(
      `
        SELECT q.id, q.received_at AS created_at, q.account_reference, q.reason
        FROM mpesa_c2b_quarantine q
        JOIN wallet_aliases wa
          ON wa.alias = q.account_reference
         AND wa.is_active = true
        JOIN wallets w
          ON w.id = wa.wallet_id
        WHERE w.sacco_id = $1
          AND q.received_at::date BETWEEN $2 AND $3
        ORDER BY q.received_at DESC
        LIMIT 5
      `,
      [req.saccoId, dateFrom, dateTo],
    );

    const envCheck = checkB2CEnvPresence(process.env);
    const positiveWallets = walletBalances.filter((row) => Number(row.balance || 0) > 0);

    const checks = {
      has_verified_msisdn_destination: {
        pass: Number(destinations.verified_msisdn_count || 0) > 0,
        reason:
          Number(destinations.verified_msisdn_count || 0) > 0
            ? 'Verified MSISDN destination available.'
            : 'No verified MSISDN destinations.',
        details: { verified_msisdn_count: Number(destinations.verified_msisdn_count || 0) },
      },
      no_quarantines_in_window: {
        pass: Number(quarantineCount || 0) === 0,
        reason:
          Number(quarantineCount || 0) === 0
            ? 'No quarantined payments in range.'
            : 'Quarantined payments exist in the selected window.',
        details: { count: Number(quarantineCount || 0) },
      },
      has_positive_balances: {
        pass: positiveWallets.length > 0,
        reason:
          positiveWallets.length > 0 ? 'Wallets with positive balance available.' : 'No wallets with positive balance.',
        details: {
          positive_wallet_kinds: positiveWallets.map((row) => row.wallet_kind),
        },
      },
      b2c_env_present: {
        pass: envCheck.pass,
        reason: envCheck.pass ? 'B2C environment configured.' : 'Missing B2C environment configuration.',
        details: envCheck.details || {},
      },
    };

    return res.json({
      ok: true,
      sacco_id: req.saccoId,
      date_from: dateFrom,
      date_to: dateTo,
      checks,
      wallet_balances: walletBalances,
      quarantines: {
        count: Number(quarantineCount || 0),
        sample: quarantineSampleRes.rows || [],
      },
      destinations: {
        total: Number(destinations.total || 0),
        verified_msisdn_count: Number(destinations.verified_msisdn_count || 0),
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/payout-batches', requireSaccoAdmin, async (req, res) => {
  const dateFrom = normalizeDateOnly(req.body?.date_from);
  const dateTo = normalizeDateOnly(req.body?.date_to);
  if (!dateFrom || !dateTo) {
    return res.status(400).json({ ok: false, error: 'date_from and date_to are required (YYYY-MM-DD)' });
  }
  if (dateTo < dateFrom) {
    return res.status(400).json({ ok: false, error: 'date_to cannot be before date_from' });
  }

  const kindsInput = Array.isArray(req.body?.wallet_kinds)
    ? req.body.wallet_kinds
    : Array.isArray(req.body?.include_wallet_kinds)
      ? req.body.include_wallet_kinds
      : [];
  const kinds = (kindsInput.length ? kindsInput : WALLET_KINDS)
    .map(normalizePayoutWalletKind)
    .filter((k) => WALLET_KINDS.includes(k));
  if (!kinds.length) {
    return res.status(400).json({ ok: false, error: 'No wallet kinds selected' });
  }

  const rawDestMap = req.body?.destination_id_by_kind || {};
  const destMap = {};
  Object.entries(rawDestMap).forEach(([key, value]) => {
    const normalizedKey = normalizePayoutWalletKind(key);
    if (WALLET_KINDS.includes(normalizedKey)) {
      destMap[normalizedKey] = value;
    }
  });
  const destIds = Array.from(
    new Set(
      kinds
        .map((kind) => destMap[kind] || null)
        .filter((value) => typeof value === 'string' && value.trim()),
    ),
  );
  if (!destIds.length) {
    return res.status(400).json({ ok: false, error: 'Destination selections required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const destRes = await client.query(
      `
        SELECT id, destination_type, destination_ref, destination_name, is_verified
        FROM payout_destinations
        WHERE entity_type = 'SACCO' AND entity_id = $1
          AND id = ANY($2::uuid[])
      `,
      [req.saccoId, destIds],
    );
    const destById = new Map(destRes.rows.map((row) => [row.id, row]));

    const walletRes = await client.query(
      `
        SELECT id, wallet_kind, balance
        FROM wallets
        WHERE sacco_id = $1
          AND wallet_kind IN ('SACCO_DAILY_FEE', 'SACCO_LOAN', 'SACCO_SAVINGS')
      `,
      [req.saccoId],
    );
    const walletByKind = new Map(
      walletRes.rows.map((row) => [normalizePayoutWalletKind(row.wallet_kind), row]),
    );

    const batchId = crypto.randomUUID();
    const createdBy = req.user?.id || null;
    let totalAmount = 0;
    const items = [];

    for (const kind of kinds) {
      const wallet = walletByKind.get(kind);
      if (!wallet) {
        throw new Error(`Missing wallet for ${kind}`);
      }
      const destinationId = destMap[kind];
      const destination = destById.get(destinationId);
      if (!destination) {
        throw new Error(`Missing destination for ${kind}`);
      }
      const amount = Number(wallet.balance || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        continue;
      }
      const itemId = crypto.randomUUID();
      const idempotencyKey = `BATCH:${batchId}:${kind}:${amount}:${destination.destination_ref}`;
      const isMsisdn = destination.destination_type === 'MSISDN';
      const status = isMsisdn ? 'PENDING' : 'BLOCKED';
      const blockReason = isMsisdn ? null : 'B2B_NOT_SUPPORTED';
      if (status === 'PENDING') totalAmount += amount;
      items.push({
        id: itemId,
        wallet_id: wallet.id,
        wallet_kind: kind,
        amount,
        destination_type: destination.destination_type,
        destination_ref: destination.destination_ref,
        idempotency_key: idempotencyKey,
        status,
        block_reason: blockReason,
      });
    }

    if (!items.length) {
      throw new Error('No wallet balances available to payout');
    }

    await client.query(
      `
        INSERT INTO payout_batches
          (id, sacco_id, date_from, date_to, status, created_by, total_amount, meta)
        VALUES
          ($1, $2, $3, $4, 'DRAFT', $5, $6, $7)
      `,
      [
        batchId,
        req.saccoId,
        dateFrom,
        dateTo,
        createdBy,
        totalAmount,
        { destination_id_by_kind: destMap },
      ],
    );

    await insertPayoutEvent({
      batchId,
      actorId: createdBy,
      eventType: 'BATCH_CREATED',
      message: 'Batch created',
      meta: { total_amount: totalAmount, wallet_kinds: kinds },
      client,
    });

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
      await insertPayoutEvent({
        batchId,
        itemId: item.id,
        actorId: createdBy,
        eventType: 'ITEM_CREATED',
        message: `Item created for ${item.wallet_kind}`,
        meta: { wallet_kind: item.wallet_kind, amount: item.amount, status: item.status, block_reason: item.block_reason },
        client,
      });
    }

    await client.query('COMMIT');
    return res.json({ ok: true, batch_id: batchId, total_amount: totalAmount, items });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(400).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

router.post('/payout-batches/:id/submit', requireSaccoAdmin, async (req, res) => {
  const batchId = req.params.id;
  if (!batchId) return res.status(400).json({ ok: false, error: 'batch id required' });
  try {
    const { rows: pendingRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM payout_items WHERE batch_id = $1 AND status = 'PENDING'`,
      [batchId],
    );
    if ((pendingRows[0]?.total || 0) < 1) {
      return res.status(400).json({ ok: false, error: 'No pending items to submit' });
    }
    const { rows } = await pool.query(
      `
        UPDATE payout_batches
        SET status = 'SUBMITTED'
        WHERE id = $1 AND sacco_id = $2 AND status = 'DRAFT'
        RETURNING *
      `,
      [batchId, req.saccoId],
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Batch not found or not in DRAFT' });
    }
    await insertPayoutEvent({
      batchId,
      actorId: req.user?.id || null,
      eventType: 'BATCH_SUBMITTED',
      message: 'Batch submitted',
      meta: {},
    });
    return res.json({ ok: true, batch: rows[0] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/payout-batches', requireSaccoAdmin, async (req, res) => {
  try {
    const params = [req.saccoId];
    const where = ['sacco_id = $1'];
    const from = normalizeDateOnly(req.query.from);
    const to = normalizeDateOnly(req.query.to);
    if (from) {
      params.push(from);
      where.push(`date_from >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`date_to <= $${params.length}`);
    }
    const whereClause = `WHERE ${where.join(' AND ')}`;
    const { rows } = await pool.query(
      `
        SELECT *
        FROM payout_batches
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT 200
      `,
      params,
    );
    return res.json({ ok: true, batches: rows || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/payout-batches/:id', requireSaccoAdmin, async (req, res) => {
  const batchId = req.params.id;
  if (!batchId) return res.status(400).json({ ok: false, error: 'batch id required' });
  try {
    const batchRes = await pool.query(
      `
        SELECT *
        FROM payout_batches
        WHERE id = $1 AND sacco_id = $2
        LIMIT 1
      `,
      [batchId, req.saccoId],
    );
    if (!batchRes.rows.length) {
      return res.status(404).json({ ok: false, error: 'Batch not found' });
    }
    const itemsRes = await pool.query(
      `
        SELECT
          pi.*,
          wl.id AS ledger_entry_id
        FROM payout_items pi
        LEFT JOIN wallet_ledger wl
          ON wl.reference_type = 'PAYOUT_ITEM'
         AND wl.reference_id = pi.id::text
        WHERE pi.batch_id = $1
        ORDER BY pi.created_at ASC
      `,
      [batchId],
    );
    const eventsRes = await pool.query(
      `
        SELECT *
        FROM payout_events
        WHERE batch_id = $1
        ORDER BY created_at ASC
      `,
      [batchId],
    );
    return res.json({
      ok: true,
      batch: batchRes.rows[0],
      items: itemsRes.rows || [],
      events: eventsRes.rows || [],
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
