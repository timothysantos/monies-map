import { ArrowRightLeft, Banknote, CalendarDays, CreditCard, Landmark, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { todayInAppTimeZone } from "./app-dates";
import { formatCardDate } from "./copy/ask-copy";
import { messages } from "./copy/en-SG";
import { focusFieldUnlessEditing } from "./deferred-focus";
import { DateRow, GrowingTextarea, PickerRow } from "./detail-field-rows";
import { selectAllOnFocus } from "./focus-utils";
import { moniesClient } from "./monies-client-service";
import { ChipDateField, DetailRow, DetailRows, LeadCard, MetaChip } from "./ui/lead-support-detail";

const { format: formatService } = moniesClient;
const copy = messages.splits;
const cardCopy = messages.splits.expenseCard;
// Splits terracotta, from the category palette (the split expense card's colour).
const GROUP_BUBBLE_COLOUR = "#BF7D51";
const PAYMENT_ICONS = { cash: Banknote, card: CreditCard, bank: Landmark, other: Wallet };
const PAYMENT_METHODS = ["cash", "card", "bank", "other"];

// The settlement card (design.md, "Lead · Support · Detail"): Record
// settlement, an edited or viewed settle-up, in the phone sheet, the wide
// dialog and the list on a wide screen (the same layouts as the split
// expense card, whose styles it shares):
// - Lead: the settle-up bubble, who paid whom, the group and the amount
//   (typed in place, plain ink: a payment has no direction here).
// - Support: the date (a tap opens the date picker) and how it was paid.
// - Detail: Group, Paid by, Received by, Date, Note, then Paid using,
//   Currency and Evidence, and a Linked entry row ("View entry") when the settle-up came from a bank row.
// `readOnly` (View split, the household view) shows the same card as plain
// lines. SplitsPanel keeps the draft, the checks and the save.
export function SplitSettlementCard({ dialog, groupOptions, people, onChange, layout, autoFocusAmount = false, readOnly = false, onViewLinkedEntry = undefined, amountAction = null }) {
  const isSheet = layout === "sheet";
  const isInline = layout === "inline";
  const amountInputRef = useRef(null);
  const [openPicker, setOpenPicker] = useState("");
  const today = todayInAppTimeZone();
  const currency = dialog?.currency ?? "SGD";
  const selectedGroup = groupOptions.find((group) => group.id === (dialog?.groupId ?? "split-group-none"));
  const isLinked = Boolean(dialog?.linkedTransactionId);
  const paymentMethod = dialog?.paymentMethod ?? "cash";
  const PaymentIcon = PAYMENT_ICONS[paymentMethod] ?? Wallet;
  const paymentLabel = cardCopy.paymentMethods[paymentMethod] ?? paymentMethod;
  const evidenceLabel = cardCopy.evidenceOptions[dialog?.paymentStatus ?? "recorded"] ?? "";
  const paidUsingLabel = isLinked ? cardCopy.paidUsingLedger : cardCopy.paidUsing;
  const currencySymbol = formatService.moneyStep(currency).replace(/[\d.,\s]/g, "") || currency;
  const amountInput = dialog?.amountInput ?? formatService.minorToDecimalString(dialog?.amountMinor ?? 0);
  const dateLabel = dialog?.date ? formatCardDate(dialog.date, today, { withYear: true }) : "";
  const title = dialog?.fromPersonName && dialog?.toPersonName
    ? `${dialog.fromPersonName} paid ${dialog.toPersonName}`
    : copy.createSettlement;
  const update = (patch) => onChange((current) => current ? { ...current, ...patch } : current);

  // Focus the amount once when the card opens (and again for another draft).
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

  const pickerProps = (key) => ({
    rowKey: key,
    isSheet,
    open: openPicker === key,
    onOpenChange: (open) => setOpenPicker(open ? key : "")
  });
  // View split: the same row as a plain line (a locked field keeps its lock).
  const shownRow = (key, label, value, editor, { locked = false } = {}) => (readOnly
    ? <DetailRow key={key} label={label} value={value} readOnly locked={locked} data-row={key} />
    : editor);
  const personOptions = people.map((person) => ({ value: person.name, label: person.name }));

  const mainRows = [
    shownRow("group", cardCopy.group, selectedGroup?.name ?? "", <PickerRow
      key="group"
      {...pickerProps("group")}
      label={cardCopy.group}
      valueLabel={selectedGroup?.name ?? ""}
      value={dialog?.groupId ?? "split-group-none"}
      options={groupOptions.map((option) => ({ value: option.id, label: option.name }))}
      onValueChange={(groupId) => update({ groupId })}
    />),
    shownRow("from", copy.settlementFrom, dialog?.fromPersonName ?? "", <PickerRow
      key="from"
      {...pickerProps("from")}
      label={copy.settlementFrom}
      valueLabel={dialog?.fromPersonName ?? ""}
      value={dialog?.fromPersonName ?? ""}
      options={personOptions}
      onValueChange={(fromPersonName) => update({ fromPersonName })}
    />),
    shownRow("to", copy.settlementTo, dialog?.toPersonName ?? "", <PickerRow
      key="to"
      {...pickerProps("to")}
      label={copy.settlementTo}
      valueLabel={dialog?.toPersonName ?? ""}
      value={dialog?.toPersonName ?? ""}
      options={personOptions}
      onValueChange={(toPersonName) => update({ toPersonName })}
    />),
    // Inline in the list the date is edited from its chip, as on the expense card.
    isInline ? null : shownRow("date", copy.settlementDate, dateLabel, <DateRow
      key="date"
      rowKey="date"
      isSheet={isSheet}
      label={copy.settlementDate}
      value={dialog?.date ?? ""}
      valueLabel={dateLabel}
      onValueChange={(date) => update({ date })}
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

  const otherRows = [
    shownRow("paymentMethod", paidUsingLabel, paymentLabel, <PickerRow
      key="paymentMethod"
      {...pickerProps("paymentMethod")}
      label={paidUsingLabel}
      valueLabel={paymentLabel}
      value={paymentMethod}
      options={PAYMENT_METHODS.map((method) => ({ value: method, label: cardCopy.paymentMethods[method] }))}
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
    />)
  ];

  const linkedEntryRow = isLinked && onViewLinkedEntry ? (
    <DetailRow
      label={copy.linkedEntry}
      value={copy.viewLinkedEntry}
      state="action"
      data-row="linkedEntry"
      onClick={onViewLinkedEntry}
    />
  ) : null;

  const amountField = (
    <label className={`lsd-amount-field${Number(dialog?.amountMinor ?? 0) > 0 ? "" : " is-empty"}`}>
      <span aria-hidden="true">{currencySymbol}</span>
      <input
        ref={amountInputRef}
        className="lsd-amount-input"
        type="text"
        inputMode="decimal"
        aria-label={copy.settlementAmount}
        autoComplete="off"
        enterKeyHint="done"
        style={{ width: `${Math.max(3, String(amountInput).length) + 0.5}ch` }}
        value={amountInput}
        onMouseDown={selectAllOnFocus}
        onFocus={selectAllOnFocus}
        onChange={(event) => update({
          amountInput: event.target.value,
          amountMinor: formatService.decimalStringToMinor(event.target.value)
        })}
        onBlur={() => onChange((current) => current ? {
          ...current,
          amountInput: formatService.minorToDecimalString(current.amountMinor ?? 0)
        } : current)}
      />
    </label>
  );
  const withAmountAction = (node) => (amountAction ? <span className="split-lead-amount">{node}{amountAction}</span> : node);

  return (
    <div className={`split-expense-card split-settlement-card is-${layout}`}>
      <div className="split-expense-card-lead">
        <LeadCard
          className="split-expense-lead"
          category={{ colorHex: GROUP_BUBBLE_COLOUR, icon: ArrowRightLeft }}
          title={title}
          subtitle={selectedGroup?.name ?? ""}
          tone="neutral"
          editable={!readOnly}
          amount={readOnly ? withAmountAction(formatService.moneyWithCurrency(Number(dialog?.amountMinor ?? 0), currency)) : withAmountAction(amountField)}
          chips={[
            <MetaChip
              key="date"
              data-chip="date"
              icon={CalendarDays}
              control={readOnly ? null : (
                <ChipDateField
                  value={dialog?.date ?? ""}
                  label={messages.common.changeChip(copy.settlementDate, formatCardDate(dialog?.date, today))}
                  onValueChange={(date) => update({ date })}
                />
              )}
            >
              {formatCardDate(dialog?.date, today)}
            </MetaChip>,
            <MetaChip
              key="payment"
              data-chip="paymentMethod"
              icon={PaymentIcon}
              locked={isLinked}
              lockedLabel={cardCopy.paymentLockedByLedger}
            >
              {paymentLabel}
            </MetaChip>
          ]}
        />
      </div>
      <DetailRows label="Settlement details" className="split-expense-rows">
        {mainRows}
        {linkedEntryRow}
        {otherRows}
      </DetailRows>
    </div>
  );
}
