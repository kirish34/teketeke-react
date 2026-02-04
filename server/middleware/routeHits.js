const { recordHit } = require('../services/routeHits.service');

function joinPaths(baseUrl, routePath) {
  const base = typeof baseUrl === 'string' ? baseUrl : '';
  const path = typeof routePath === 'string' ? routePath : '';
  const baseClean = base === '/' ? '' : base.replace(/\/$/, '');
  if (!path || path === '/') return baseClean || '/';
  const pathClean = path.startsWith('/') ? path : `/${path}`;
  const joined = `${baseClean}${pathClean}`;
  return joined || '/';
}

function resolveRouteKey(req) {
  if (!req.route || !req.route.path) return null;
  const method = (req.method || '').toUpperCase();
  if (!method) return null;
  const routePaths = Array.isArray(req.route.path) ? req.route.path : [req.route.path];
  const matchedPath =
    routePaths.find((candidate) => typeof candidate === 'string' && candidate === req.path) ||
    routePaths.find((candidate) => typeof candidate === 'string') ||
    null;
  if (!matchedPath) return null;
  const routeKey = joinPaths(req.baseUrl || '', matchedPath);
  return routeKey ? { method, routeKey } : null;
}

function routeHitsMiddleware(req, res, next) {
  res.on('finish', () => {
    if (req.routeHitSkip) return;
    const hit = resolveRouteKey(req);
    if (!hit) return;
    recordHit(hit);
  });
  next();
}

module.exports = { routeHitsMiddleware };
