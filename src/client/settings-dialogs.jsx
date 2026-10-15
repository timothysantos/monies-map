import { Tag, UserRound } from "lucide-react";
import { categoryPickOptions } from "./category-pick-options";
import { useState } from "react";

import { CategoryEditDialog } from "./category-edit-dialog";
import { messages } from "./copy/en-SG";
import { settingsMessages } from "./copy/en-SG-settings";
import { PickerRow } from "./detail-field-rows";
import { selectAllOnFocus } from "./focus-utils";
import { SheetDialog } from "./sheet-dialog";
import { DetailRow, DetailRows, LeadCard, MetaChip } from "./ui/lead-support-detail";
import { useDraftChanged } from "./use-draft-changed";
import { useIsMobileLayout } from "./use-viewport";

// Settings dialogs receive draft objects from SettingsPanel; save handlers stay
// in the panel because they own API calls and refresh sequencing. Each is the
// shared sheet frame (sheet-dialog.jsx): a lead for what is being edited, its
// fields as Detail rows, and Cancel and Save in the bottom bar.
export function SettingsPersonDialog({ dialog, isSubmitting, onChange, onClose, onSave }) {
  const isDirty = useDraftChanged(dialog);
  if (!dialog) {
    return null;
  }
  return (
    <SheetDialog
      className="settings-account-dialog"
      title={settingsMessages.editPerson}
      description={settingsMessages.editPersonDetail}
      descriptionHidden
      closeLabel="Close person dialog"
      lead={(
        <LeadCard
          className="sheet-dialog-lead"
          category={{ icon: UserRound }}
          title={(
            <input
              className="lsd-title lsd-title-input"
              aria-label={settingsMessages.personDisplayName}
              placeholder={settingsMessages.personDisplayName}
              value={dialog.name ?? ""}
              enterKeyHint="done"
              onChange={(event) => onChange((current) => current ? { ...current, name: event.target.value } : current)}
            />
          )}
          chips={dialog.name?.trim() ? <MetaChip person={dialog.name.trim()}>{dialog.name.trim()}</MetaChip> : null}
        >
          <p className="lsd-note">{settingsMessages.editPersonDetail}</p>
        </LeadCard>
      )}
      primaryLabel={isSubmitting ? messages.common.saving : settingsMessages.savePerson}
      primaryDisabled={!dialog.name?.trim() || isSubmitting}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={onSave}
      onClose={onClose}
    />
  );
}

export function SettingsCategoryDialog({ dialog, isSubmitting, onChange, onClose, onSave }) {
  return <CategoryEditDialog dialog={dialog} isSubmitting={isSubmitting} onChange={onChange} onClose={onClose} onSave={onSave} />;
}

export function SettingsCategoryMatchRuleDialog({ dialog, categories, isSubmitting, onChange, onClose, onSave }) {
  const isSheet = useIsMobileLayout();
  const isDirty = useDraftChanged(dialog);
  const [openRow, setOpenRow] = useState(null);
  if (!dialog) {
    return null;
  }
  const isCreate = dialog.mode === "create";
  const set = (patch) => onChange((current) => current ? { ...current, ...patch } : current);
  const categoryId = dialog.categoryId ?? categories[0]?.id ?? "";
  const category = categories.find((item) => item.id === categoryId) ?? null;
  const isActive = dialog.isActive !== false;
  const statusOptions = [
    { value: "active", label: settingsMessages.categoryRuleActive },
    { value: "inactive", label: settingsMessages.categoryRuleInactive }
  ];
  const rowOpenProps = (key) => ({ open: openRow === key, onOpenChange: (open) => setOpenRow(open ? key : null) });

  return (
    <SheetDialog
      className="settings-account-dialog"
      title={isCreate ? settingsMessages.createCategoryRule : settingsMessages.editCategoryRule}
      description={settingsMessages.categoryRuleDialogDetail}
      descriptionHidden
      closeLabel="Close category matching rule dialog"
      lead={(
        <LeadCard
          className="sheet-dialog-lead"
          category={{ colorHex: category?.colorHex, iconKey: category?.iconKey, icon: category?.iconKey ? undefined : Tag }}
          title={(
            <input
              className="lsd-title lsd-title-input"
              aria-label={settingsMessages.categoryRulePattern}
              placeholder="SINGLIFE"
              value={dialog.pattern ?? ""}
              enterKeyHint="next"
              onChange={(event) => set({ pattern: event.target.value })}
            />
          )}
          subtitle={category?.name ?? null}
          chips={(
            <>
              <MetaChip tone={isActive ? "mint" : undefined}>{isActive ? settingsMessages.categoryRuleActive : settingsMessages.categoryRuleInactive}</MetaChip>
              <MetaChip>{`${settingsMessages.categoryRulePriority} ${dialog.priority ?? 100}`}</MetaChip>
            </>
          )}
        >
          <p className="lsd-note">{settingsMessages.categoryRuleDialogDetail}</p>
        </LeadCard>
      )}
      primaryLabel={isSubmitting ? messages.common.saving : settingsMessages.saveCategoryRule}
      primaryDisabled={!dialog.pattern?.trim() || !dialog.categoryId || isSubmitting}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={onSave}
      onClose={onClose}
    >
      <DetailRows label={isCreate ? settingsMessages.createCategoryRule : settingsMessages.editCategoryRule}>
        <PickerRow
          isSheet={isSheet}
          rowKey="category"
          label={settingsMessages.categoryRuleCategory}
          valueLabel={category?.name ?? ""}
          value={categoryId}
          options={categoryPickOptions(categories, { valueKey: "id" })}
          categoryPick={{}}
          onValueChange={(value) => set({ categoryId: value })}
          {...rowOpenProps("category")}
        />
        <DetailRow label={settingsMessages.categoryRulePriority}>
          <input
            type="number"
            enterKeyHint="next"
            value={dialog.priority ?? 100}
            onMouseDown={selectAllOnFocus}
            onFocus={selectAllOnFocus}
            onChange={(event) => set({ priority: Number(event.target.value) })}
          />
        </DetailRow>
        <PickerRow
          isSheet={isSheet}
          rowKey="status"
          label={settingsMessages.categoryRuleStatus}
          valueLabel={isActive ? settingsMessages.categoryRuleActive : settingsMessages.categoryRuleInactive}
          value={isActive ? "active" : "inactive"}
          options={statusOptions}
          onValueChange={(value) => set({ isActive: value === "active" })}
          {...rowOpenProps("status")}
        />
        <DetailRow label={settingsMessages.categoryRuleNote}>
          <textarea
            rows={1}
            value={dialog.note ?? ""}
            onChange={(event) => set({ note: event.target.value })}
          />
        </DetailRow>
      </DetailRows>
      <p className="lsd-note">{settingsMessages.categoryRulePriorityHelp}</p>
    </SheetDialog>
  );
}
