// Month state helpers stay dependency-free so month panel orchestration can be
// tested without browser or React runtime coupling.

const DERIVED_SHARE_NOTE_PATTERN = /\s*• weighted to .*? share/g;

export function mergeMonthRowsById(currentRows, serverRows) {
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const serverIds = new Set(serverRows.map((row) => row.id));
  const localTransientRows = currentRows.filter((row) => (
    (row.isDraft || row.isPendingDerived) && !serverIds.has(row.id)
  ));

  return [
    ...localTransientRows,
    ...serverRows.map((serverRow) => {
      const currentRow = currentById.get(serverRow.id);
      return currentRow
        ? {
            ...currentRow,
            ...serverRow,
            isDraft: false,
            isPendingDerived: false
          }
        : serverRow;
    })
  ];
}

export function mergeMonthPlanSections(currentSections, serverSections) {
  const currentByKey = new Map(currentSections.map((section) => [section.key, section]));
  return serverSections.map((serverSection) => {
    const currentSection = currentByKey.get(serverSection.key);
    return currentSection
      ? {
          ...serverSection,
          rows: mergeMonthRowsById(currentSection.rows ?? [], serverSection.rows ?? [])
        }
      : serverSection;
  });
}

export function getMonthPlanEditSource(row) {
  return {
    ...row,
    plannedMinor: row.sourcePlannedMinor ?? row.plannedMinor,
    note: (row.sourceNote ?? row.note ?? "")
      .replace(DERIVED_SHARE_NOTE_PATTERN, "")
      .replace(/\s{2,}/g, " ")
      .trim()
  };
}

// A saved plan row stays on screen until the background reload replaces it,
// and the row editor opens on its source fields. Write the saved values to
// both the shown and the source fields, so a row reopened before the reload
// lands shows what was just saved rather than what it held before.
export function buildSavedMonthPlanFields(saved) {
  const fields = {};
  if (Object.prototype.hasOwnProperty.call(saved, "plannedMinor")) {
    fields.plannedMinor = saved.plannedMinor;
    fields.sourcePlannedMinor = saved.plannedMinor;
  }
  if (Object.prototype.hasOwnProperty.call(saved, "note")) {
    // An empty note stays empty (null) so the table keeps its empty-value mark.
    fields.note = saved.note;
    fields.sourceNote = saved.note;
  }
  return fields;
}
