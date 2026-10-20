import { useState } from "react";

import { messages } from "./copy/en-SG";
import { PickerRow } from "./detail-field-rows";
import { CategoryGlyph } from "./ui-components";
import { isTransferPurposeCategoryName } from "../domain/transfer-purpose";

const copy = messages.entries.transferPurpose;

// Whether the editor offers "What is this for?" (DOMAIN.md "Transfer
// Purpose"): a transfer out matched to an account of someone else in the
// household, or one that already has a purpose. The Worker checks it again
// and says why when it cannot (the account was joint, a settle-up, ...).
export function offersTransferPurpose(entry) {
  if (entry.entryType !== "transfer" || entry.transferDirection !== "out") {
    return false;
  }
  if (entry.transferPurpose) {
    return true;
  }
  const otherOwner = entry.linkedTransfer?.accountOwnerLabel;
  return Boolean(otherOwner && otherOwner !== "Shared" && entry.ownerName && otherOwner !== entry.ownerName);
}

// The "What is this for?" row of a transfer's edit card: the shared category
// list (spending categories and Loans only), saved as soon as one is chosen,
// like the row's own category list. "Just a transfer" clears it; a purpose
// set like last month says so, with Undo.
export function EntryTransferPurposeRow({ entry, categories, isSheet, onChange }) {
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const purpose = entry.transferPurpose;
  const options = categories
    .filter((category) => isTransferPurposeCategoryName(category.name))
    .map((category) => ({
      value: category.name,
      label: category.name,
      iconKey: category.iconKey,
      colorHex: category.colorHex,
      icon: <CategoryGlyph iconKey={category.iconKey} />
    }));

  async function save(categoryName) {
    if (isSaving || (categoryName ?? null) === (purpose?.categoryName ?? null)) {
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const result = await onChange(entry, categoryName);
      if (!result?.ok) {
        setError(result?.error ?? copy.failed);
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <span className="lsd-row-group entry-transfer-purpose" data-row="transferPurpose">
      <PickerRow
        rowKey="transferPurpose"
        isSheet={isSheet}
        label={copy.label}
        valueLabel={isSaving ? copy.saving : purpose?.categoryName ?? messages.entries.editCard.notSet}
        value={purpose?.categoryName ?? ""}
        options={options}
        categoryPick={{ description: entry.description }}
        open={open}
        onOpenChange={setOpen}
        disabled={isSaving}
        onValueChange={(categoryName) => void save(categoryName)}
      />
      {purpose ? (
        <span className="entry-transfer-purpose-actions">
          {purpose.remembered ? <span className="entry-transfer-purpose-cue">{copy.rememberedCue}</span> : null}
          <button type="button" className="lsd-quiet" disabled={isSaving} onClick={() => void save(null)}>
            {purpose.remembered ? copy.undo : copy.clear}
          </button>
        </span>
      ) : null}
      {error ? <span className="form-error" role="alert">{error}</span> : null}
    </span>
  );
}
