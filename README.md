# TekeTeke React + API

React (Vite + TS) dashboards and Express API for payments, wallets, and sacco/matatu/taxi/boda ops, with Supabase-backed auth.

## Prerequisites
- Node 18+ (Node 20 recommended)
- Supabase project with service-role key
- PostgreSQL reachable via `SUPABASE_DB_URL` or `DATABASE_URL` (from Supabase)
- Daraja/M-PESA B2C credentials (for withdrawals)

## Environment
Copy `.env.example` to `.env` and fill:
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=          # or DATABASE_URL
DATABASE_URL=
SUPABASE_ANON_KEY=

# Use either MPESA_* or DARAJA_* consumer keys (both supported)
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
DARAJA_CONSUMER_KEY=
DARAJA_CONSUMER_SECRET=
DARAJA_CALLBACK_URL=https://your-domain.example/api/pay/stk/callback   # avoid "mpesa" in path; Safaricom blocks it
DARAJA_WEBHOOK_SECRET=     # required when MPESA_C2B_REQUIRE_SECRET=1
MPESA_B2C_SECURITY_CREDENTIAL=
MPESA_B2C_SHORTCODE=   # or DARAJA_SHORTCODE
MPESA_C2B_REQUIRE_SECRET=1 # enforce webhook secret for C2B callbacks

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

## Deploying to Railway (API)
1) Connect the GitHub repo to a new Railway service (Root directory = repo root). Build command can stay empty or `npm run build` if you want the Vite bundle served from `/app`; start command must be `npm start` (uses `server/server.js`).
2) Railway sets `PORT` automatically; keep it unset in your env. Set `NODE_ENV=production`.
3) Add secrets in the Railway Variables tab (see env table below). Never commit real secrets.
4) After the first deploy passes `/healthz`, attach your custom domain in Railway and point DNS (see Custom Domain).
5) Legacy VPS bits live at `ops/pm2` and `ops/nginx` plus `docs/deploy-digitalocean.md`; keep them for reference but they are not used on Railway.

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

## Queue / Worker (BullMQ)
- Queue is optional; if `REDIS_URL` is unset, fraud/alert jobs run inline.
- Env:
  - `REDIS_URL=redis://localhost:6379`
  - `QUEUE_PREFIX=teketeke` (optional)
  - `WORKER_CONCURRENCY=5` (optional)
- Apply the idempotency table once in prod: `ops/sql/mpesa_callback_events.sql`
- If you need auto-init for local/dev only, set `ALLOW_CALLBACK_TABLE_INIT=1`
- Run API: `npm run server`
- Run worker (separate process): `node server/worker.js`
- Job status (admin-only):
  - `GET /api/admin/jobs/:id`
  - `GET /api/admin/jobs?limit=50`

## Monitoring endpoints
- `GET /api/admin/monitoring/overview?from=&to=` (callback/withdrawal/wallet/job health)
- `GET /api/admin/monitoring/callbacks?from=&to=&result=&limit=`
- `GET /api/admin/monitoring/payouts?from=&to=&status=&limit=` (withdrawal status feed)
- `GET /api/admin/monitoring/jobs?limit=` (returns enabled=false if queue disabled)

## Intelligence dashboards
- `GET /api/admin/intelligence/overview?from=&to=` (system-wide growth/revenue/ops)
- `GET /api/admin/intelligence/trends?metric=&from=&to=`
- `GET /api/admin/intelligence/top-entities?kind=sacco|vehicle|route&from=&to=`
- `GET /api/sacco/intelligence/overview?from=&to=` (tenant-scoped)
- `GET /api/sacco/intelligence/vehicles?status=&from=&to=&limit=&offset=`

## Fraud / Anomaly (rules)
- SQL: `ops/sql/fraud_alerts.sql`
- Run detector: `POST /api/admin/fraud/run` (mode dry|write; queues when Redis/BullMQ available)
- List alerts: `GET /api/admin/fraud/alerts`
- Update status: `POST /api/admin/fraud/alerts/:id/status`
- UI: System → Alerts

## Wallet ledger (append-only)
- Schema: `wallet_ledger` (idempotent migration 069) with RLS allowing wallet members and system admins; update/delete are blocked by trigger.
- Write via services only:
  - Credits: `creditWalletWithLedger` (entry_type `C2B_CREDIT`/`STK_CREDIT` etc.)
- Debits: `debitWalletWithLedger` (entry_type `MANUAL_ADJUSTMENT` for withdrawals/ops)
- Read APIs:
  - `GET /api/wallets/:id/ledger` (access checks applied)
  - `GET /api/sacco/wallet-ledger?wallet_kind=&from=&to=` (SACCO admins)
  - `GET /api/wallets/owner-ledger?from=&to=` (Matatu owner wallets)
  - `GET /api/admin/wallet-ledger?wallet_id=...`
- Backfill helper: `node scripts/backfillWalletLedger.js` (use `APPLY=1` to write; default dry-run).

## Running locally
- API/Express: `npm run server` (serves `/api`, `/u`, `/mpesa`, `/public`, `/app` if built)
- Frontend (Vite dev): `npm run dev` (proxies `/api`, `/u`)
- Build frontend: `npm run build` then serve via Express at `/app`

## Telemetry/registry
- Registry/assignments are stored in Supabase tables via `/api/registry/*` (SYSTEM_ADMIN only).
- Device telemetry/heartbeat requires `x-telemetry-key: $TELEMETRY_TOKEN` and is stored in `device_telemetry` / `device_heartbeats`. Optional JSONL writes controlled by `TELEMETRY_ENABLE_STORAGE`.

## Useful scripts
- `npm run validate:env` - fail fast if critical env vars are missing
- `npm run verify:whoami` - Supabase auth check
- `npm run verify:prod` - prod connectivity check

## Tests / smoke
Smoke tests cover C2B/STK, reconciliation, and ops workflows. Run:
```
npm test
```
Suggested quick checks:
- `npm run validate:env`
- Hit `/healthz` and `/api/db/health` on the API
- Log in via `/login`, navigate to dashboards, and hit new routes:
  - `/system/finance`, `/system/monitoring`, `/ops`

Smoke test requirements:
- Requires `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Tests create and clean up temporary records; run against staging, not production
- ### Railway deploy: make sure latest commit is live
  - Service must be linked to this GitHub repo on branch `main` with “Deploy on push” enabled.
  - Ensure the service root/path matches this backend (watch path/rootDir set to repository root).
  - Start command should run the API (e.g., `node server/server.js`), not a different project.
  - Custom domain `api.teketeke.org` must be attached to exactly one Railway service; remove from any stale/old services.
  - To force a fresh deploy of the latest commit:
    - `git commit --allow-empty -m "trigger railway build"` && `git push`
    - or use Railway CLI: `railway link`, `railway up`, `railway status`, `railway deployments`
  - Deployment sanity checks (after deploy):
    - `curl -i https://api.teketeke.org/api/version` → 200, headers `x-teketeke-build`, `x-deployed-at`.
    - `curl -i -H "Authorization: Bearer <token>" https://api.teketeke.org/api/auth/me` → 200.
    - `curl -i -H "Authorization: Bearer <token>" https://api.teketeke.org/api/admin/monitoring/overview` → 200 or structured 403 with code + request_id (not bare forbidden).
- ### Domain routing sanity
  - In Railway → Domains, confirm `api.teketeke.org` is attached only to the intended API service.
  - Detach the domain from any old/stale services to avoid serving outdated code.
  - After any domain change, re-run the version check to confirm headers and commit match the latest deployment.
