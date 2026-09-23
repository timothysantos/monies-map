import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const ROUTE_ENTRIES = {
  summary: "summary-panel.jsx",
  month: "month-panel.jsx",
  entries: "entries-panel.jsx",
  splits: "splits-panel.jsx",
  imports: "imports-panel.jsx",
  settings: "settings-panel.jsx",
  faq: "faq-panel.jsx"
};
const REQUIRED_ROUTES = Object.keys(ROUTE_ENTRIES);

// The build-only JSON block in dist/index.html. Group 1 is the JSON body.
export const WARMUP_COSTS_BLOCK_PATTERN = /<script\b(?=[^>]*\bid=["']monies-warmup-costs["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/gi;

export function getHtmlStylesheetAssets(html) {
  return [...html.matchAll(/<link\b([^>]+)>/gi)].flatMap(([, attributes]) => {
    const rel = attributes.match(/\brel=["']([^"']+)["']/i)?.[1]?.toLowerCase().split(/\s+/) ?? [];
    const href = attributes.match(/\bhref=["']([^"']+)["']/i)?.[1];
    return rel.includes("stylesheet") && href?.startsWith("/") ? [href.slice(1)] : [];
  });
}

export function createRouteAssetReport(manifest, readAsset, { htmlAssets = [] } = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("Vite manifest must be an object.");
  }
  const entries = Object.entries(manifest);
  const appEntry = entries.find(([key]) => key.endsWith("src/client/main.jsx"))
    ?? entries.find(([, item]) => item.isEntry);
  if (!appEntry) throw new Error("Could not find the client entry in the Vite manifest.");

  const [entryKey] = appEntry;
  const closure = (root) => {
    const visited = new Set();
    const visit = (key) => {
      if (visited.has(key)) return;
      visited.add(key);
      // A dangling import stays in the closure so its cost reads as unknown.
      for (const imported of manifest[key]?.imports ?? []) visit(imported);
    };
    visit(root);
    return visited;
  };
  const details = new Map();
  const detailFor = (key) => {
    if (details.has(key)) return details.get(key);
    const item = manifest[key];
    if (!item) {
      const missing = { assets: [{ file: `missing-manifest-entry:${key}`, rawBytes: null, estimatedGzipBytes: null, kind: "js" }], associatedAssets: [] };
      details.set(key, missing);
      return missing;
    }
    const files = [...new Set([item.file, ...(item.css ?? [])].filter(Boolean))];
    const associatedFiles = [...new Set((item.assets ?? []).filter(Boolean))];
    const load = (file) => {
      const bytes = readAsset(file);
      if (!bytes) {
        return { file, rawBytes: null, estimatedGzipBytes: null, kind: file.endsWith(".css") ? "css" : file.endsWith(".js") || file.endsWith(".mjs") ? "js" : "asset" };
      }
      return {
        file,
        rawBytes: bytes.byteLength,
        estimatedGzipBytes: gzipSync(bytes).byteLength,
        kind: file.endsWith(".css") ? "css" : file.endsWith(".js") || file.endsWith(".mjs") ? "js" : "asset"
      };
    };
    const detail = { assets: files.map(load), associatedAssets: associatedFiles.map(load) };
    details.set(key, detail);
    return detail;
  };
  const recordsFor = (keys) => [...keys].flatMap((key) => detailFor(key).assets);
  const associatedAssetsFor = (keys) => [...keys].flatMap((key) => detailFor(key).associatedAssets);
  const htmlAssetRecords = htmlAssets.map((file) => {
    const bytes = readAsset(file);
    return bytes
      ? { file, rawBytes: bytes.byteLength, estimatedGzipBytes: gzipSync(bytes).byteLength, kind: file.endsWith(".css") ? "css" : "asset" }
      : { file, rawBytes: null, estimatedGzipBytes: null, kind: file.endsWith(".css") ? "css" : "asset" };
  });
  const dynamicRecordsFor = (keys, excludedKeys = new Set()) => {
    const visited = new Set();
    const dynamicKeys = new Set();
    const roots = [...keys].flatMap((key) => manifest[key]?.dynamicImports ?? []);
    while (roots.length) {
      const root = roots.pop();
      if (visited.has(root)) continue;
      visited.add(root);
      const dynamicClosure = closure(root);
      for (const key of dynamicClosure) {
        if (excludedKeys.has(key)) continue;
        dynamicKeys.add(key);
        roots.push(...(manifest[key]?.dynamicImports ?? []));
      }
    }
    return summarizeFiles([
      ...recordsFor(dynamicKeys),
      ...associatedAssetsFor(keys),
      ...associatedAssetsFor(dynamicKeys)
    ]).files;
  };
  const summarizeFiles = (records) => {
    const byFile = new Map(records.map((record) => [record.file, record]));
    const unique = [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
    const sum = (kind) => unique.filter((item) => item.kind === kind).some((item) => item.estimatedGzipBytes == null)
      ? null
      : unique.filter((item) => item.kind === kind).reduce((total, item) => total + item.estimatedGzipBytes, 0);
    const total = sum("js") == null || sum("css") == null || sum("asset") == null
      ? null
      : sum("js") + sum("css") + sum("asset");
    return {
      files: unique,
      estimatedGzipBytes: total,
      jsEstimatedGzipBytes: sum("js"),
      cssEstimatedGzipBytes: sum("css"),
      otherEstimatedGzipBytes: sum("asset")
    };
  };

  const initialKeys = closure(entryKey);
  const initial = summarizeFiles([...recordsFor(initialKeys), ...htmlAssetRecords]);
  const initialAssociatedAssets = summarizeFiles(associatedAssetsFor(initialKeys));
  const routeRoots = Object.fromEntries(Object.entries(ROUTE_ENTRIES).map(([route, suffix]) => {
    const match = entries.find(([key]) => key.endsWith(suffix));
    return [route, match?.[0] ?? null];
  }));
  const routes = {};
  for (const [route, root] of Object.entries(routeRoots)) {
    if (!root) {
      routes[route] = { entry: null, files: [], estimatedGzipBytes: null, missingReason: "route entry missing from manifest" };
      continue;
    }
    const allKeys = closure(root);
    const incrementalKeys = new Set([...allKeys].filter((key) => !initialKeys.has(key)));
    const fullKeys = new Set([...initialKeys, ...allKeys]);
    const summary = summarizeFiles([...recordsFor(fullKeys), ...htmlAssetRecords]);
    const incremental = summarizeFiles(recordsFor(incrementalKeys));
    routes[route] = {
      entry: root,
      files: summary.files,
      estimatedGzipBytes: summary.estimatedGzipBytes,
      jsEstimatedGzipBytes: summary.jsEstimatedGzipBytes,
      cssEstimatedGzipBytes: summary.cssEstimatedGzipBytes,
      incrementalFiles: incremental.files,
      incrementalEstimatedGzipBytes: incremental.estimatedGzipBytes,
      dynamicAssets: dynamicRecordsFor(incrementalKeys, fullKeys),
      associatedAssets: summarizeFiles(associatedAssetsFor(fullKeys)).files,
      costKnown: summary.estimatedGzipBytes != null,
      incrementalCostKnown: incremental.estimatedGzipBytes != null
    };
  }

  const allRoutes = summarizeFiles(Object.values(routes).flatMap((route) => route.files));
  return {
    schemaVersion: 1,
    transferLabel: "gzip sizes are estimates from local assets; browser transfer must be measured separately",
    entry: { key: entryKey, ...initial, dynamicAssets: dynamicRecordsFor(initialKeys, initialKeys), associatedAssets: initialAssociatedAssets.files },
    routes,
    sharedAcrossRoutes: allRoutes.files.filter((file) => Object.values(routes).filter((route) => route.files.some((candidate) => candidate.file === file.file)).length > 1),
    routeFilesCountedOnce: allRoutes.files,
    html: { warmupMetadataBytes: null, gzipDeltaBytes: null }
  };
}

export function buildWarmupCosts(manifest, readAsset, { revision = "unknown", htmlAssets = [] } = {}) {
  const report = createRouteAssetReport(manifest, readAsset, { htmlAssets });
  const routes = {};
  for (const [name, route] of Object.entries(report.routes)) {
    if (route.estimatedGzipBytes == null) continue;
    routes[name] = {
      entry: route.entry,
      estimatedGzipBytes: route.incrementalEstimatedGzipBytes,
      chunks: route.incrementalFiles.filter((asset) => asset.kind === "js" || asset.kind === "css").map(({ file, estimatedGzipBytes }) => ({ file, estimatedGzipBytes }))
    };
  }
  const buildId = createHash("sha256").update(JSON.stringify(manifest)).digest("hex").slice(0, 16);
  return { schemaVersion: 1, buildId, revision, routes };
}

export function parseWarmupCosts(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || parsed.schemaVersion !== 1 || typeof parsed.buildId !== "string" || !parsed.routes || typeof parsed.routes !== "object") return null;
    if (REQUIRED_ROUTES.some((routeName) => !Object.hasOwn(parsed.routes, routeName))) return null;
    for (const route of Object.values(parsed.routes)) {
      if (!route || !Array.isArray(route.chunks) || !route.chunks.length || !Number.isFinite(route.estimatedGzipBytes) || route.estimatedGzipBytes <= 0 || route.chunks.some((chunk) => typeof chunk.file !== "string" || !Number.isFinite(chunk.estimatedGzipBytes) || chunk.estimatedGzipBytes <= 0)) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
