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
DARAJA_CALLBACK_URL=https://your-domain.example/api/pay/stk/callback   # avoid "mpesa" in path; Safaricom blocks it
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
- Queue is optional; if `REDIS_URL` is unset payout processing falls back to inline mode.
- Env:
  - `REDIS_URL=redis://localhost:6379`
  - `QUEUE_PREFIX=teketeke` (optional)
  - `WORKER_CONCURRENCY=5` (optional)
- Apply the idempotency table once in prod: `ops/sql/mpesa_callback_events.sql`
- Run API: `npm run server`
- Run worker (separate process): `node server/worker.js`
- Job status (admin-only):
  - `GET /api/admin/jobs/:id`
  - `GET /api/admin/jobs?limit=50&name=PAYOUT_BATCH_PROCESS`

## Monitoring endpoints
- `GET /api/admin/monitoring/overview?from=&to=` (callback/payout/wallet/job health)
- `GET /api/admin/monitoring/callbacks?from=&to=&result=&limit=`
- `GET /api/admin/monitoring/payouts?from=&to=&status=&limit=`
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

## SACCO payouts (manual approval, B2C-only)
Flow:
1) SACCO admin sets payout destinations (MSISDN or PayBill/Till) in the SACCO dashboard.
2) SACCO admin creates a payout batch (DRAFT) and submits it.
3) System admin verifies MSISDN destinations, approves, and processes the batch.
4) B2C callbacks confirm/failed items; wallet debits occur on CONFIRMED.
Notes:
- Only MSISDN destinations are automated in v1.
- PayBill/Till destinations are stored but payout items are marked `BLOCKED` with `B2B_NOT_SUPPORTED`.
- Amounts per wallet kind must be > 0, within `MIN_PAYOUT_AMOUNT_KES`/`MAX_PAYOUT_AMOUNT_KES` (defaults 10/150000 KES), and cannot exceed wallet balance.
Auto-draft batches (optional):
- Enable with `FEATURE_AUTO_DRAFT_PAYOUTS=true`.
- Run `node scripts/runAutoDraftPayouts.js` (cron example: `30 20 * * * node scripts/runAutoDraftPayouts.js`) to create DRAFT batches with `meta.auto_draft=true` / `meta.auto_draft_run_id=<date>`.
- Suggested amounts default to full wallet balances; wallets with zero balance are skipped.
- Items missing verified MSISDN destinations are `BLOCKED` (`DESTINATION_NOT_VERIFIED` / `DESTINATION_MISSING` / `B2B_NOT_SUPPORTED`); reruns skip if an auto-draft already exists for the sacco+date.
Payout readiness checks:
- `GET /api/sacco/payout-readiness?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`
- `GET /api/payout-batches/:id/readiness`

Endpoints:
- SACCO:
  - `GET /api/sacco/payout-destinations`
  - `POST /api/sacco/payout-destinations`
  - `POST /api/sacco/payout-batches` (partial amounts per wallet_kind via `items[]`)
  - `POST /api/sacco/payout-batches/:id/update` (edit items while status = DRAFT)
  - `POST /api/sacco/payout-batches/:id/submit`
  - `GET /api/sacco/payout-batches`
  - `DELETE /api/sacco/payout-batches/:id` (discard DRAFT only)
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

## Wallet ledger (append-only)
- Schema: `wallet_ledger` (idempotent migration 069) with RLS allowing wallet members and system admins; update/delete are blocked by trigger.
- Write via services only:
  - Credits: `creditWalletWithLedger` (entry_type `C2B_CREDIT`/`STK_CREDIT` etc.)
  - Debits: `debitWalletWithLedger` (entry_type `PAYOUT_DEBIT` for payouts)
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
- `node scripts/runAutoDraftPayouts.js` - auto-draft DRAFT payout batches (requires `FEATURE_AUTO_DRAFT_PAYOUTS=true`)

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
    - `curl -i -H "Authorization: Bearer <token>" https://api.teketeke.org/api/sacco/payout-destinations` → 200 or structured 403 with code + request_id (not bare forbidden).
- ### Domain routing sanity
  - In Railway → Domains, confirm `api.teketeke.org` is attached only to the intended API service.
  - Detach the domain from any old/stale services to avoid serving outdated code.
  - After any domain change, re-run the version check to confirm headers and commit match the latest deployment.
