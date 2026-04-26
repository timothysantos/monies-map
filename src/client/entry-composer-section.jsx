import { useEffect, useMemo } from "react";
import { Check, X } from "lucide-react";

import { EntryEditorFields } from "./entry-editor";
import { getVisibleSplitPercent } from "./entry-helpers";
import { ResponsiveSelect } from "./responsive-select";
import { EntryMobileSheet } from "./entry-mobile-sheet";

export function useEntryComposerSplitOptions({
  showEntryComposer,
  entryDraft,
  splitGroups,
  isSavingEntryDraft,
  isQuickExpenseSaving,
  updateEntryDraft
}) {
  const entrySplitGroupOptions = useMemo(
    () => splitGroups.map((group) => ({
      value: group.id,
      label: group.name
    })),
    [splitGroups]
  );
  const splitGroupOptions = useMemo(
    () => [
      { value: "", label: "Choose split group" },
      ...entrySplitGroupOptions
    ],
    [entrySplitGroupOptions]
  );
  const singleSplitGroupValue = entrySplitGroupOptions.length === 1
    ? entrySplitGroupOptions[0].value
    : null;
  const shouldShowComposerSplitOptions = showEntryComposer && entryDraft.entryType === "expense";
  const shouldShowComposerSplitGroupSelect = shouldShowComposerSplitOptions
    && entryDraft.addToSplits
    && !singleSplitGroupValue;
  const isComposerSaveDisabled = isSavingEntryDraft
    || isQuickExpenseSaving
    || (shouldShowComposerSplitGroupSelect && !entryDraft.splitGroupId);
  const composerSplitOptionsProps = useMemo(
    () => ({
      addToSplits: entryDraft.addToSplits,
      splitGroupId: entryDraft.splitGroupId,
      splitGroupOptions: entrySplitGroupOptions,
      showSplitGroupSelect: shouldShowComposerSplitGroupSelect,
      onToggleAddToSplits: (checked) => updateEntryDraft({
        addToSplits: checked,
        splitGroupId: checked && singleSplitGroupValue ? singleSplitGroupValue : ""
      }),
      onSelectSplitGroup: (splitGroupId) => updateEntryDraft({ splitGroupId })
    }),
    [
      entryDraft.addToSplits,
      entryDraft.splitGroupId,
      entrySplitGroupOptions,
      shouldShowComposerSplitGroupSelect,
      singleSplitGroupValue,
      updateEntryDraft
    ]
  );

  useEffect(() => {
    if (!shouldShowComposerSplitOptions || !entryDraft.addToSplits) {
      return;
    }

    if (singleSplitGroupValue && entryDraft.splitGroupId !== singleSplitGroupValue) {
      updateEntryDraft({ splitGroupId: singleSplitGroupValue });
      return;
    }

    if (!singleSplitGroupValue && entryDraft.splitGroupId && !entrySplitGroupOptions.some((option) => option.value === entryDraft.splitGroupId)) {
      updateEntryDraft({ splitGroupId: "" });
    }
  }, [
    entryDraft.addToSplits,
    entryDraft.splitGroupId,
    entrySplitGroupOptions,
    shouldShowComposerSplitOptions,
    singleSplitGroupValue,
    updateEntryDraft
  ]);

  return {
    entrySplitGroupOptions,
    splitGroupOptions,
    singleSplitGroupValue,
    shouldShowComposerSplitOptions,
    isComposerSaveDisabled,
    composerSplitOptionsProps
  };
}

export function EntryComposerInlineSection({
  warningMessage = "",
  errorMessage = "",
  isSaveDisabled = false,
  isSaving = false,
  entry,
  categories,
  categoryOptions,
  accountOptions,
  ownerOptions,
  viewId,
  showSplitOptions,
  splitOptionsProps,
  onChange,
  onCategoryAppearanceChange,
  onOwnerChange,
  onSplitPercentChange,
  onSave,
  onCancel
}) {
  return (
    <section className="entry-row is-editing entry-composer">
      <div className="entry-inline-editor">
        {warningMessage ? <p className="entry-submit-error">{warningMessage}</p> : null}
        <EntryComposerContent
          entry={entry}
          categories={categories}
          categoryOptions={categoryOptions}
          accountOptions={accountOptions}
          ownerOptions={ownerOptions}
          viewId={viewId}
          showSplitOptions={showSplitOptions}
          splitOptionsProps={splitOptionsProps}
          onChange={onChange}
          onCategoryAppearanceChange={onCategoryAppearanceChange}
          onOwnerChange={onOwnerChange}
          onSplitPercentChange={onSplitPercentChange}
        />
        {errorMessage ? <p className="entry-submit-error">{errorMessage}</p> : null}
        <div className="entry-inline-actions">
          <button
            type="button"
            className="inline-action-button inline-save-action"
            aria-label="Create entry"
            disabled={isSaveDisabled}
            onClick={onSave}
          >
            <Check size={16} />
            <span className="desktop-action-label">{isSaving ? "Saving..." : "Save"}</span>
          </button>
          <button
            type="button"
            className="inline-action-button inline-cancel-action"
            aria-label="Cancel new entry"
            disabled={isSaving}
            onClick={onCancel}
          >
            <X size={16} />
            <span className="desktop-action-label">Cancel</span>
          </button>
        </div>
      </div>
    </section>
  );
}

export function EntryComposerMobileSection({
  errorMessage = "",
  saveLabel,
  isSaveDisabled = false,
  entry,
  categories,
  categoryOptions,
  accountOptions,
  ownerOptions,
  viewId,
  showSplitOptions,
  splitOptionsProps,
  onChange,
  onCategoryAppearanceChange,
  onOwnerChange,
  onSplitPercentChange,
  onClose,
  onSave
}) {
  return (
    <EntryMobileSheet
      title="Add entry"
      description="Create a ledger row without leaving the Entries page."
      errorMessage={errorMessage}
      saveLabel={saveLabel}
      isSaveDisabled={isSaveDisabled}
      onClose={onClose}
      onSave={onSave}
    >
      <EntryComposerContent
        entry={entry}
        categories={categories}
        categoryOptions={categoryOptions}
        accountOptions={accountOptions}
        ownerOptions={ownerOptions}
        viewId={viewId}
        showSplitOptions={showSplitOptions}
        splitOptionsProps={splitOptionsProps}
        onChange={onChange}
        onCategoryAppearanceChange={onCategoryAppearanceChange}
        onOwnerChange={onOwnerChange}
        onSplitPercentChange={onSplitPercentChange}
      />
    </EntryMobileSheet>
  );
}

function EntryComposerContent({
  entry,
  categories,
  categoryOptions,
  accountOptions,
  ownerOptions,
  viewId,
  showSplitOptions,
  splitOptionsProps,
  onChange,
  onCategoryAppearanceChange,
  onOwnerChange,
  onSplitPercentChange
}) {
  return (
    <>
      <EntryEditorFields
        entry={entry}
        categories={categories}
        categoryOptions={categoryOptions}
        accountOptions={accountOptions}
        ownerOptions={ownerOptions}
        splitPercentValue={entry.ownershipType === "shared" ? getVisibleSplitPercent(entry, viewId) ?? 50 : null}
        onChange={onChange}
        onCategoryAppearanceChange={onCategoryAppearanceChange}
        onOwnerChange={onOwnerChange}
        onSplitPercentChange={onSplitPercentChange}
      />
      {showSplitOptions ? <EntryComposerSplitOptions {...splitOptionsProps} /> : null}
    </>
  );
}

function EntryComposerSplitOptions({
  addToSplits,
  splitGroupId,
  splitGroupOptions,
  showSplitGroupSelect,
  onToggleAddToSplits,
  onSelectSplitGroup
}) {
  return (
    <div className="entry-composer-split-options">
      <label className="planned-link-row entry-composer-split-toggle">
        <input
          type="checkbox"
          checked={addToSplits}
          onChange={(event) => onToggleAddToSplits(event.target.checked)}
        />
        <span className="planned-link-row-main">
          <strong>Add this new entry to Splits</strong>
          <small>Create the entry and immediately create a linked split expense.</small>
        </span>
      </label>
      {addToSplits && showSplitGroupSelect ? (
        <label className="split-dialog-field entry-composer-split-group">
          <span>Split group</span>
          <ResponsiveSelect
            className="table-edit-input"
            title="Split group"
            value={splitGroupId}
            options={splitGroupOptions}
            onValueChange={onSelectSplitGroup}
          />
        </label>
      ) : null}
    </div>
  );
}
