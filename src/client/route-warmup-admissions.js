// Which speculative data requests are cheap enough for mobile, from measured
// stress-fixture numbers (H01b). A query family or parameter range that is
// not in this table is unknown, and unknown is never admitted: the table is
// empty until H01b measures the families, so mobile warmup stays code-only.
// Desktop does not consult admission.
//
// Row shape: { family, fixture, revision, maxRangeMonths, responseBytes, handlerMs }
// maxRangeMonths applies to summary-page only (longest measured range).
export const WARMUP_ADMISSIONS = Object.freeze([]);

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
