// Category share (donut) chart projection (H15e), shared by the Summary,
// Month and Splits projections.

import { spendingMinor } from "./category-offset";
import type { CategoryDto, DonutChartDatumDto, EntryDto } from "../types/dto";

export function buildDonutChart(entries: EntryDto[], categories: CategoryDto[]): DonutChartDatumDto[] {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const entry of entries) {
    // Expenses add and paybacks take away; other money in is not spending.
    const amountMinor = spendingMinor(entry);
    if (!amountMinor) {
      continue;
    }

    totals.set(entry.categoryName, (totals.get(entry.categoryName) ?? 0) + amountMinor);
    counts.set(entry.categoryName, (counts.get(entry.categoryName) ?? 0) + 1);
  }

  // A category whose paybacks exceed its spending this period shows nothing
  // rather than a negative slice.
  return [...totals.entries()]
    .filter(([, valueMinor]) => valueMinor > 0)
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
