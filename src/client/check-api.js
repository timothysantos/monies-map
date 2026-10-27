// Every request the "Check my books" page makes (src/server/ledger-checkup-
// route.ts). No AI anywhere: the report is deterministic rules over the
// household's own records, and the only writes are "This is fine" and its undo.

const JSON_HEADERS = { "Content-Type": "application/json" };
const TIERS = ["high", "check", "note"];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readCounts(value) {
  return Object.fromEntries(TIERS.map((tier) => [tier, Number.isFinite(value?.[tier]) ? Math.max(0, Math.trunc(value[tier])) : 0]));
}

function readEvidence(line) {
  if (!isObject(line) || typeof line.label !== "string") return null;
  return {
    role: typeof line.role === "string" ? line.role : "fact",
    label: line.label,
    date: typeof line.date === "string" ? line.date : undefined,
    amountMinor: Number.isFinite(line.amountMinor) ? line.amountMinor : undefined,
    currency: typeof line.currency === "string" ? line.currency : undefined,
    accountName: typeof line.accountName === "string" ? line.accountName : undefined,
    note: typeof line.note === "string" ? line.note : undefined
  };
}

function readFinding(item) {
  if (!isObject(item) || [item.id, item.kind, item.title, item.summary, item.evidenceKey].some((value) => typeof value !== "string") || !TIERS.includes(item.tier)) {
    return null;
  }
  const fix = isObject(item.fix) && typeof item.fix.label === "string" && typeof item.fix.path === "string" && item.fix.path.startsWith("/")
    ? { label: item.fix.label, path: item.fix.path }
    : null;
  return {
    id: item.id,
    kind: item.kind,
    tier: item.tier,
    title: item.title,
    summary: item.summary,
    evidence: Array.isArray(item.evidence) ? item.evidence.map(readEvidence).filter((line) => line !== null) : [],
    amountMinor: Number.isFinite(item.amountMinor) ? item.amountMinor : null,
    currency: typeof item.currency === "string" ? item.currency : "SGD",
    occurredOn: typeof item.occurredOn === "string" ? item.occurredOn : null,
    personIds: Array.isArray(item.personIds) ? item.personIds.filter((id) => typeof id === "string") : [],
    fix,
    fixNote: typeof item.fixNote === "string" ? item.fixNote : null,
    evidenceKey: item.evidenceKey,
    dismissed: item.dismissed === true
  };
}

/**
 * The report as the page reads it, or null when the answer is not one.
 * @returns {{ generatedAt: string, tierCounts: Record<string, number>, kindCounts: Record<string, Record<string, number>>, dismissedCount: number, findings: any[], moreByKind: Record<string, number>, incompleteKinds: string[], unavailableKinds: string[] } | null}
 */
export function readCheckupReport(body) {
  if (!isObject(body) || body.ok !== true || !Array.isArray(body.findings) || !isObject(body.tierCounts)) {
    return null;
  }
  /** @type {Record<string, Record<string, number>>} */
  const kindCounts = {};
  for (const [kind, counts] of Object.entries(isObject(body.kindCounts) ? body.kindCounts : {})) {
    kindCounts[kind] = readCounts(counts);
  }
  const names = (list) => (Array.isArray(list) ? list.filter((name) => typeof name === "string") : []);
  return {
    generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : "",
    tierCounts: readCounts(body.tierCounts),
    kindCounts,
    dismissedCount: Number.isFinite(body.dismissedCount) ? Math.max(0, Math.trunc(body.dismissedCount)) : 0,
    findings: body.findings.map(readFinding).filter((finding) => finding !== null),
    moreByKind: isObject(body.moreByKind) ? body.moreByKind : {},
    incompleteKinds: names(body.incompleteKinds),
    unavailableKinds: names(body.unavailableKinds)
  };
}

export function buildCheckupPath({ viewId, includeHidden }) {
  const params = new URLSearchParams();
  if (viewId && viewId !== "household") params.set("view", viewId);
  if (includeHidden) params.set("dismissed", "1");
  const query = params.toString();
  return `/api/ledger-checkup${query ? `?${query}` : ""}`;
}

// Throws on any failure, so a failed check is never kept as a result.
export async function requestCheckup({ viewId, includeHidden = false, signal = undefined, fetchImpl = fetch }) {
  const response = await fetchImpl(buildCheckupPath({ viewId, includeHidden }), { cache: "no-store", signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`The check request failed (${response.status}).`);
  }
  const report = readCheckupReport(await response.json().catch(() => null));
  if (!report) {
    throw new Error("The check answered with something this page cannot read.");
  }
  return report;
}

async function postJson(path, body, fetchImpl) {
  try {
    const response = await fetchImpl(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

// "This is fine": the one write the page makes, with the report's own key so a
// change in the records brings the item back.
export function postHide({ id, evidenceKey }, fetchImpl = fetch) {
  return postJson("/api/ledger-checkup/dismiss", { id, evidenceKey }, fetchImpl);
}

export function postShowAgain({ id }, fetchImpl = fetch) {
  return postJson("/api/ledger-checkup/undo-dismiss", { id }, fetchImpl);
}
