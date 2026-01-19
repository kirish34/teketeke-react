require('dotenv').config();
const express = require('express');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');

const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const registryRouter = require('./routes/registry');
const telemetryRouter = require('./routes/telemetry');
const darajaB2CRouter = require('./routes/daraja-b2c');
const payoutReadinessRouter = require('./routes/payout-readiness');
const walletLedgerRouter = require('./routes/wallet-ledger');
const authRouter = require('./routes/auth');
const mpesaRouter = require('./routes/mpesa');

const app = express();
const trustProxy =
  process.env.TRUST_PROXY === '0' || process.env.TRUST_PROXY === 'false'
    ? false
    : process.env.TRUST_PROXY || (process.env.NODE_ENV === 'production' ? 1 : false);
app.set('trust proxy', trustProxy);

// Request ID middleware (before routes)
app.use((req, res, next) => {
  const incoming = (req.headers['x-request-id'] || req.headers['request-id'] || '').toString().trim();
  const id = incoming || randomUUID();
  req.requestId = id;
  res.set('x-request-id', id);
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

// CORS (whitelist via CORS_ORIGINS="https://app1,https://app2")
const defaultCors = [
  'https://teketeke.dev',
  'https://www.teketeke.dev',
  'https://api.teketeke.org',
  'https://teketeke-react.vercel.app',
  'https://teketeke-react-1oh3rpn5r-team-teke.vercel.app',
];
const envRailwayDomains = (process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_URL || process.env.RAILWAY_DOMAIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => s.replace(/^https?:\/\//, ''));
const allow = Array.from(new Set([
  ...defaultCors,
  ...(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
]));
const allowVercelPreview = (origin = '') => {
  try {
    const host = new URL(origin).hostname;
    return host.endsWith('.vercel.app') && host.startsWith('teketeke-react-');
  } catch {
    return false;
  }
};
const allowRailwayDomain = (origin = '') => {
  try {
    const { hostname } = new URL(origin);
    if (envRailwayDomains.some((d) => hostname === d || hostname === d.split(':')[0])) {
      return true;
    }
    return hostname.endsWith('.railway.app');
  } catch {
    return false;
  }
};
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allow.length === 0 || allow.includes(origin) || allowVercelPreview(origin) || allowRailwayDomain(origin)) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  exposedHeaders: ['x-railway-request-id', 'x-request-id'],
}));

// Security & logs
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limit for API routes (skip /u/* to avoid auth loops)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/u'),
});
app.use('/api', apiLimiter);

// Optional whitelist bypass for auth endpoints to skip any upstream guards.
if (process.env.AUTH_WHITELIST_BYPASS === '1') {
  app.use((req, res, next) => {
    const p = req.path;
    if (p === '/api/auth/me' || p === '/api/auth/context') {
      return authRouter(req, res, next);
    }
    return next();
  });
}

// robots for sensitive public pages
app.use((req, res, next) => {
  if (req.path === '/public/auth/login.html' || req.path === '/public/system/dashboard.html') {
    res.set('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

// static
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

// React build (keeps legacy /public alongside)
const reactDist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(path.join(reactDist, 'index.html'))) {
  app.use('/app', express.static(reactDist));
  app.get('/app/*', (_req, res) => {
    res.sendFile(path.join(reactDist, 'index.html'));
  });
}

// Auth routes mounted early to avoid greedy /api guards.
app.use('/api/auth', (req, _res, next) => {
  if (process.env.DEBUG_AUTH_MOUNT === '1') {
    console.log('[mount] /api/auth hit', req.method, req.path);
  }
  next();
}, authRouter);

// routes
app.use('/u', require('./routes/user'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/pay', require('./routes/pay-daraja'));
app.use('/mpesa', mpesaRouter);
app.use('/api/mpesa', mpesaRouter);
app.use('/api/taxi', require('./routes/taxi'));
app.use('/api/boda', require('./routes/boda'));
app.use('/api/signup', require('./routes/signup'));
app.use('/api/db', require('./routes/db'));
// Skip auth-heavy routers for mpesa callbacks to avoid 401s
const skipMpesa = (router) => (req, res, next) => {
  if (req.path.startsWith('/mpesa')) return next();
  return router(req, res, next);
};

app.use('/api', skipMpesa(registryRouter));
app.use('/api', skipMpesa(telemetryRouter));
app.use('/api', skipMpesa(darajaB2CRouter));
app.use('/api', skipMpesa(payoutReadinessRouter));
app.use('/api/sacco', require('./routes/sacco-payouts'));
app.use('/api', skipMpesa(walletLedgerRouter));
app.use('/test', require('./routes/wallet'));
app.use('/', require('./routes/wallet-withdraw'));
app.use('/api/admin', require('./routes/admin-withdrawals'));
app.use('/api/admin', require('./routes/admin-matatu-payout'));
app.use('/api/admin', require('./routes/admin-vehicle-payout'));
app.use('/api/admin', require('./routes/admin-sms'));
app.use('/', require('./routes/sacco'));

// Daraja C2B aliases (Safaricom blocks "mpesa" substring in RegisterURL)
if (mpesaRouter.handleC2BValidation) {
  app.post('/validation', mpesaRouter.handleC2BValidation);
}
if (mpesaRouter.handleC2BConfirmation) {
  app.post('/confirmation', mpesaRouter.handleC2BConfirmation);
}

// health (works on Vercel via rewrite /healthz -> /api/index.js)
app.get(['/healthz', '/api/healthz'], (req, res) => {
  const accept = (req.headers.accept || '').toLowerCase();
  if (accept.includes('application/json')) {
    return res.status(200).json({ ok: true, mode: 'real' });
  }
  return res.status(200).type('text/plain').send('ok');
});

const PORT = Number(process.env.PORT || 8080);
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TekeTeke API listening on ${PORT}`);
  });
}

// 404 fallback to avoid hanging in serverless when route not matched
app.use((req, res, _next) => {
  res
    .status(404)
    .json({ error: 'not_found', path: req.path, url: req.originalUrl, request_id: req.requestId || null });
});

// error handler (last)
app.use((err, req, res, _next) => {
  console.error(err);
  const id = req.requestId || req.headers['x-request-id'] || '';
  res.status(500).json({ error: 'server_error', request_id: id || null });
});

module.exports = app;
