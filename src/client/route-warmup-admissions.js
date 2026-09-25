// Which speculative data requests are cheap enough for mobile, from measured
// stress-fixture numbers (H01b, audit "Admission measurements"). A query
// family or parameter range that is not in this table is unknown, and
// unknown is never admitted. Desktop does not consult admission.
//
// responseBytes is the gzip size of the JSON body: what a phone downloads
// from Cloudflare, which compresses JSON, and the same measure the module
// cap uses. handlerMs is the Server-Timing app p95. Synthetic rows compress
// better than real ledgers, so this is an estimate, not a guarantee.
//
// Row shape: { family, fixture, revision, maxRangeMonths, responseBytes, handlerMs }
// maxRangeMonths applies to summary-page only (longest measured range).
export const WARMUP_ADMISSIONS = Object.freeze([
  // Mobile's only data candidate. Largest of the household and Tim views for
  // the 2,000-row month at 10k rows, measured after compact JSON (0.98 MB
  // uncompressed).
  Object.freeze({ family: "entries-page", fixture: "scale-10k", revision: "compact-json", responseBytes: 37_975, handlerMs: 25 })
]);

function rangeMonths(identity) {
  if (!identity?.summaryStart || !identity?.summaryEnd) {
    return null;
  }
  const [startYear, startMonth] = identity.summaryStart.split("-").map(Number);
  const [endYear, endMonth] = identity.summaryEnd.split("-").map(Number);
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
}

export function admissionFor(family, identity, table = WARMUP_ADMISSIONS) {
  const row = table.find((candidate) => candidate.family === family);
  if (!row) {
    return null;
  }
  if (family === "summary-page") {
    const months = rangeMonths(identity);
    if (months === null || !Number.isFinite(row.maxRangeMonths) || months > row.maxRangeMonths) {
      return null;
    }
  }
  return { responseBytes: row.responseBytes, handlerMs: row.handlerMs };
}
