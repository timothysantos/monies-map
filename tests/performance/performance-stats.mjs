// Pure summary helpers for the built-client performance harness. Kept free of
// Playwright so they can be unit tested under `npm run test:unit`.

// Nearest-rank percentile. Returns null for an empty sample instead of zero so
// a missing measurement can never read as "instant".
export function percentile(values, fraction) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1];
}

export function summarizeSamples(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  return {
    sampleCount: finite.length,
    medianMs: percentile(finite, 0.5),
    p95Ms: percentile(finite, 0.95),
    minMs: finite.length ? Math.min(...finite) : null,
    maxMs: finite.length ? Math.max(...finite) : null
  };
}

export function classifyResource(pathname) {
  if (pathname.startsWith("/api/")) return "api";
  if (/\.(?:m?js)$/.test(pathname)) return "js";
  if (pathname.endsWith(".css")) return "css";
  if (pathname === "/" || pathname.endsWith(".html") || !pathname.includes(".")) return "document";
  return "other";
}

// Totals by resource type. A request whose size is unavailable makes that
// type's byte total null (unknown), while its count is still reported.
export function totalsByType(requests) {
  const totals = {};
  for (const request of requests) {
    const type = classifyResource(request.path);
    const entry = totals[type] ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes = entry.bytes == null || !Number.isFinite(request.bytes) ? null : entry.bytes + request.bytes;
    totals[type] = entry;
  }
  return totals;
}

export function parseServerTiming(header) {
  if (!header) return null;
  const metrics = {};
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().split(";");
    const duration = params.map((param) => param.trim()).find((param) => param.startsWith("dur="));
    if (name) metrics[name] = duration ? Number(duration.slice(4)) : null;
  }
  return metrics;
}
