// "Fix it for me": whether this viewer lets the statement check apply the
// fixes a statement proves (high confidence: one clear match and the fixes
// close every card they touch) as the preview loads. A per-viewer
// convenience, so browser storage; the default is to ask first. Applied
// fixes are still only written by the commit, and each can be undone.
const STORAGE_KEY = "monies-map:statement-fixes-automatic";

export function readAutomaticStatementFixes() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeAutomaticStatementFixes(isAutomatic) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(isAutomatic));
  } catch {
    // Storage blocked (private window): the choice lasts for this page only.
  }
}

export function getProvenStatementFixes(diagnosis, excludedKeys = new Set()) {
  return (diagnosis?.findings ?? [])
    .filter((finding) => finding.fix && !finding.applied && finding.confidence === "high")
    .map((finding) => finding.fix)
    .filter((fix) => !excludedKeys.has(getStatementFixKey(fix)));
}

// Same identity as the server's getFixKey (src/domain/statement-mismatch-
// diagnosis.ts): one fix per entry and destination.
export function getStatementFixKey(fix) {
  return fix.kind === "move_to_statement_account"
    ? `${fix.kind}:${fix.entryId}:${fix.toAccountId}`
    : `${fix.kind}:${fix.entryId}:${fix.postDate}`;
}
