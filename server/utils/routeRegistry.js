function joinPaths(base, segment) {
  const left = base || '';
  const right = segment || '';
  const combined = `${left}${right}`;
  if (!combined) return '/';
  return combined.replace(/\/{2,}/g, '/');
}

function extractPathFromLayer(layer) {
  if (layer.path) return layer.path;
  if (!layer.regexp) return '';
  if (layer.regexp.fast_slash) return '';
  let path = layer.regexp.source
    .replace('^\\/', '/')
    .replace('\\/?', '')
    .replace('(?=\\/|$)', '')
    .replace(/\\\//g, '/');
  if (path.endsWith('$')) path = path.slice(0, -1);
  if (layer.keys && layer.keys.length) {
    let keyIndex = 0;
    path = path.replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => `:${layer.keys[keyIndex++]?.name || 'param'}`);
    path = path.replace(/\(\[\^\\\/\]\+\?\)/g, () => `:${layer.keys[keyIndex++]?.name || 'param'}`);
  }
  return path;
}

function listRoutes(stack, basePath = '') {
  const routes = [];
  if (!stack) return routes;
  stack.forEach((layer) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods || {}).map((m) => m.toUpperCase());
      const routePath = joinPaths(basePath, layer.route.path);
      const middleware = (layer.route.stack || []).map((mw) => mw.name || 'anonymous');
      routes.push({ path: routePath, methods, middleware });
      return;
    }

    if (layer.name === 'router' && layer.handle?.stack) {
      const layerPath = extractPathFromLayer(layer);
      const nextBase = joinPaths(basePath, layerPath);
      routes.push(...listRoutes(layer.handle.stack, nextBase));
    }
  });
  return routes;
}

function buildRouteRegistry(app) {
  if (!app || !app._router?.stack) return [];
  return listRoutes(app._router.stack, '');
}

module.exports = { buildRouteRegistry };
