require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

// CORS (whitelist via CORS_ORIGINS="https://app1,https://app2")
const defaultCors = [
  'https://teketeke.dev',
  'https://www.teketeke.dev',
  'https://api.teketeke.dev',
  'https://teketeke-react.vercel.app',
  'https://teketeke-react-1oh3rpn5r-team-teke.vercel.app',
];
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
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allow.length === 0 || allow.includes(origin) || allowVercelPreview(origin)) {
      return cb(null, true);
    }
    return cb(new null, false);
  },
  credentials: true
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

// routes
app.use('/u', require('./routes/user'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/pay', require('./routes/pay-daraja'));
app.use('/api/taxi', require('./routes/taxi'));
app.use('/api/boda', require('./routes/boda'));
app.use('/api/signup', require('./routes/signup'));
app.use('/api/db', require('./routes/db'));
app.use('/api', require('./routes/registry'));
app.use('/api', require('./routes/telemetry'));
app.use('/api', require('./routes/daraja-b2c'));
app.use('/api', require('./routes/payout-readiness'));
app.use('/api/sacco', require('./routes/sacco-payouts'));
app.use('/test', require('./routes/wallet'));
app.use('/', require('./routes/wallet-withdraw'));
app.use('/mpesa', require('./routes/mpesa'));
app.use('/api/mpesa', require('./routes/mpesa'));
app.use('/api/admin', require('./routes/admin-withdrawals'));
app.use('/api/admin', require('./routes/admin-matatu-payout'));
app.use('/api/admin', require('./routes/admin-vehicle-payout'));
app.use('/api/admin', require('./routes/admin-sms'));
app.use('/', require('./routes/sacco'));

// health (works on Vercel via rewrite /healthz -> /api/index.js)
app.get(['/healthz','/api/healthz'], (_req,res)=>res.json({ ok:true, mode:'real' }));

// local only (guard for Vercel)
const PORT = process.env.PORT || 5001;
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log('TekeTeke REAL API listening on ' + PORT));
}

// 404 fallback to avoid hanging in serverless when route not matched
app.use((req, res, _next) => {
  res.status(404).json({ error: 'not_found', path: req.path, url: req.originalUrl });
});

// error handler (last)
app.use((err, req, res, _next) => {
  console.error(err);
  const id = req.headers['x-request-id'] || '';
  res.status(500).json({ error: 'server_error', request_id: id });
});

module.exports = app;
