// Category share (donut) chart projection (H15e), shared by the Summary,
// Month and Splits projections.

import type { CategoryDto, DonutChartDatumDto, EntryDto } from "../types/dto";

export function buildDonutChart(entries: EntryDto[], categories: CategoryDto[]): DonutChartDatumDto[] {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const entry of entries) {
    if (entry.entryType !== "expense") {
      continue;
    }

    totals.set(entry.categoryName, (totals.get(entry.categoryName) ?? 0) + entry.amountMinor);
    counts.set(entry.categoryName, (counts.get(entry.categoryName) ?? 0) + 1);
  }

  return [...totals.entries()]
    .map(([label, valueMinor]) => {
      const category = categories.find((item) => item.name === label);
      return {
      key: label,
      categoryId: category?.id,
      label,
      valueMinor,
      entryCount: counts.get(label) ?? 0
      };
    })
    .sort((left, right) => right.valueMinor - left.valueMinor);
}
