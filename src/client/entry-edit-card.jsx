import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, CreditCard, Lock } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { CategoryAppearancePopover } from "./category-visuals";
import { formatCardDate, formatCardDateTime } from "./copy/ask-copy";
import { messages } from "./copy/en-SG";
import { entriesMessages } from "./copy/en-SG-entries";
import { selectAllOnFocus } from "./focus-utils";
import { BANK_FACTS_LOCK_LINE, getBankFactsLockMessage, getEntryTypeOptions, getTransferDirectionForTypeSwitch } from "./entry-type-options";
import { moniesClient } from "./monies-client-service";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { DateRow, GrowingTextarea, PickerRow, TimeRow } from "./detail-field-rows";
import { addedByLabel, bankStateChipLabel, moreDetailsSummary } from "./entry-source";
import { CategoryGlyph } from "./ui-components";
import { ChipDateField, ChipSelectField, DetailRow, DetailRows, LeadCard, MetaChip, MoreDetails } from "./ui/lead-support-detail";
import { useRouteWorkBusy } from "./use-route-work-status";
import { entryAmountTone } from "../domain/money-tone";
import { todayInAppTimeZone } from "./app-dates";

const { categories: categoryService, format: formatService } = moniesClient;
const copy = entriesMessages;
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
// - Support: date, wallet, owner and bank state chips. On a phone the date,
//   wallet and owner chips open the same picker as their Detail row (the
//   wallet's unfolds More details first). On a wide screen no row repeats
//   them, so each chip is its own field, as on the Splits inline card: a
//   date field over the date chip, a native list over the wallet and owner
//   chips. A field the statement certified shows a lock instead, and the
//   bank state chip is never an editor (it names the tool that saved a
//   provisional entry: "Apple Pay · provisional").
// - Detail: Category, Owner, Splits (or the transfer match), Note, then
//   Date, Wallet, Posted date and Type. On a phone those last ones fold into
//   More details and each row opens the app's own picker. On a wide screen
//   nothing folds, the Owner, Date and Wallet rows are left to their chips,
//   and each remaining row keeps an inline field, so Tab walks the fields in
//   order (the lead, then the chips, then the rows).
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
  // "Trip or event" (DOMAIN.md "Trip or Event"): the row the caller builds,
  // or null.
  tripEventRow = null,
  transferTools = null,
  // "What is this for?" on a transfer to someone in the household
  // (entry-transfer-purpose-row.jsx), or null.
  transferPurposeRow = null,
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
  const lockDetailId = useId();

  const typeOptions = getEntryTypeOptions(entry, { bankFactsLocked });
  const walletOptions = accountOptions.map((option) => ({ value: option.value, label: option.label }));
  const walletValue = entry.accountId ?? entry.accountName;
  const walletLabel = walletOptions.find((option) => option.value === walletValue)?.label ?? entry.accountName ?? copy.editCard.notSet;
  const walletChipValue = entry.accountName || copy.editCard.notSet;
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

  // On a phone a Support chip opens its field's own picker sheet (unfolding
  // More details for the wallet's folded row). A wide screen's chips are
  // their own fields (see the chips below).
  function openFieldFromChip(key) {
    if (key === "wallet") {
      setMoreOpen(true);
    }
    setOpenPicker(key);
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
   *   options: { value: string, label: string }[], onValueChange: (value: string) => void, locked?: boolean,
   *   categoryPick?: { description?: string } }} props
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
        categoryPick: { description: entry.description },
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

  const ownerSelectOptions = ownerOptions.map((person) => ({ value: person, label: person }));
  // A wide screen's chips are the date, wallet and owner fields, so those
  // three have no row there: a row would only repeat what its chip says.
  const ownerRow = isSheet ? pickerRow({
    key: "owner",
    label: copy.editOwner,
    valueLabel: ownerLabel,
    value: entry.ownerName ?? "",
    options: ownerSelectOptions,
    onValueChange: onOwnerChange
  }) : null;

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
    bankFactsLocked || !isSheet ? null : dateRow({ key: "date", label: copy.editDate, value: entry.date, onValueChange: (date) => onChange({ date }) }),
    bankFactsLocked || !isSheet ? null : pickerRow({
      key: "wallet",
      label: copy.editWallet,
      valueLabel: walletLabel,
      value: walletValue,
      options: walletOptions,
      onValueChange: changeWallet
    }),
    // The time of day, optional. Not a bank fact, so a certified entry keeps it editable.
    <TimeRow
      key="time"
      rowKey="time"
      isSheet={isSheet}
      label={copy.editTime}
      value={entry.time}
      clearLabel={copy.editCard.clearTime}
      notSetLabel={copy.editCard.notSet}
      onValueChange={(time) => onChange({ time })}
    />,
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
    }) : null,
    // Who added it (an in-app tool), shown only when known; nobody changes it.
    addedByLabel(entry.addedBy)
      ? <DetailRow key="addedBy" label={copy.source.addedBy} value={addedByLabel(entry.addedBy)} readOnly data-row="addedBy" />
      : null
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
            <MetaChip
              key="date"
              data-chip="date"
              icon={CalendarDays}
              locked={bankFactsLocked}
              lockedLabel={messages.common.chipLockedByStatement}
              control={(
                <ChipDateField
                  value={entry.date}
                  label={messages.common.changeChip(copy.editDate, formatCardDateTime(entry.date, today, entry.time))}
                  onValueChange={(date) => onChange({ date })}
                />
              )}
            >
              {formatCardDateTime(entry.date, today, entry.time)}
            </MetaChip>,
            // A wide screen has no Wallet row, so its chip shows even with no
            // wallet set; a phone's row is under More details.
            entry.accountName || !isSheet ? (
              <MetaChip
                key="wallet"
                data-chip="wallet"
                icon={CreditCard}
                locked={bankFactsLocked}
                lockedLabel={messages.common.chipLockedByStatement}
                actionLabel={messages.common.changeChip(copy.editWallet, walletChipValue)}
                onClick={isSheet ? () => openFieldFromChip("wallet") : undefined}
                control={isSheet ? null : (
                  <ChipSelectField
                    value={walletValue ?? ""}
                    label={messages.common.changeChip(copy.editWallet, walletChipValue)}
                    options={walletOptions}
                    onValueChange={changeWallet}
                  />
                )}
              >
                {walletChipValue}
              </MetaChip>
            ) : null,
            <MetaChip
              key="owner"
              data-chip="owner"
              person={entry.ownershipType === "shared" ? "shared" : entry.ownerName}
              actionLabel={messages.common.changeChip(copy.editOwner, ownerLabel)}
              onClick={isSheet ? () => openFieldFromChip("owner") : undefined}
              control={isSheet ? null : (
                <ChipSelectField
                  value={entry.ownerName ?? ""}
                  label={messages.common.changeChip(copy.editOwner, ownerLabel)}
                  options={ownerSelectOptions}
                  onValueChange={onOwnerChange}
                />
              )}
            >
              {ownerLabel}
            </MetaChip>,
            bankState ? (
              <MetaChip
                key="state"
                data-chip="state"
                icon={bankFactsLocked ? Lock : null}
                tone={BANK_STATE_TONES[bankState.className]}
                // The full lock rule, kept for a hover and a screen reader;
                // the line under the card is the short version.
                title={bankFactsLocked ? getBankFactsLockMessage(entry) : undefined}
                aria-describedby={bankFactsLocked ? lockDetailId : undefined}
              >
                {bankStateChipLabel(entry, bankState.label)}
              </MetaChip>
            ) : null
          ].filter(Boolean)}
        />
        {bankFactsLocked ? (
          <p className="lsd-note entry-edit-lock-message" role="status">
            <Lock size={14} aria-hidden="true" />
            {BANK_FACTS_LOCK_LINE}
          </p>
        ) : null}
        {bankFactsLocked ? <span id={lockDetailId} hidden>{getBankFactsLockMessage(entry)}</span> : null}
      </div>
      <DetailRows label={copy.editCard.detailsLabel} className="entry-edit-rows">
        {categoryRowWithQuickSave}
        {tripEventRow}
        {ownerRow}
        {splitsRow}
        {transferRow}
        {transferPurposeRow}
        {noteRow}
        {isSheet ? (
          <MoreDetails
            open={moreOpen}
            onOpenChange={setMoreOpen}
            label={copy.editCard.moreDetails}
            openLabel={copy.editCard.fewerDetails}
            summary={moreDetailsSummary({ locked: bankFactsLocked, addedBy: entry.addedBy })}
          >
            {bankRows}
          </MoreDetails>
        ) : bankRows}
      </DetailRows>
    </div>
  );
}

// What the lead amount field shows: formatted money ("64.20") while it is
// not being typed in, so a manual entry saved as "64.2" reads as the list
// reads it; the raw text while it is focused; nothing (the placeholder)
// when nothing is typed. The sign is its own span, so this is the size.
export function leadAmountFieldValue({ focused, draft, amountMinor }) {
  const text = String(draft ?? "");
  if (focused) {
    return text;
  }
  return text.trim() ? formatService.minorToDecimalString(Math.abs(amountMinor)) : "";
}

// The lead amount: the entry's amount in its money tone with its sign
// (hidden with the money), typed in place unless the statement certified it.
export function EntryLeadAmount({ entry, amountMinorValue, amountInputValue, locked, onChange, onAmountChange, action }) {
  const resolvedAmountMinor = typeof amountMinorValue === "number" ? amountMinorValue : entry.amountMinor;
  const resolvedAmountInput = amountInputValue ?? entry.amountInput ?? formatService.formatEditableMinorInput(resolvedAmountMinor);
  const [amountDraft, setAmountDraft] = useState(resolvedAmountInput);
  const [isFocused, setIsFocused] = useState(false);
  const shownAmount = leadAmountFieldValue({ focused: isFocused, draft: amountDraft, amountMinor: resolvedAmountMinor });
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
      <label htmlFor={inputId} className={`lsd-amount-field${shownAmount ? "" : " is-empty"}`}>
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
          style={{ width: `${Math.max(3, shownAmount.length) + 0.5}ch` }}
          value={shownAmount}
          onMouseDown={selectAllOnFocus}
          onFocus={(event) => {
            // Typing starts from the figure as shown ("64.20"), so the
            // value does not change under the select-all.
            setAmountDraft(shownAmount);
            setIsFocused(true);
            selectAllOnFocus(event);
          }}
          onInput={(event) => handleAmountDraftChange(event.currentTarget.value)}
          onChange={(event) => handleAmountDraftChange(event.target.value)}
          onBlur={(event) => {
            setIsFocused(false);
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
// on Splits. On Splits, the row opens a small menu (owner request,
// 2026-10-20): View split, and Remove from Splits, which keeps the entry and
// asks first (the page's own confirmation and command). The bottom bar keeps
// one destructive action, Delete entry.
export function EntrySplitsRow({
  isLinked,
  isWorking = false,
  isRemoving = false,
  onAddToSplits,
  onViewSplit,
  onRemoveFromSplits = undefined,
  quickAddLabel = "",
  quickAddTitle = "",
  onQuickAddToSplits = undefined
}) {
  if (isLinked && onRemoveFromSplits) {
    return (
      <EntrySplitsMenuRow
        isWorking={isWorking || isRemoving}
        onViewSplit={onViewSplit}
        onRemoveFromSplits={onRemoveFromSplits}
      />
    );
  }
  if (isLinked || !quickAddLabel || !onQuickAddToSplits) {
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

  return (
    <div className="entry-split-action-row" data-row="splits">
      <DetailRow
        label={copy.editCard.splits}
        value={copy.addToSplits}
        state="action"
        disabled={isWorking}
        onClick={onAddToSplits}
      />
      <button
        type="button"
        className="entry-split-quick-action"
        disabled={isWorking}
        title={quickAddTitle || quickAddLabel}
        onClick={onQuickAddToSplits}
      >
        {isWorking ? messages.common.working : quickAddLabel}
      </button>
    </div>
  );
}

// The Splits row's menu. The Radix popover renders in place, not in a
// portal, so it stays inside the phone sheet's focus trap; each item closes
// the menu and hands the work to the page.
function EntrySplitsMenuRow({ isWorking, onViewSplit, onRemoveFromSplits }) {
  const [open, setOpen] = useState(false);
  const items = [
    { key: "view", label: copy.editCard.viewSplit, run: onViewSplit, danger: false },
    { key: "remove", label: copy.editCard.removeFromSplits, run: onRemoveFromSplits, danger: true }
  ];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <DetailRow
          label={copy.editCard.splits}
          value={isWorking ? messages.common.working : copy.editCard.viewSplit}
          state="action"
          disabled={isWorking}
          data-row="splits"
          aria-label={copy.editCard.splitsMenuLabel}
          aria-haspopup="menu"
        />
      </Popover.Trigger>
      <Popover.Content
        className="entry-splits-menu"
        role="menu"
        aria-label={copy.editCard.splits}
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={12}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={`entry-splits-menu-item${item.danger ? " is-danger" : ""}`}
            onClick={() => {
              setOpen(false);
              item.run?.();
            }}
          >
            {item.label}
          </button>
        ))}
      </Popover.Content>
    </Popover.Root>
  );
}

// The transfer match row: the existing transfer dialog opens from it.
export function EntryTransferMatchRow(props) {
  return <DetailRow label={copy.editCard.transferMatch} value={copy.editCard.manageTransfer} state="action" data-row="transfer" {...props} />;
}
