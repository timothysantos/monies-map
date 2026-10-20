import { useMemo } from "react";

import { CategoryPickerHost } from "./category-picker-host";
import { messages } from "./copy/en-SG";
import { CategoryGlyph } from "./ui-components";
import { isTransferPurposeCategoryName } from "../domain/transfer-purpose";

// The category list behind an Entries row's category label (design.md
// "Category list"): the shared list, with the row's own text as the context
// for its best guess. Mounted only after the label is first used, so a closed
// row carries none of it. A transfer has no category to change and never
// opens one. `onChange(entry, categoryName)` saves and answers { ok, error }.
// A person view's row for a transfer with a purpose shows the purpose; its
// list is "What is this for?", so only categories a transfer can pay for.
export function EntryCategoryQuickPick({ entry, categories, open, onOpenChange, anchorRef, onChange }) {
  const isPurpose = Boolean(entry.transferPurpose?.role);
  const options = useMemo(
    () => categories
      .filter((category) => (isPurpose ? isTransferPurposeCategoryName(category.name) : category.name !== "Transfer"))
      .map((category) => ({
        value: category.name,
        label: category.name,
        iconKey: category.iconKey,
        colorHex: category.colorHex,
        icon: <CategoryGlyph iconKey={category.iconKey} />
      })),
    [categories, isPurpose]
  );
  return (
    <CategoryPickerHost
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      returnFocusRef={anchorRef}
      title={isPurpose ? messages.entries.transferPurpose.label : messages.entries.editCategory}
      options={options}
      value={entry.categoryName}
      description={entry.description}
      onChoose={(categoryName) => onChange(entry, categoryName)}
    />
  );
}
