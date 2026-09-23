// Route code costs embedded at build time in dist/index.html (see
// scripts/write-warmup-costs.mjs). Browser-safe and pure apart from reading
// that one inline block; there is never a network request for it. Unknown
// cost is null, never zero, so a missing block disables automatic warmup
// instead of making every route look free.

export const WARMUP_COST_ROUTE_IDS = Object.freeze(["summary", "month", "entries", "splits", "imports", "settings", "faq"]);
const WARMUP_COSTS_ELEMENT_ID = "monies-warmup-costs";

// Shared with the build scripts; any missing or invalid route makes the
// whole block unknown.
export function parseWarmupCosts(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || parsed.schemaVersion !== 1 || typeof parsed.buildId !== "string" || !parsed.routes || typeof parsed.routes !== "object") return null;
    if (WARMUP_COST_ROUTE_IDS.some((routeName) => !Object.hasOwn(parsed.routes, routeName))) return null;
    for (const route of Object.values(parsed.routes)) {
      if (!route || !Array.isArray(route.chunks) || !route.chunks.length || !Number.isFinite(route.estimatedGzipBytes) || route.estimatedGzipBytes <= 0 || route.chunks.some((chunk) => typeof chunk.file !== "string" || !Number.isFinite(chunk.estimatedGzipBytes) || chunk.estimatedGzipBytes <= 0)) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const cachedByDocument = new WeakMap();

// Read once per document; development builds have no block and read as null.
export function readWarmupCosts(doc = globalThis.document) {
  if (!doc) {
    return null;
  }
  if (cachedByDocument.has(doc)) {
    return cachedByDocument.get(doc);
  }
  let costs = null;
  try {
    costs = parseWarmupCosts(doc.getElementById(WARMUP_COSTS_ELEMENT_ID)?.textContent ?? null);
  } catch {
    costs = null;
  }
  cachedByDocument.set(doc, costs);
  return costs;
}

// Estimated gzip bytes still missing to load routeId. Chunk lists are
// incremental over the entry bundle, so only chunks of routes known to be
// loaded are subtracted; a route's dynamic children (charts, PDF) are never
// assumed loaded. Uncertainty overcounts rather than undercounts.
export function missingRouteBytes(costs, routeId, loadedRouteIds = []) {
  const route = costs?.routes?.[routeId];
  if (!route) {
    return null;
  }
  const loadedFiles = new Set();
  for (const loadedRouteId of loadedRouteIds) {
    for (const chunk of costs.routes[loadedRouteId]?.chunks ?? []) {
      loadedFiles.add(chunk.file);
    }
  }
  const counted = new Set();
  let total = 0;
  for (const chunk of route.chunks) {
    if (!loadedFiles.has(chunk.file) && !counted.has(chunk.file)) {
      counted.add(chunk.file);
      total += chunk.estimatedGzipBytes;
    }
  }
  return total;
}
