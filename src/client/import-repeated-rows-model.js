// Rows of the file in review that look the same as another row in it: same
// account, day, wording, amount and direction. A bank does list two
// identical payments on one day, so nothing is skipped; the preview only
// points at them so a pasted-twice block is seen before saving.
const SHOWN_GROUPS = 3;

export function findRepeatedPreviewRows(previewRows = []) {
  const groups = new Map();
  for (const row of previewRows) {
    if (row.commitStatus === "skipped") {
      continue;
    }
    const key = [
      row.accountId ?? row.accountName ?? "",
      row.date,
      String(row.description ?? "").trim().toLowerCase(),
      row.amountMinor,
      row.entryType,
      row.transferDirection ?? ""
    ].join("|");
    const group = groups.get(key) ?? { date: row.date, description: row.description, amountMinor: row.amountMinor, rowIds: [] };
    group.rowIds.push(row.rowId);
    groups.set(key, group);
  }

  const repeated = [...groups.values()]
    .filter((group) => group.rowIds.length > 1)
    .sort((left, right) => right.rowIds.length - left.rowIds.length || String(left.date).localeCompare(String(right.date)));
  return {
    // Rows beyond the first of each group: how many could be copies.
    extraRowCount: repeated.reduce((total, group) => total + group.rowIds.length - 1, 0),
    groups: repeated.slice(0, SHOWN_GROUPS),
    moreGroupCount: Math.max(0, repeated.length - SHOWN_GROUPS)
  };
}
