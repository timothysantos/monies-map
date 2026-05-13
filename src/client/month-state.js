// Month state helpers stay dependency-free so month panel orchestration can be
// tested without browser or React runtime coupling.

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
    note: (row.sourceNote ?? row.note ?? "").trim()
  };
}
