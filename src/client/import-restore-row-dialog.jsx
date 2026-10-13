import { RotateCcw } from "lucide-react";

import { importMessages } from "./copy/en-SG-imports";
import { moniesClient } from "./monies-client-service";
import { ConfirmLead, SheetDialog } from "./sheet-dialog";
import { entryAmountTone } from "../domain/money-tone";

const { format: formatService } = moniesClient;

// "Restore preview row" asks first when the skipped row exactly matches an
// entry that is already recorded, because restoring it would add it a second
// time. The lead is the row; Restore row is the one primary action.
export function RestorePreviewRowDialog({ row, onClose, onRestore }) {
  if (!row) {
    return null;
  }
  const signedMinor = row.entryType === "expense" || row.transferDirection === "out" ? -row.amountMinor : row.amountMinor;
  return (
    <SheetDialog
      className="settings-account-dialog"
      title={importMessages.restorePreviewRow}
      description={importMessages.restoreExactCoveredRowConfirm}
      descriptionHidden
      closeLabel="Close confirmation dialog"
      lead={(
        <ConfirmLead
          neutral
          icon={RotateCcw}
          title={row.description}
          subtitle={formatService.formatDateOnly(row.date)}
          amount={formatService.money(signedMinor)}
          tone={entryAmountTone(row.entryType, signedMinor)}
        >
          <p className="lsd-note">{importMessages.restoreExactCoveredRowConfirm}</p>
        </ConfirmLead>
      )}
      primaryLabel="Restore row"
      onSubmit={() => {
        onRestore(row);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
