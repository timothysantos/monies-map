import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, CreditCard, Lock } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { CategoryAppearancePopover } from "./category-visuals";
import { formatCardDate } from "./copy/ask-copy";
import { messages } from "./copy/en-SG";
import { selectAllOnFocus } from "./focus-utils";
import { getBankFactsLockMessage, getEntryTypeOptions, getTransferDirectionForTypeSwitch } from "./entry-type-options";
import { moniesClient } from "./monies-client-service";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { DateRow, GrowingTextarea, PickerRow } from "./detail-field-rows";
import { CategoryGlyph } from "./ui-components";
import { DetailRow, DetailRows, LeadCard, MetaChip, MoreDetails } from "./ui/lead-support-detail";
import { useRouteWorkBusy } from "./use-route-work-status";
import { entryAmountTone } from "../domain/money-tone";
import { todayInAppTimeZone } from "./app-dates";

const { categories: categoryService, format: formatService } = moniesClient;
const copy = messages.entries;
const SIGNS = { expense: "−", income: "+", transfer: "" };
const BANK_STATE_TONES = {
  "is-statement-certified": "mint",
  "is-import-provisional": "sky",
  "is-manual-provisional": "butter"
};

// The entry edit card (design.md, "Lead · Support · Detail"): the Entries
// edit sheet on a phone (layout "sheet") and the inline editor on a wide
// screen (layout "inline") show one entry the same way:
// - Lead: the category bubble (which opens the category editor), what it
//   was (an inline field, read-only when certified) and the amount in its
//   money tone (an inline field unless certified).
// - Support: date, wallet, owner and bank state chips.
// - Detail: Category, Owner, Splits (or the transfer match), Note, then
//   Date, Wallet, Posted date and Type. On a phone those last ones fold into
//   More details and each row opens the app's own picker; on a wide screen
//   nothing folds and each row keeps an inline field, so Tab walks the
//   fields in order.
// Callers keep ownership of saving, deleting and the Splits actions, as
// they did with the grid editor.
export function EntryEditCard({
  entry,
  layout,
  categories,
  categoryOptions,
  accountOptions,
  ownerOptions,
  amountMinorValue,
  amountInputValue = undefined,
  bankFactsLocked = false,
  bankState = null,
  onChange,
  onAmountChange,
  onCategoryAppearanceChange = undefined,
  onCategoryQuickSave = undefined,
  isCategoryQuickSaving = false,
  onOwnerChange,
  splitsRow = null,
  transferTools = null,
  amountAction = null
}) {
  const isSheet = layout === "sheet";
  const isTransfer = entry.entryType === "transfer";
  const displayCategoryName = isTransfer ? "Transfer" : entry.categoryName;
  const category = categoryService.get(categories, { categoryName: displayCategoryName });
  const categoryTheme = categoryService.getTheme(categories, { categoryName: displayCategoryName }, 0);
  const today = todayInAppTimeZone();
  const [openPicker, setOpenPicker] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [categoryQuickSaveOpen, setCategoryQuickSaveOpen] = useState(false);
  useRouteWorkBusy(categoryQuickSaveOpen);
  const quickSaveCategoryNameRef = useRef("");

  const typeOptions = getEntryTypeOptions(entry, { bankFactsLocked });
  const walletOptions = accountOptions.map((option) => ({ value: option.value, label: option.label }));
  const walletValue = entry.accountId ?? entry.accountName;
  const walletLabel = walletOptions.find((option) => option.value === walletValue)?.label ?? entry.accountName ?? copy.editCard.notSet;
  const ownerLabel = entry.ownershipType === "shared" ? copy.shared : entry.ownerName ?? copy.editCard.notSet;
  const categorySelectOptions = categoryOptions.map((option) => {
    const optionCategory = categories.find((item) => item.name === option);
    return {
      value: option,
      label: option,
      iconKey: optionCategory?.iconKey,
      colorHex: optionCategory?.colorHex,
      icon: optionCategory ? <CategoryGlyph iconKey={optionCategory.iconKey} /> : null
    };
  });

  function changeCategory(nextCategoryName) {
    onChange(categoryService.buildPatch(categories, nextCategoryName));
    if (onCategoryQuickSave && nextCategoryName !== entry.categoryName) {
      quickSaveCategoryNameRef.current = nextCategoryName;
      setCategoryQuickSaveOpen(true);
    }
  }

  function changeWallet(nextValue) {
    const selectedAccount = accountOptions.find((option) => option.value === nextValue);
    onChange({
      accountId: selectedAccount?.value,
      accountName: selectedAccount?.accountName ?? nextValue,
      accountOwnerLabel: selectedAccount?.ownerLabel
    });
  }

  function changeType(nextEntryType) {
    onChange({
      entryType: nextEntryType,
      categoryName: nextEntryType === "transfer"
        ? "Transfer"
        : entry.categoryName === "Transfer"
          ? "Other"
          : entry.categoryName,
      transferDirection: nextEntryType === "transfer" ? getTransferDirectionForTypeSwitch(entry, { bankFactsLocked }) : undefined
    });
  }

  /**
   * @param {{ key: string, label: string, valueLabel: string, value: string,
   *   options: { value: string, label: string }[], onValueChange: (value: string) => void, locked?: boolean }} props
   */
  function pickerRow({ key, ...props }) {
    return (
      <PickerRow
        key={key}
        rowKey={key}
        isSheet={isSheet}
        open={openPicker === key}
        onOpenChange={(open) => setOpenPicker(open ? key : "")}
        {...props}
      />
    );
  }

  /**
   * @param {{ key: string, label: string, value: string | undefined,
   *   onValueChange: (value: string) => void, locked?: boolean }} props
   */
  function dateRow({ key, value, ...props }) {
    return (
      <DateRow
        key={key}
        rowKey={key}
        isSheet={isSheet}
        value={value}
        valueLabel={value ? formatCardDate(value, today, { withYear: true }) : copy.editCard.notSet}
        {...props}
      />
    );
  }

  const categoryRow = isTransfer
    ? <DetailRow key="category" label={copy.editCategory} value={displayCategoryName} state="locked" data-row="category" />
    : pickerRow({
        key: "category",
        label: copy.editCategory,
        valueLabel: entry.categoryName || copy.editCard.notSet,
        value: entry.categoryName,
        options: categorySelectOptions,
        onValueChange: changeCategory
      });

  const categoryRowWithQuickSave = onCategoryQuickSave && !isTransfer ? (
    <Popover.Root key="category" open={categoryQuickSaveOpen} onOpenChange={setCategoryQuickSaveOpen}>
      <Popover.Anchor asChild>
        <div className="lsd-row-group">{categoryRow}</div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content className="entry-category-save-popover" sideOffset={8} align="start">
          <strong>{copy.saveCategoryPrompt}</strong>
          <p>{copy.saveCategoryPromptDetail}</p>
          <div className="entry-category-save-actions">
            <button
              type="button"
              className="dialog-primary"
              disabled={isCategoryQuickSaving}
              onClick={async () => {
                const categoryName = quickSaveCategoryNameRef.current || entry.categoryName;
                const saved = await onCategoryQuickSave(categoryService.buildPatch(categories, categoryName));
                if (saved) {
                  quickSaveCategoryNameRef.current = "";
                  setCategoryQuickSaveOpen(false);
                }
              }}
            >
              {isCategoryQuickSaving ? messages.common.saving : copy.saveCategoryNow}
            </button>
            <button type="button" className="subtle-action" disabled={isCategoryQuickSaving} onClick={() => {
              quickSaveCategoryNameRef.current = "";
              setCategoryQuickSaveOpen(false);
            }}>
              {copy.cancelEdit}
            </button>
          </div>
          <Popover.Arrow className="category-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  ) : categoryRow;

  const ownerRow = pickerRow({
    key: "owner",
    label: copy.editOwner,
    valueLabel: ownerLabel,
    value: entry.ownerName ?? "",
    options: ownerOptions.map((person) => ({ value: person, label: person })),
    onValueChange: onOwnerChange
  });

  const noteRow = (
    <DetailRow key="note" label={copy.editNote} className="lsd-row-note" data-row="note">
      <GrowingTextarea
        className="lsd-row-input"
        aria-label={copy.editNote}
        placeholder={copy.editCard.notePlaceholder}
        value={entry.note ?? ""}
        onChange={(note) => onChange({ note })}
      />
    </DetailRow>
  );

  const transferRow = isTransfer && transferTools ? (
    <span key="transfer" className="lsd-row-group">{transferTools}</span>
  ) : null;

  // Bank facts: on a phone, fold the ones most people never change here.
  const bankRows = [
    bankFactsLocked ? null : dateRow({ key: "date", label: copy.editDate, value: entry.date, onValueChange: (date) => onChange({ date }) }),
    bankFactsLocked ? null : pickerRow({
      key: "wallet",
      label: copy.editWallet,
      valueLabel: walletLabel,
      value: walletValue,
      options: walletOptions,
      onValueChange: changeWallet
    }),
    dateRow({ key: "postDate", label: copy.editPostDate, value: entry.postDate, onValueChange: (postDate) => onChange({ postDate: postDate || undefined }), locked: bankFactsLocked }),
    pickerRow({
      key: "type",
      label: copy.editType,
      valueLabel: typeOptions.find((option) => option.value === entry.entryType)?.label ?? entry.entryType,
      value: entry.entryType,
      options: typeOptions,
      onValueChange: changeType,
      locked: typeOptions.length < 2
    }),
    isTransfer ? pickerRow({
      key: "transferDirection",
      label: copy.editTransferDirection,
      valueLabel: entry.transferDirection === "in" ? copy.editCard.transferIn : copy.editCard.transferOut,
      value: entry.transferDirection ?? "out",
      options: [
        { value: "out", label: copy.editCard.transferOut },
        { value: "in", label: copy.editCard.transferIn }
      ],
      onValueChange: (transferDirection) => onChange({ transferDirection }),
      locked: bankFactsLocked
    }) : null
  ].filter(Boolean);

  return (
    <div className={`entry-edit-card is-${layout}`}>
      <div className="entry-edit-card-lead">
        <LeadCard
          className="entry-edit-lead"
          category={{
            colorHex: categoryTheme.color,
            iconKey: categoryTheme.iconKey,
            bubble: category && onCategoryAppearanceChange && !isTransfer
              ? <CategoryAppearancePopover category={category} onChange={onCategoryAppearanceChange} />
              : null
          }}
          title={(
            <GrowingTextarea
              className="lsd-title lsd-title-input"
              aria-label={copy.editDescription}
              placeholder={copy.editCard.whatWasIt}
              value={entry.description}
              readOnly={bankFactsLocked}
              singleLine
              onChange={(description) => onChange({ description })}
            />
          )}
          subtitle={displayCategoryName}
          amount={(
            <EntryLeadAmount
              entry={entry}
              amountMinorValue={amountMinorValue}
              amountInputValue={amountInputValue}
              locked={bankFactsLocked}
              onChange={onChange}
              onAmountChange={onAmountChange}
              action={amountAction}
            />
          )}
          tone={entryAmountTone(entry.entryType, entry.entryType === "income" ? 1 : -1)}
          editable={!bankFactsLocked}
          chips={[
            <MetaChip key="date" icon={CalendarDays}>{formatCardDate(entry.date, today)}</MetaChip>,
            entry.accountName ? <MetaChip key="wallet" icon={CreditCard}>{entry.accountName}</MetaChip> : null,
            <MetaChip key="owner" person={entry.ownershipType === "shared" ? "shared" : entry.ownerName}>{ownerLabel}</MetaChip>,
            bankState ? (
              <MetaChip key="state" icon={bankFactsLocked ? Lock : null} tone={BANK_STATE_TONES[bankState.className]}>
                {bankState.label}
              </MetaChip>
            ) : null
          ].filter(Boolean)}
        />
        {bankFactsLocked ? (
          <p className="lsd-note entry-edit-lock-message" role="status">
            <Lock size={14} aria-hidden="true" />
            {getBankFactsLockMessage(entry)}
          </p>
        ) : null}
      </div>
      <DetailRows label={copy.editCard.detailsLabel} className="entry-edit-rows">
        {categoryRowWithQuickSave}
        {ownerRow}
        {splitsRow}
        {transferRow}
        {noteRow}
        {isSheet ? (
          <MoreDetails
            open={moreOpen}
            onOpenChange={setMoreOpen}
            label={copy.editCard.moreDetails}
            openLabel={copy.editCard.fewerDetails}
            summary={bankFactsLocked ? copy.editCard.moreDetailsLocked : copy.editCard.moreDetailsOpen}
          >
            {bankRows}
          </MoreDetails>
        ) : bankRows}
      </DetailRows>
    </div>
  );
}

// The lead amount: the entry's amount in its money tone with its sign
// (hidden with the money), typed in place unless the statement certified it.
function EntryLeadAmount({ entry, amountMinorValue, amountInputValue, locked, onChange, onAmountChange, action }) {
  const resolvedAmountMinor = typeof amountMinorValue === "number" ? amountMinorValue : entry.amountMinor;
  const resolvedAmountInput = amountInputValue ?? entry.amountInput ?? formatService.formatEditableMinorInput(resolvedAmountMinor);
  const [amountDraft, setAmountDraft] = useState(resolvedAmountInput);
  const inputId = useId();
  // Hidden money hides the sign with the amount (design.md, "Money Colour").
  const { areTotalsVisible } = useMoneyPrivacy();
  const sign = areTotalsVisible ? SIGNS[entry.entryType] ?? "" : "";

  useEffect(() => {
    setAmountDraft(resolvedAmountInput);
  }, [resolvedAmountInput, entry.id]);

  function handleAmountDraftChange(nextValue) {
    setAmountDraft(nextValue);
    if (!nextValue.trim()) {
      onChange({ amountInput: "", amountMinor: 0 });
      return;
    }
    onChange({
      amountInput: nextValue,
      amountMinor: Math.max(0, formatService.parseMoneyInput(nextValue, resolvedAmountMinor))
    });
  }

  if (locked) {
    return (
      <span className="entry-lead-amount">
        <strong>
          <span className="lsd-amount-sign">{sign}</span>
          <PrivateMoney>{formatService.money(Math.abs(resolvedAmountMinor))}</PrivateMoney>
        </strong>
        {action}
      </span>
    );
  }

  return (
    <span className="entry-lead-amount">
      <label htmlFor={inputId} className={`lsd-amount-field${amountDraft ? "" : " is-empty"}`}>
        <span className="lsd-amount-sign" aria-hidden="true">{sign}</span>
        <span aria-hidden="true">$</span>
        <input
          id={inputId}
          className="lsd-amount-input"
          type="text"
          inputMode="decimal"
          aria-label={copy.editAmount}
          autoComplete="off"
          placeholder="0.00"
          enterKeyHint="next"
          style={{ width: `${Math.max(3, String(amountDraft ?? "").length) + 0.5}ch` }}
          value={amountDraft}
          onMouseDown={selectAllOnFocus}
          onFocus={selectAllOnFocus}
          onInput={(event) => handleAmountDraftChange(event.currentTarget.value)}
          onChange={(event) => handleAmountDraftChange(event.target.value)}
          onBlur={(event) => {
            const blurAmountMinor = Math.max(0, formatService.parseMoneyInput(event.target.value, resolvedAmountMinor));
            const formattedAmountInput = formatService.formatEditableMinorInput(blurAmountMinor);
            setAmountDraft(formattedAmountInput);
            if (onAmountChange) {
              onAmountChange({ amountInput: formattedAmountInput, amountMinor: blurAmountMinor });
            } else {
              onChange({ amountInput: formattedAmountInput });
            }
          }}
        />
      </label>
      {action}
    </span>
  );
}

// The Splits row of an expense: "Add to splits", or "View split" once it is
// on Splits. Removing it from Splits (Delete split) sits with the other
// destructive actions in the bottom bar.
export function EntrySplitsRow({ isLinked, isWorking = false, onAddToSplits, onViewSplit }) {
  return (
    <DetailRow
      label={copy.editCard.splits}
      value={isWorking ? messages.common.working : isLinked ? copy.editCard.viewSplit : copy.addToSplits}
      state="action"
      disabled={isWorking}
      data-row="splits"
      onClick={isLinked ? onViewSplit : onAddToSplits}
    />
  );
}

// The transfer match row: the existing transfer dialog opens from it.
export function EntryTransferMatchRow(props) {
  return <DetailRow label={copy.editCard.transferMatch} value={copy.editCard.manageTransfer} state="action" data-row="transfer" {...props} />;
}
