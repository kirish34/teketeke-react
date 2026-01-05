# TekeTeke React + API

React (Vite + TS) dashboards and Express API for payouts, sacco/matatu/taxi/boda ops, Supabase-backed auth and wallet flows.

## Prerequisites
- Node 18+ (Node 20 recommended)
- Supabase project with service-role key
- PostgreSQL reachable via `SUPABASE_DB_URL` (from Supabase)
- Daraja/M-PESA B2C credentials (for payouts)

## Environment
Copy `.env.example` to `.env` and fill:
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=
SUPABASE_ANON_KEY=

DARAJA_CONSUMER_KEY=
DARAJA_CONSUMER_SECRET=
DARAJA_CALLBACK_URL=
MPESA_B2C_SECURITY_CREDENTIAL=
MPESA_B2C_SHORTCODE=   # or DARAJA_SHORTCODE

TELEMETRY_TOKEN=       # shared key for device telemetry
TELEMETRY_ENABLE_STORAGE=true   # set false to disable JSONL writes
```

Validate required vars:
```
npm run validate:env
```

## Install
```
npm install
```

## Database
Apply SQL migrations to Supabase/Postgres:
```
npm run migrate
```
Seed any role users if needed:
```
npm run seed:roles
```

## C2B account references
- PayBill C2B callbacks enforce `paybill_number === '4814003'`; mismatches are quarantined.
- Manual PayBill `AccountReference` uses a 7-digit `PAYBILL_CODE` alias (prefix+subtype+seq4+checksum) mapped in `wallet_aliases`.
- STK `AccountReference` uses the matatu plate (`PLATE` alias) and credits the same wallet.
- Backfill paybill codes by wallet kind: `node scripts/backfillPaybillCodesByKind.js`
- Backfill existing matatu plate aliases: `node scripts/backfillWalletAliases.js`

## Reconciliation + ops tooling
- Run daily reconciliation (Africa/Nairobi): `node scripts/runDailyReconciliation.js --date=YYYY-MM-DD`
- Reconciliation meaning:
  - `reconciliation_daily` = PayBill 4814003 C2B compliance totals only
  - `reconciliation_daily_channels` = C2B vs STK breakdown
  - Combined totals are derived in the API/UI (not stored)
- Backfill risk scoring (optional): `node scripts/backfillC2BRisk.js --from=YYYY-MM-DD --to=YYYY-MM-DD`
- Risk tuning envs: `C2B_RISK_LARGE_AMOUNT`, `C2B_RISK_RAPID_FIRE_COUNT`, `C2B_RISK_RAPID_FIRE_WINDOW_SEC`, `C2B_RISK_MULTI_ALIAS_COUNT`
- Admin endpoints:
  - `GET /api/admin/reconciliation?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - `GET /api/admin/c2b/quarantine?status=QUARANTINED`
  - `POST /api/admin/c2b/:id/resolve`
  - `GET /api/admin/ops-alerts`

## SACCO payouts (manual approval, B2C-only)
Flow:
1) SACCO admin sets payout destinations (MSISDN or PayBill/Till) in the SACCO dashboard.
2) SACCO admin creates a payout batch (DRAFT) and submits it.
3) System admin verifies MSISDN destinations, approves, and processes the batch.
4) B2C callbacks confirm/failed items; wallet debits occur on CONFIRMED.
Notes:
- Only MSISDN destinations are automated in v1.
- PayBill/Till destinations are stored but payout items are marked `BLOCKED` with `B2B_NOT_SUPPORTED`.
Payout readiness checks:
- `GET /api/sacco/payout-readiness?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`
- `GET /api/payout-batches/:id/readiness`

Endpoints:
- SACCO:
  - `GET /api/sacco/payout-destinations`
  - `POST /api/sacco/payout-destinations`
  - `POST /api/sacco/payout-batches`
  - `POST /api/sacco/payout-batches/:id/submit`
  - `GET /api/sacco/payout-batches`
- System admin:
  - `POST /api/admin/payout-destinations/:id/verify`
  - `GET /api/admin/payout-batches?status=SUBMITTED`
  - `POST /api/admin/payout-batches/:id/approve`
  - `POST /api/admin/payout-batches/:id/process`
- B2C callbacks:
  - `POST /api/mpesa/b2c/result` (always returns 200 OK)
  - `POST /api/mpesa/b2c/timeout` (always returns 200 OK)

Payout B2C env (required for payouts/readiness):
- `MPESA_B2C_PAYOUT_RESULT_URL` (can match `MPESA_B2C_RESULT_URL`)
- `MPESA_B2C_PAYOUT_TIMEOUT_URL` (can match `MPESA_B2C_TIMEOUT_URL`)
- `MPESA_B2C_MOCK=1` (tests only; skips real Daraja calls)
Locked settings:
- `MPESA_B2C_SHORTCODE` must be `3020891` for all B2C payouts (PartyA).

## Running locally
- API/Express: `npm run server` (serves `/api`, `/u`, `/mpesa`, `/public`, `/app` if built)
- Frontend (Vite dev): `npm run dev` (proxies `/api`, `/u`)
- Build frontend: `npm run build` then serve via Express at `/app`

## Payout pipeline
Two options (pick one):
1) Supabase Edge cron: deploy `supabase/functions/b2c-worker` and schedule every 1-5 minutes with `x-worker-secret=WORKER_SECRET`. Configure Daraja callbacks to `.../functions/v1/b2c-result` and `.../functions/v1/b2c-timeout`.
2) Node worker: run `node server/workers/payout-processor.js` as a managed service with the same envs.

Health checks:
```
npm run check:payouts   # checks worker heartbeat/stuck processing via payout_worker_monitor_v
```

## Telemetry/registry
- Registry/assignments are stored in Supabase tables via `/api/registry/*` (SYSTEM_ADMIN only).
- Device telemetry/heartbeat requires `x-telemetry-key: $TELEMETRY_TOKEN` and is stored in `device_telemetry` / `device_heartbeats`. Optional JSONL writes controlled by `TELEMETRY_ENABLE_STORAGE`.

## Useful scripts
- `npm run validate:env` - fail fast if critical env vars are missing
- `npm run check:payouts` - payout pipeline health
- `npm run verify:whoami` - Supabase auth check
- `npm run verify:prod` - prod connectivity check

## Tests / smoke
Smoke tests cover C2B/STK, reconciliation, and ops workflows. Run:
```
npm test
```
Suggested quick checks:
- `npm run validate:env`
- `npm run check:payouts`
- Hit `/healthz` and `/api/db/health` on the API
- Log in via `/login`, navigate to dashboards, and hit new routes:
  - `/system/payouts`, `/sacco/approvals`, `/system/worker-monitor`, `/ops`

Smoke test requirements:
- Requires `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Tests create and clean up temporary records; run against staging, not production
