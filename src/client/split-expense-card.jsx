import { Banknote, CalendarDays, CreditCard, Landmark, Plane, Users, Wallet } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { formatCardDate } from "./copy/ask-copy";
import { messages } from "./copy/en-SG";
import { DateRow, GrowingTextarea, PickerRow } from "./detail-field-rows";
import { focusFieldUnlessEditing } from "./deferred-focus";
import { selectAllOnFocus } from "./focus-utils";
import { moniesClient } from "./monies-client-service";
import { updateSplitExpenseDraft } from "./split-editing";
import { buildSplitShareRows, formatShareRatio } from "./split-share-rows";
import { todayInAppTimeZone } from "./app-dates";
import { formatCurrencyMinor } from "../domain/split-currency";
import { CategoryGlyph } from "./ui-components";
import { ChipDateField, ChipSelectField, DetailRow, DetailRows, LeadCard, MetaChip, MoreDetails } from "./ui/lead-support-detail";

const { categories: categoryService, format: formatService } = moniesClient;
const copy = messages.splits;
const cardCopy = messages.splits.expenseCard;
// Splits terracotta, from the category palette (the Splits-linked colour).
const GROUP_BUBBLE_COLOUR = "#BF7D51";
const PAYMENT_ICONS = { cash: Banknote, card: CreditCard, bank: Landmark, other: Wallet };

// The split expense card (design.md, "Lead · Support · Detail"): New split
// expense, Edit split and View split, in the phone sheet and the wide dialog:
// - Lead: the group bubble, what it was (typed in place), the group and the
//   total in the group currency (typed in place, plain ink: a split total
//   has no direction).
// - Support: date, who paid, the shares (50 / 50) and how it was paid; each
//   chip opens its Detail row's picker or the share editor (a folded row
//   unfolds More details first), and a payment way the ledger set is locked.
// - Detail: each person's share (a row opens the share editor, whose
//   percent and amount stay linked through the existing share calculation),
//   Category, Group, then Date, Paid by, Paid using, Currency, Evidence and
//   Note, which fold into More details on a phone. A split linked to an
//   entry adds a Linked entry row ("View entry").
// `readOnly` (View split, the household view) shows the same card with
// nothing to type in or tap but the linked entry: plain values, no share
// editor and no odd cent choice.
// SplitsPanel keeps the draft, the checks and the save, as with the form.
export function SplitExpenseCard({ dialog, groupOptions, people, categoryOptions, categories = [], onChange, layout, autoFocusAmount = false, readOnly = false, onViewLinkedEntry = undefined, amountAction = null }) {
  // "dialog" (the wide dialog) and "inline" (in the list on a wide screen) are the two-column card.
  const isSheet = layout === "sheet";
  // Inline in the list: the lead card across the top and the Detail rows in
  // two columns under it. Date, Paid by and Paid using are edited from their
  // Support chips (no row repeats them) and the share editor opens from a
  // share row or the shares chip.
  const isInline = layout === "inline";
  const amountInputRef = useRef(null);
  const [openPicker, setOpenPicker] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [shareEditorOpen, setShareEditorOpen] = useState(!isSheet && !readOnly && !isInline);
  const shareEditorId = useId();
  const cardRef = useRef(null);
  const today = todayInAppTimeZone();
  const currency = dialog?.currency ?? "SGD";
  const selectedGroup = groupOptions.find((group) => group.id === dialog?.groupId);
  const allowedPaymentMethods = selectedGroup?.expenseSource === "cash"
    ? ["cash"]
    : selectedGroup?.expenseSource === "ledger"
      ? ["card", "bank"]
      : ["cash", "card", "bank", "other"];
  const shareRows = buildSplitShareRows(dialog, people);
  const sharePersonName = dialog?.sharePersonName ?? people[0]?.name ?? "First person";
  const paymentMethod = dialog?.paymentMethod ?? "cash";
  const PaymentIcon = PAYMENT_ICONS[paymentMethod] ?? Wallet;
  const currencySymbol = formatService.moneyStep(currency).replace(/[\d.,\s]/g, "") || currency;
  const amountInput = dialog?.amountInput ?? formatService.minorToDecimalString(dialog?.amountMinor ?? 0);
  const hasAmount = Number(dialog?.amountMinor ?? 0) > 0;
  // Typed as typed; once left, the total reads in the group currency's own
  // digits ("12,000" yen, "86.40" dollars).
  const [amountFocused, setAmountFocused] = useState(false);
  const amountShown = amountFocused || !hasAmount
    ? amountInput
    : formatCurrencyMinor(Number(dialog?.amountMinor ?? 0), currency).replace(/^[^\d]+/, "");

  // Focus the total once when the card opens (and again for another draft).
  const hasDialog = Boolean(dialog);
  const dialogId = dialog?.id;
  useEffect(() => {
    if (!autoFocusAmount || !hasDialog) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      focusFieldUnlessEditing(amountInputRef.current, { select: true });
    }, 80);
    return () => window.clearTimeout(timeout);
  }, [autoFocusAmount, hasDialog, dialogId]);

  // The inline card has no dialog head to hold the money visibility toggle,
  // so it sits beside the total, as it does on the Entries inline editor.
  const withAmountAction = (node) => (amountAction ? <span className="split-lead-amount">{node}{amountAction}</span> : node);
  const update = (patch) => onChange((current) => current ? { ...current, ...patch } : current);
  const isLinked = Boolean(dialog?.linkedTransactionId);
  const paymentLabel = cardCopy.paymentMethods[paymentMethod] ?? paymentMethod;
  const evidenceLabel = cardCopy.evidenceOptions[dialog?.paymentStatus ?? "recorded"] ?? "";
  const paidUsingLabel = isLinked ? cardCopy.paidUsingLedger : cardCopy.paidUsing;
  // View split: the same row as a plain line (a locked field keeps its lock).
  const shownRow = (key, label, value, editor, { locked = false } = {}) => (readOnly
    ? <DetailRow key={key} label={label} value={value} readOnly locked={locked} data-row={key} />
    : editor);
  const pickerProps = (key) => ({
    rowKey: key,
    isSheet,
    open: openPicker === key,
    onOpenChange: (open) => setOpenPicker(open ? key : "")
  });

  // A Support chip opens its field's own picker: the picker sheet in a
  // sheet (unfolding More details), the row's select on a wide screen.
  function openFieldFromChip(key) {
    if (isSheet) {
      setMoreOpen(true);
      setOpenPicker(key);
      return;
    }
    const select = cardRef.current?.querySelector(`[data-row="${key}"] select`);
    if (select instanceof HTMLSelectElement) {
      select.focus();
      try {
        select.showPicker?.();
      } catch {
        // Focus alone is enough where a select cannot open from script.
      }
    }
  }

  function openShareEditorFromChip() {
    setShareEditorOpen(true);
    window.requestAnimationFrame(() => {
      cardRef.current?.querySelector(".split-share-rows")?.scrollIntoView({ block: "nearest" });
    });
  }

  const groupRow = shownRow("group", cardCopy.group, selectedGroup?.name ?? "", (
    <PickerRow
      {...pickerProps("group")}
      label={cardCopy.group}
      valueLabel={selectedGroup?.name ?? ""}
      value={dialog?.groupId ?? "split-group-none"}
      options={groupOptions.map((option) => ({ value: option.id, label: option.name }))}
      onValueChange={(nextValue) => onChange((current) => {
        if (!current) return current;
        const nextGroup = groupOptions.find((option) => option.id === nextValue);
        const nextPaymentMethod = nextGroup?.expenseSource === "cash"
          ? "cash"
          : nextGroup?.expenseSource === "ledger" && !["card", "bank"].includes(current.paymentMethod)
            ? "card"
            : current.paymentMethod;
        return { ...current, groupId: nextValue, currency: nextGroup?.currency ?? current.currency, paymentMethod: nextPaymentMethod };
      })}
    />
  ));

  const categoryRow = shownRow("category", copy.expenseCategory, dialog?.categoryName ?? "", (
    <PickerRow
      {...pickerProps("category")}
      label={copy.expenseCategory}
      valueLabel={dialog?.categoryName ?? ""}
      value={dialog?.categoryName ?? ""}
      options={categoryOptions.map((option) => {
        const optionCategory = categoryService.get(categories, { categoryName: option });
        return {
          value: option,
          label: option,
          iconKey: optionCategory?.iconKey,
          colorHex: optionCategory?.colorHex,
          icon: optionCategory ? <CategoryGlyph iconKey={optionCategory.iconKey} /> : null
        };
      })}
      onValueChange={(categoryName) => update({ categoryName })}
    />
  ));

  const dateLabel = dialog?.date ? formatCardDate(dialog.date, today, { withYear: true }) : "";
  const otherRows = [
    isInline ? null : shownRow("date", copy.expenseDate, dateLabel, (
      <DateRow
        key="date"
        rowKey="date"
        isSheet={isSheet}
        label={copy.expenseDate}
        value={dialog?.date ?? ""}
        valueLabel={dateLabel}
        onValueChange={(date) => update({ date })}
      />
    )),
    isInline ? null : shownRow("payer", copy.expensePaidBy, dialog?.payerPersonName ?? "", <PickerRow
      key="payer"
      {...pickerProps("payer")}
      label={copy.expensePaidBy}
      valueLabel={dialog?.payerPersonName ?? ""}
      value={dialog?.payerPersonName ?? ""}
      options={people.map((person) => ({ value: person.name, label: person.name }))}
      onValueChange={(payerPersonName) => update({ payerPersonName })}
    />),
    isInline ? null : shownRow("paymentMethod", paidUsingLabel, paymentLabel, <PickerRow
      key="paymentMethod"
      {...pickerProps("paymentMethod")}
      label={paidUsingLabel}
      valueLabel={paymentLabel}
      value={paymentMethod}
      options={allowedPaymentMethods.map((method) => ({ value: method, label: cardCopy.paymentMethods[method] }))}
      locked={isLinked}
      onValueChange={(nextMethod) => update({ paymentMethod: nextMethod })}
    />, { locked: isLinked }),
    shownRow("currency", cardCopy.currency, currency, <DetailRow key="currency" label={cardCopy.currency} data-row="currency">
      <input
        className="lsd-row-input split-card-currency"
        aria-label={cardCopy.currency}
        inputMode="text"
        autoCapitalize="characters"
        maxLength={3}
        value={currency}
        onChange={(event) => update({ currency: event.target.value.toUpperCase() })}
      />
    </DetailRow>),
    shownRow("evidence", cardCopy.evidence, evidenceLabel, <PickerRow
      key="evidence"
      {...pickerProps("evidence")}
      label={cardCopy.evidence}
      valueLabel={evidenceLabel}
      value={dialog?.paymentStatus ?? "recorded"}
      options={Object.entries(cardCopy.evidenceOptions).map(([value, label]) => ({ value, label }))}
      onValueChange={(paymentStatus) => update({ paymentStatus })}
    />),
    shownRow("note", copy.expenseNote, dialog?.note ?? "", <DetailRow key="note" label={copy.expenseNote} className="lsd-row-note" data-row="note">
      <GrowingTextarea
        className="lsd-row-input"
        aria-label={copy.expenseNote}
        placeholder={cardCopy.notePlaceholder}
        value={dialog?.note ?? ""}
        onChange={(note) => update({ note })}
      />
    </DetailRow>)
  ].filter(Boolean);

  const linkedEntryRow = isLinked && onViewLinkedEntry ? (
    <DetailRow
      label={copy.linkedEntry}
      value={copy.viewLinkedEntry}
      state="action"
      data-row="linkedEntry"
      onClick={onViewLinkedEntry}
    />
  ) : null;

  return (
    <div ref={cardRef} className={`split-expense-card is-${layout}`}>
      <div className="split-expense-card-lead">
        <LeadCard
          className="split-expense-lead"
          category={{ colorHex: GROUP_BUBBLE_COLOUR, icon: currency === "SGD" ? Users : Plane }}
          title={readOnly ? (dialog?.description || null) : (
            <GrowingTextarea
              className="lsd-title lsd-title-input"
              aria-label={copy.expenseDescription}
              placeholder={cardCopy.whatWasIt}
              value={dialog?.description ?? ""}
              singleLine
              onChange={(description) => update({ description })}
            />
          )}
          subtitle={selectedGroup?.name ?? ""}
          tone="neutral"
          editable={!readOnly}
          amount={readOnly ? withAmountAction(formatCurrencyMinor(Number(dialog?.amountMinor ?? 0), currency)) : withAmountAction(
            <label className={`lsd-amount-field${hasAmount ? "" : " is-empty"}`}>
              <span aria-hidden="true">{currencySymbol}</span>
              <input
                ref={amountInputRef}
                className="lsd-amount-input"
                type="text"
                inputMode="decimal"
                aria-label={copy.expenseAmount}
                autoComplete="off"
                enterKeyHint="next"
                style={{ width: `${Math.max(3, String(amountShown).length) + 0.5}ch` }}
                value={amountShown}
                onMouseDown={selectAllOnFocus}
                onFocus={(event) => {
                  setAmountFocused(true);
                  selectAllOnFocus(event);
                }}
                onChange={(event) => onChange((current) => current ? updateSplitExpenseDraft(current, {
                  amountInput: event.target.value,
                  amountMinor: formatService.decimalStringToMinor(event.target.value)
                }) : current)}
                onBlur={() => {
                  setAmountFocused(false);
                  onChange((current) => current ? {
                    ...current,
                    amountInput: formatService.minorToDecimalString(current.amountMinor ?? 0)
                  } : current);
                }}
              />
            </label>
          )}
          chips={[
            <MetaChip
              key="date"
              data-chip="date"
              icon={CalendarDays}
              control={readOnly ? null : (
                <ChipDateField
                  value={dialog?.date ?? ""}
                  label={messages.common.changeChip(copy.expenseDate, formatCardDate(dialog?.date, today))}
                  onValueChange={(date) => update({ date })}
                />
              )}
            >
              {formatCardDate(dialog?.date, today)}
            </MetaChip>,
            dialog?.payerPersonName ? (
              <MetaChip
                key="payer"
                data-chip="payer"
                person={dialog.payerPersonName}
                actionLabel={messages.common.changeChip(copy.expensePaidBy, dialog.payerPersonName)}
                onClick={readOnly || isInline ? undefined : () => openFieldFromChip("payer")}
                control={readOnly || !isInline ? null : (
                  <ChipSelectField
                    value={dialog.payerPersonName}
                    label={messages.common.changeChip(copy.expensePaidBy, dialog.payerPersonName)}
                    options={people.map((person) => ({ value: person.name, label: person.name }))}
                    onValueChange={(payerPersonName) => update({ payerPersonName })}
                  />
                )}
              >
                {cardCopy.paidBy(dialog.payerPersonName)}
              </MetaChip>
            ) : null,
            shareRows.length ? (
              <MetaChip
                key="shares"
                data-chip="shares"
                icon={Users}
                actionLabel={messages.common.changeChip(cardCopy.sharesChip, formatShareRatio(shareRows))}
                aria-haspopup={undefined}
                aria-expanded={readOnly ? undefined : shareEditorOpen}
                aria-controls={shareEditorOpen ? shareEditorId : undefined}
                onClick={readOnly ? undefined : openShareEditorFromChip}
              >
                {formatShareRatio(shareRows)}
              </MetaChip>
            ) : null,
            <MetaChip
              key="payment"
              data-chip="paymentMethod"
              icon={PaymentIcon}
              locked={isLinked}
              lockedLabel={cardCopy.paymentLockedByLedger}
              actionLabel={messages.common.changeChip(cardCopy.paidUsing, paymentLabel)}
              onClick={readOnly || isInline ? undefined : () => openFieldFromChip("paymentMethod")}
              control={readOnly || !isInline ? null : (
                <ChipSelectField
                  value={paymentMethod}
                  label={messages.common.changeChip(cardCopy.paidUsing, paymentLabel)}
                  options={allowedPaymentMethods.map((method) => ({ value: method, label: cardCopy.paymentMethods[method] }))}
                  onValueChange={(nextMethod) => update({ paymentMethod: nextMethod })}
                />
              )}
            >
              {paymentLabel}
            </MetaChip>
          ].filter(Boolean)}
        />
      </div>
      <DetailRows label={cardCopy.detailsLabel} className="split-expense-rows">
        {shareRows.length ? (
          <div className="split-share-rows" role="group" aria-label={cardCopy.sharesLabel}>
            {shareRows.map((row) => (
              readOnly ? (
                <DetailRow
                  key={row.personName}
                  label={cardCopy.shareRow(row.personName)}
                  value={cardCopy.shareValue(row.percentLabel, formatService.moneyWithCurrency(row.amountMinor, currency))}
                  readOnly
                  data-share-row={row.personName}
                />
              ) : (
                <DetailRow
                  key={row.personName}
                  label={cardCopy.shareRow(row.personName)}
                  value={cardCopy.shareValue(row.percentLabel, formatService.moneyWithCurrency(row.amountMinor, currency))}
                  aria-expanded={shareEditorOpen}
                  aria-controls={shareEditorId}
                  data-share-row={row.personName}
                  onClick={() => setShareEditorOpen((open) => !open)}
                />
              )
            ))}
          </div>
        ) : null}
        {shareRows.length && shareEditorOpen && !readOnly ? (
          <div id={shareEditorId} className="split-share-editor">
            <SplitShareEditor dialog={dialog} sharePersonName={sharePersonName} onChange={onChange} />
          </div>
        ) : null}
        {readOnly ? null : <OddCentChooser dialog={dialog} people={people} onChange={onChange} />}
        {categoryRow}
        {groupRow}
        {linkedEntryRow}
        {isSheet ? (
          <MoreDetails
            open={moreOpen}
            onOpenChange={setMoreOpen}
            label={cardCopy.moreDetails}
            openLabel={cardCopy.fewerDetails}
            summary={cardCopy.moreDetailsSummary}
          >
            {otherRows}
          </MoreDetails>
        ) : otherRows}
      </DetailRows>
      {selectedGroup?.expenseSource === "cash" || selectedGroup?.expenseSource === "ledger" ? (
        <p className="lsd-note split-expense-source-note">
          {selectedGroup.expenseSource === "cash"
            ? "Cash-only group: no bank or card match is expected."
            : "Bank/card group: cash purchases belong in a separate cash group."}
        </p>
      ) : null}
    </div>
  );
}

// The share editor: the share person's percent and amount, linked as the
// old form linked them (updateSplitExpenseDraft keeps the other in step
// while typing and settles both on leaving the field). The odd cent choice
// shows under the share rows whenever it applies, editor open or not.
function SplitShareEditor({ dialog, sharePersonName, onChange }) {
  return (
    <>
      <DetailRow label={copy.expenseSplit(sharePersonName)} className="split-share-field" data-row="share-percent">
        <input
          className="lsd-row-input"
          type="text"
          inputMode="decimal"
          aria-label={copy.expenseSplit(sharePersonName)}
          value={dialog?.splitPercentInput ?? String(Number(dialog?.splitBasisPoints ?? 5000) / 100)}
          enterKeyHint="next"
          onMouseDown={selectAllOnFocus}
          onFocus={selectAllOnFocus}
          onChange={(event) => onChange((current) => current ? updateSplitExpenseDraft(current, {
            splitPercentInput: event.target.value,
            splitBasisPoints: Math.round(Number(event.target.value || 0) * 100)
          }, "percent") : current)}
          onBlur={() => onChange((current) => current ? updateSplitExpenseDraft(current, {
            splitPercentInput: String(Number(current.splitBasisPoints ?? 5000) / 100)
          }, "percent", { commit: true }) : current)}
        />
      </DetailRow>
      <DetailRow label={copy.expenseExactAmount(sharePersonName)} className="split-share-field" data-row="share-amount">
        <input
          className="lsd-row-input"
          type="text"
          inputMode="decimal"
          aria-label={copy.expenseExactAmount(sharePersonName)}
          value={dialog?.splitAmountInput ?? formatService.minorToDecimalString(dialog?.splitAmountMinor ?? 0)}
          enterKeyHint="done"
          onMouseDown={selectAllOnFocus}
          onFocus={selectAllOnFocus}
          onChange={(event) => onChange((current) => current ? updateSplitExpenseDraft(current, {
            splitAmountInput: event.target.value,
            splitAmountMinor: formatService.decimalStringToMinor(event.target.value)
          }, "amount") : current)}
          onBlur={() => onChange((current) => current ? updateSplitExpenseDraft(current, {
            splitAmountInput: formatService.minorToDecimalString(current.splitAmountMinor ?? 0)
          }, "amount", { commit: true }) : current)}
        />
      </DetailRow>
    </>
  );
}

function getSplitCounterparty(people, primaryName) {
  return people.find((person) => person.name !== primaryName) ?? null;
}

function splitSharePreview(dialog, people) {
  const totalAmountMinor = Math.max(0, Number(dialog?.amountMinor ?? 0));
  const primaryName = dialog?.sharePersonName ?? people[0]?.name ?? "First person";
  const counterparty = getSplitCounterparty(people, primaryName);
  const primaryAmountMinor = Math.max(0, Math.min(totalAmountMinor, Number(dialog?.splitAmountMinor ?? 0)));
  const secondaryAmountMinor = Math.max(0, totalAmountMinor - primaryAmountMinor);

  return {
    totalAmountMinor,
    primaryName,
    secondaryName: counterparty?.name ?? "Second person",
    primaryAmountMinor,
    secondaryAmountMinor
  };
}

function applyPrimarySplitAmount(current, primaryAmountMinor) {
  const amountMinor = Math.max(0, Math.min(Number(current?.amountMinor ?? 0), Number(primaryAmountMinor ?? 0)));
  return updateSplitExpenseDraft(current, {
    splitAmountMinor: amountMinor,
    splitAmountInput: formatService.minorToDecimalString(amountMinor)
  }, "amount", { commit: true });
}

function OddCentChooser({ dialog, people, onChange }) {
  const preview = splitSharePreview(dialog, people);
  const hasOddCent = preview.totalAmountMinor % 2 === 1;
  const hasTwoSidedShare = preview.primaryAmountMinor > 0 && preview.secondaryAmountMinor > 0;
  const canShow = hasOddCent && hasTwoSidedShare && people.length >= 2 && preview.totalAmountMinor > 0;

  if (!canShow) {
    return null;
  }

  const lowerHalf = Math.floor(preview.totalAmountMinor / 2);
  const higherHalf = preview.totalAmountMinor - lowerHalf;
  const extraCentName = preview.primaryAmountMinor > preview.secondaryAmountMinor
    ? preview.primaryName
    : preview.secondaryName;
  const extraStep = formatService.moneyStep(dialog?.currency ?? "SGD");

  return (
    <div className="split-odd-cent-control">
      <div>
        <strong>Odd cent</strong>
        <p>
          This amount cannot split into two equal cents. Pick who carries the extra cent so this record can match
          another split app exactly.
        </p>
      </div>
      <div className="split-odd-cent-actions" role="group" aria-label="Choose odd cent recipient">
        <button
          type="button"
          className={extraCentName === preview.primaryName ? "is-selected" : ""}
          onClick={() => onChange((current) => current ? applyPrimarySplitAmount(current, higherHalf) : current)}
        >
          {preview.primaryName} gets +{extraStep}
        </button>
        <button
          type="button"
          className={extraCentName === preview.secondaryName ? "is-selected" : ""}
          onClick={() => onChange((current) => current ? applyPrimarySplitAmount(current, lowerHalf) : current)}
        >
          {preview.secondaryName} gets +{extraStep}
        </button>
      </div>
    </div>
  );
}
