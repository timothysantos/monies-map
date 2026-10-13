import { Landmark } from "lucide-react";
import { useState } from "react";

import { messages } from "./copy/en-SG";
import { settingsMessages } from "./copy/en-SG-settings";
import { PickerRow } from "./detail-field-rows";
import { selectAllOnFocus } from "./focus-utils";
import { SheetDialog } from "./sheet-dialog";
import { ACCOUNT_KIND_OPTIONS } from "./ui-options";
import { DetailRow, DetailRows, LeadCard, MetaChip } from "./ui/lead-support-detail";
import { useDraftChanged } from "./use-draft-changed";
import { useIsMobileLayout } from "./use-viewport";

const SHARED = "__joint__";

// Account editing is shared between settings and imports, so keep the dialog
// presentational and workflow-agnostic here. The lead is the account (its
// name typed in place) with its type, currency and owner as chips; the other
// fields are Detail rows, and Cancel and Save sit in the bottom bar.
export function AccountDialog({ dialog, error, people, isSubmitting, onChange, onClose, onSave }) {
  const isSheet = useIsMobileLayout();
  const isDirty = useDraftChanged(dialog);
  const [openRow, setOpenRow] = useState(null);
  if (!dialog) {
    return null;
  }
  const isCreate = dialog.mode === "create";
  const canSave = Boolean(dialog.name?.trim() && dialog.institution?.trim());
  const set = (patch) => onChange((current) => current ? { ...current, ...patch } : current);
  const kindOption = ACCOUNT_KIND_OPTIONS.find((option) => option.value === (dialog.kind ?? "bank"));
  const ownerValue = dialog.isJoint ? SHARED : (dialog.ownerPersonId ?? "");
  const ownerOptions = [{ value: SHARED, label: "Shared" }, ...people.map((person) => ({ value: person.id, label: person.name }))];
  const ownerLabel = ownerOptions.find((option) => option.value === ownerValue)?.label ?? "Shared";
  const rowOpenProps = (key) => ({ open: openRow === key, onOpenChange: (open) => setOpenRow(open ? key : null) });

  return (
    <SheetDialog
      className="settings-account-dialog"
      title={isCreate ? settingsMessages.createAccount : settingsMessages.editAccount}
      description={isCreate ? settingsMessages.createAccountDetail : settingsMessages.editAccountDetail}
      descriptionHidden
      closeLabel="Close account dialog"
      lead={(
        <LeadCard
          className="sheet-dialog-lead"
          category={{ icon: Landmark }}
          title={(
            <input
              className="lsd-title lsd-title-input"
              aria-label={settingsMessages.accountName}
              placeholder={settingsMessages.accountName}
              value={dialog.name ?? ""}
              enterKeyHint="next"
              onChange={(event) => set({ name: event.target.value })}
            />
          )}
          subtitle={dialog.institution?.trim() || null}
          chips={(
            <>
              {kindOption ? <MetaChip>{kindOption.label}</MetaChip> : null}
              {dialog.currency ? <MetaChip>{dialog.currency}</MetaChip> : null}
              <MetaChip person={ownerValue === SHARED ? undefined : ownerLabel}>{ownerLabel}</MetaChip>
            </>
          )}
        />
      )}
      errorMessage={error}
      primaryLabel={isSubmitting ? messages.common.saving : isCreate ? settingsMessages.createAccount : settingsMessages.saveAccount}
      primaryDisabled={!canSave || isSubmitting}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={onSave}
      onClose={onClose}
    >
      <DetailRows label={settingsMessages.editAccount}>
        <DetailRow label={settingsMessages.accountInstitution}>
          <input
            value={dialog.institution ?? ""}
            enterKeyHint="next"
            onChange={(event) => set({ institution: event.target.value })}
          />
        </DetailRow>
        <PickerRow
          isSheet={isSheet}
          rowKey="kind"
          label={settingsMessages.accountType}
          valueLabel={kindOption?.label ?? ""}
          value={dialog.kind ?? "bank"}
          options={ACCOUNT_KIND_OPTIONS}
          onValueChange={(kind) => set({ kind })}
          {...rowOpenProps("kind")}
        />
        <DetailRow label={settingsMessages.accountCurrency}>
          <input
            value={dialog.currency ?? "SGD"}
            enterKeyHint="next"
            autoCapitalize="characters"
            onChange={(event) => set({ currency: event.target.value.toUpperCase() })}
          />
        </DetailRow>
        <DetailRow label={settingsMessages.accountOpeningBalance}>
          <input
            inputMode="decimal"
            value={dialog.openingBalance ?? "0.00"}
            enterKeyHint="next"
            onMouseDown={selectAllOnFocus}
            onFocus={selectAllOnFocus}
            onChange={(event) => set({ openingBalance: event.target.value })}
          />
        </DetailRow>
        <PickerRow
          isSheet={isSheet}
          rowKey="owner"
          label={settingsMessages.accountOwner}
          valueLabel={ownerLabel}
          value={ownerValue}
          options={ownerOptions}
          onValueChange={(value) => set(value === SHARED ? { isJoint: true, ownerPersonId: "" } : { isJoint: false, ownerPersonId: value })}
          {...rowOpenProps("owner")}
        />
      </DetailRows>
      <p className="lsd-note">{settingsMessages.accountOpeningBalanceHelp}</p>
    </SheetDialog>
  );
}
