import { ArrowLeftRight, CalendarDays, Check, CreditCard, Lock, Nfc, Sparkles } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { describeTransfer, getTransferEnds, isCardEmpty, resolveShareGroupId, SHARED_OWNER } from "./ask-card-model";
import { askCopy, formatCardDate, formatCardDateTime } from "./copy/ask-copy";
import { entryAmountTone } from "../domain/money-tone";
import { bankStateChipLabel } from "./entry-source";
import { moneyWithCurrency } from "./formatters";
import { PrivateMoney } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { CategoryPickerHost } from "./category-picker-host";
import { ResponsiveSelect } from "./responsive-select";
import { getIconComponent } from "./ui-components";
import { messages } from "./copy/en-SG";
import { ChipDateField, DetailRow, DetailRows, LeadCard, MetaChip, MoreDetails } from "./ui/lead-support-detail";
import { useIsMobileLayout } from "./use-viewport";
import { paletteColour } from "./palette-colour";
import { LimitHint } from "./limit-hint";
import { ENTRY_DESCRIPTION_MAX, ENTRY_NOTE_MAX } from "./input-limits";
import { limitsCopy } from "./copy/limits-copy";

// The Ask page's entry card (design.md "Ask page"): the hero card with the
// category bubble, what it was, the amount and its date, wallet and person
// chips (on a draft, each opens its row's picker: date, wallet, owner), then
// the quiet detail rows, each opening the app's existing picker, and the
// Splits switch. A saved card keeps the hero only, marked Saved.
// Built on the shared Lead · Support · Detail blocks (ui/lead-support-detail).

const SIGNS = { expense: "−", income: "+", transfer: "" };
const TRANSFER_BUBBLE_COLOUR = "#7C8791";

function currencyOf(context, accountId) {
  return context.accounts?.find((account) => account.id === accountId)?.currency ?? "SGD";
}

function categoryOf(context, name) {
  return context.categories?.find((category) => category.name === name) ?? null;
}

// The amount's money tone (design.md "Money colour"): rose for an expense,
// mint for income, plain ink for a transfer, nothing until there is one.
export function cardAmountToneClass(card) {
  if (!(card.fields.amountMinor > 0)) {
    return "money-neutral";
  }
  const signed = card.variant === "income" ? card.fields.amountMinor : -card.fields.amountMinor;
  return moneyToneClass(entryAmountTone(card.variant, signed));
}

function partnerName(context, ownerName) {
  const people = context.people ?? [];
  const other = ownerName === SHARED_OWNER ? people[1] : people.find((person) => person.name !== ownerName);
  return other?.name ?? "";
}

const SAVED_STATE_TONES = { statement_certified: "mint", import_provisional: "sky", manual_provisional: "butter" };
const SAVED_STATE_LABELS = { statement_certified: "Statement certified", import_provisional: "Import provisional", manual_provisional: "Manual provisional" };

// A saved card's bank state chip, as on the Edit entry card: the tool that
// saved a provisional entry ("Ask · provisional", "Apple Pay · provisional"),
// else its bank state. A card Ask saved before the chip existed is Ask's.
export function savedCardState(card) {
  if (card?.status !== "saved") {
    return null;
  }
  const saved = card.saved ?? {};
  const status = saved.bankCertificationStatus ?? (card.origin === "saved" ? null : "manual_provisional");
  if (!status) {
    return null;
  }
  const addedBy = saved.addedBy ?? (card.origin === "saved" ? undefined : "ask");
  return {
    label: bankStateChipLabel({ addedBy, bankCertificationStatus: status }, saved.bankCertificationLabel || SAVED_STATE_LABELS[status] || ""),
    tone: SAVED_STATE_TONES[status],
    locked: status === "statement_certified"
  };
}

export function AskEntryCard({
  settled = false,
  card,
  context,
  today,
  descriptionRef,
  amountRef,
  onChange,
  onOpenField = undefined,
  walletChipRef = undefined
}) {
  const isSaved = card.status === "saved";
  const isEditable = card.status === "draft";
  const category = categoryOf(context, card.fields.categoryName);
  const isTransfer = card.variant === "transfer";
  const bubbleColour = isTransfer ? TRANSFER_BUBBLE_COLOUR : category?.colorHex ?? TRANSFER_BUBBLE_COLOUR;
  const bubble = isTransfer
    ? { colorHex: TRANSFER_BUBBLE_COLOUR, icon: ArrowLeftRight }
    : category ? { colorHex: category.colorHex, icon: getIconComponent(category.iconKey) } : { colorHex: TRANSFER_BUBBLE_COLOUR, icon: CreditCard };
  const currency = currencyOf(context, card.fields.accountId);
  const { from, to } = getTransferEnds(card);
  const toneClass = cardAmountToneClass(card);
  const sign = card.fields.amountMinor > 0 ? SIGNS[card.variant] : "";
  const [amountFocused, setAmountFocused] = useState(false);
  const amountId = useId();
  const tag = isSaved
    ? { className: "is-saved", icon: <Check size={13} aria-hidden="true" />, label: askCopy.card.saved }
    : card.origin === "message"
      ? { className: "is-filled", icon: <Sparkles size={13} aria-hidden="true" />, label: askCopy.card.filledFromMessage }
      : card.origin === "receipt"
        ? { className: "is-filled", icon: <Sparkles size={13} aria-hidden="true" />, label: askCopy.card.readFromReceipt }
        : null;
  const ownerKey = card.fields.ownerName === SHARED_OWNER ? "shared" : card.fields.ownerName;
  const savedState = savedCardState(card);
  const isApplePayCard = card.saved?.addedBy === "apple_pay_shortcut";
  const walletIcon = isApplePayCard ? Nfc : CreditCard;

  const title = isTransfer ? (
    <strong className="lsd-title ask-card-merchant">{askCopy.card.transferTitle(from.accountName, to.accountName)}</strong>
  ) : isEditable ? (
    <>
      <GrowingTextField
        inputRef={descriptionRef}
        className="lsd-title ask-card-merchant ask-card-merchant-input"
        aria-label={askCopy.card.descriptionLabel}
        placeholder={askCopy.card.whatWasIt}
        value={card.fields.description}
        onChange={(value) => onChange({ description: value })}
      />
      <LimitHint size={card.fields.description.length} max={ENTRY_DESCRIPTION_MAX} over={limitsCopy.descriptionTooLong} />
    </>
  ) : (
    <strong className="lsd-title ask-card-merchant">{card.fields.description}</strong>
  );

  const amount = (
    <div className={`ask-card-amount ${toneClass}`}>
      {isEditable ? (
        <label htmlFor={amountId} className={`ask-card-amount-field${card.fields.amountMinor > 0 ? "" : " is-empty"}`}>
          <span className="ask-sr-only">{askCopy.card.amountLabel}</span>
          <span className="ask-card-amount-prefix" aria-hidden="true">{sign}{currency === "SGD" ? "$" : `${currency} `}</span>
          <input
            id={amountId}
            ref={amountRef}
            className="ask-card-amount-input"
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
            style={{ width: `${Math.max(3, (amountFocused ? card.fields.amountInput : formatAmountForDisplay(card.fields.amountInput) || "0.00").length) + 0.4}ch` }}
            value={amountFocused ? card.fields.amountInput : formatAmountForDisplay(card.fields.amountInput)}
            onFocus={() => setAmountFocused(true)}
            onBlur={() => setAmountFocused(false)}
            onChange={(event) => onChange({ amountInput: event.target.value.replace(/[^0-9.,]/g, "") })}
          />
        </label>
      ) : (
        <strong>
          <PrivateMoney>{`${sign}${moneyWithCurrency(card.fields.amountMinor, currency)}`}</PrivateMoney>
        </strong>
      )}
    </div>
  );

  return (
    <LeadCard
      className={`ask-card${isSaved ? " is-saved" : ""}${settled ? " is-settled" : ""}`}
      data-source={isApplePayCard ? "apple-pay" : undefined}
      aria-label={isSaved ? askCopy.card.savedTo : askCopy.card.label}
      data-ask-card={card.status}
      category={bubble}
      title={title}
      subtitle={<span className="ask-card-category" style={{ "--cat": paletteColour(bubbleColour) }}>{isTransfer ? askCopy.card.transfer : card.fields.categoryName}</span>}
      amount={amount}
      tag={tag ? (
        <span className={`ask-card-tag ${tag.className}`}>
          {isApplePayCard ? <Nfc size={13} aria-hidden="true" data-apple-pay-mark /> : tag.icon}
          {tag.label}
        </span>
      ) : null}
      chips={(
        <>
          <MetaChip
            data-chip="date"
            icon={CalendarDays}
            control={isEditable ? (
              <ChipDateField
                value={card.fields.date}
                label={messages.common.changeChip(askCopy.card.rows.date, formatCardDateTime(card.fields.date, today, card.saved?.time))}
                onValueChange={(date) => onChange({ date })}
              />
            ) : null}
          >
            {/* A saved card shows the time the entry was saved with. */}
            {formatCardDateTime(card.fields.date, today, card.saved?.time)}
          </MetaChip>
          {!isTransfer && card.fields.accountName ? (
            <span ref={walletChipRef}>
              <MetaChip
                data-chip="wallet"
                icon={walletIcon}
                actionLabel={messages.common.changeChip(askCopy.card.rows.wallet, card.fields.accountName)}
                onClick={onOpenField ? () => onOpenField("wallet") : undefined}
              >
                {card.fields.accountName}
              </MetaChip>
            </span>
          ) : null}
          {card.fields.ownerName ? (
            <MetaChip
              data-chip="owner"
              person={ownerKey}
              actionLabel={messages.common.changeChip(askCopy.card.rows.owner, card.fields.ownerName)}
              onClick={isEditable && onOpenField ? () => onOpenField("owner") : undefined}
            >
              {card.fields.ownerName}
            </MetaChip>
          ) : null}
          {savedState ? (
            <MetaChip data-chip="state" icon={savedState.locked ? Lock : null} tone={savedState.tone}>{savedState.label}</MetaChip>
          ) : null}
        </>
      )}
    >
      {isSaved && card.saved?.splitExpenseId ? (
        <p className="ask-card-saved-line">{askCopy.card.savedOnSplits(card.saved.splitGroupName ?? "")}</p>
      ) : null}
      {isEditable && isCardEmpty(card) ? (
        <p className="ask-card-coax">
          {askCopy.card.coaxBefore}
          <strong>{askCopy.card.coaxExample}</strong>
          {askCopy.card.coaxAfter}
        </p>
      ) : null}
    </LeadCard>
  );
}

// What it was, in the card's own type: a one-line field that wraps onto
// a second line for a long shop name instead of cutting it off.
function GrowingTextField({ inputRef, value, onChange, className, placeholder, ...rest }) {
  const ownRef = useRef(null);
  useLayoutEffect(() => {
    const field = ownRef.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    }
  }, [value]);
  return (
    <textarea
      {...rest}
      ref={(node) => {
        ownRef.current = node;
        if (inputRef) {
          inputRef.current = node;
        }
      }}
      className={className}
      rows={1}
      placeholder={placeholder}
      value={value}
      autoComplete="off"
      enterKeyHint="done"
      onKeyDown={(event) => {
        // One line of meaning: Enter finishes it rather than adding a break.
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onChange={(event) => onChange(event.target.value.replace(/\s*\n+\s*/g, " "))}
    />
  );
}

// "12.5" shows as "12.50" once the field is left; typing keeps what was typed.
function formatAmountForDisplay(value) {
  const text = String(value ?? "").replace(/,/g, "");
  if (!text) {
    return "";
  }
  const number = Number(text);
  return Number.isFinite(number)
    ? number.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value;
}

function FilledDot({ filled }) {
  return filled ? (
    <span className="ask-row-dot">
      <span className="ask-sr-only">{`, ${askCopy.card.filledDot}`}</span>
    </span>
  ) : null;
}

function rowValue(valueLabel, filled) {
  return (
    <>
      <FilledDot filled={filled} />
      <span className="lsd-row-text">{valueLabel}</span>
    </>
  );
}

// One quiet detail row that opens the app's own picker: the mobile picker
// sheet on a phone, a native select over the row on a desktop.
function PickerRow({ label, valueLabel, filled, title, value, options, onValueChange, open, onOpenChange, rowKey, categoryPick = undefined }) {
  const isMobile = useIsMobileLayout();
  const rowRef = useRef(null);
  const buttonRef = useMemo(() => ({ get current() { return rowRef.current?.querySelector("button") ?? null; } }), []);
  // A category row opens the shared category list (search, best guess first).
  if (categoryPick) {
    // The wrapper has no box of its own, so the popover anchors to the row's button.
    return (
      <>
        <span className="lsd-row-group" ref={rowRef}>
          <DetailRow label={label} value={rowValue(valueLabel, filled)} data-ask-row={rowKey} aria-haspopup="dialog" aria-expanded={open} onClick={() => onOpenChange(true)} />
        </span>
        <CategoryPickerHost
          open={open}
          onOpenChange={onOpenChange}
          anchorRef={buttonRef}
          returnFocusRef={buttonRef}
          title={title}
          options={options}
          value={value}
          pinned={categoryPick.pinned}
          description={categoryPick.description}
          onChoose={onValueChange}
        />
      </>
    );
  }
  if (isMobile) {
    return (
      <>
        <DetailRow label={label} value={rowValue(valueLabel, filled)} data-ask-row={rowKey} aria-haspopup="dialog" onClick={() => onOpenChange(true)} />
        <ResponsiveSelect
          hideMobileTrigger
          title={title}
          value={value}
          options={options}
          open={open}
          onOpenChange={onOpenChange}
          onValueChange={(next) => {
            onValueChange(next);
            onOpenChange(false);
          }}
        />
      </>
    );
  }
  return (
    <DetailRow label={label} value={rowValue(valueLabel, filled)} data-ask-row={rowKey}>
      <select className="lsd-row-native" aria-label={label} value={value} onChange={(event) => onValueChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </DetailRow>
  );
}

function DateRow({ label, value, valueLabel, filled, onChange, rowKey }) {
  return (
    <DetailRow label={label} value={rowValue(valueLabel, filled)} data-ask-row={rowKey}>
      <input
        className="lsd-row-native"
        type="date"
        aria-label={label}
        value={value}
        onClick={(event) => {
          try {
            event.currentTarget.showPicker?.();
          } catch {
            // Some browsers only open the picker from the field itself.
          }
        }}
        onChange={(event) => onChange(event.target.value)}
      />
    </DetailRow>
  );
}

const SPLIT_SHARE_OPTIONS = [90, 80, 70, 60, 50, 40, 30, 20, 10];

// The detail rows under the hero card while it is a draft.
export function AskCardRows({
  card,
  context,
  today,
  splitGroups,
  moreOpen,
  onToggleMore,
  openPicker,
  onOpenPickerChange,
  noteRef,
  onChange,
  onVariantChange,
  onShareChange
}) {
  const [pickerOpen, setPickerOpen] = useState("");
  const activePicker = openPicker ?? pickerOpen;
  const setActivePicker = onOpenPickerChange ?? setPickerOpen;
  const pickerProps = (key) => ({
    rowKey: key,
    open: activePicker === key,
    onOpenChange: (open) => setActivePicker(open ? key : "")
  });
  const accounts = (context.accounts ?? []).filter((account) => account.isActive !== false);
  const accountOptions = accounts.map((account) => ({ value: account.id, label: account.ownerLabel ? `${account.name} - ${account.ownerLabel}` : account.name }));
  const categoryOptions = (context.categories ?? [])
    .filter((category) => category.name !== "Transfer")
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((category) => ({ value: category.name, label: category.name, icon: null }));
  const ownerOptions = [
    ...(context.people ?? []).map((person) => ({ value: person.name, label: person.name })),
    ...((context.people ?? []).length > 1 ? [{ value: SHARED_OWNER, label: askCopy.card.sharedOwner }] : [])
  ];
  const typeOptions = ["expense", "income", "transfer"].map((value) => ({ value, label: askCopy.card.types[value] }));
  const { from, to } = getTransferEnds(card);
  const isTransfer = card.variant === "transfer";
  const filled = card.filled;
  const dateLabel = formatCardDate(card.fields.date, today, { withYear: true });
  const partner = partnerName(context, card.fields.ownerName);
  const shareGroups = splitGroups ?? [];
  const resolvedGroupId = resolveShareGroupId(card, shareGroups);
  const resolvedGroup = shareGroups.find((group) => group.id === resolvedGroupId);
  const showShare = card.variant === "expense" && (context.people ?? []).length > 1;
  const switchId = useId();

  const dateRow = (
    <DateRow
      rowKey="date"
      label={askCopy.card.rows.date}
      value={card.fields.date}
      valueLabel={dateLabel}
      filled={Boolean(filled.date)}
      onChange={(date) => onChange({ date })}
    />
  );

  return (
    <div className="ask-rows-wrap">
      <DetailRows label={askCopy.card.moreDetails}>
        {isTransfer ? (
          <>
            <PickerRow
              {...pickerProps("from")}
              label={askCopy.card.rows.from}
              title={askCopy.card.rows.from}
              valueLabel={from.accountName || askCopy.card.chooseWallet}
              filled={Boolean(card.fields.transferDirection === "in" ? filled.transferAccountId : filled.accountId)}
              value={from.accountId || ""}
              options={card.fields.transferDirection === "in" ? [{ value: "", label: askCopy.card.notSet }, ...accountOptions] : accountOptions}
              onValueChange={(accountId) => onChange(card.fields.transferDirection === "in" ? { transferAccountId: accountId } : { accountId })}
            />
            <PickerRow
              {...pickerProps("to")}
              label={askCopy.card.rows.to}
              title={askCopy.card.rows.to}
              valueLabel={to.accountName || askCopy.card.chooseWallet}
              filled={Boolean(card.fields.transferDirection === "in" ? filled.accountId : filled.transferAccountId)}
              value={to.accountId || ""}
              options={card.fields.transferDirection === "in" ? accountOptions : [{ value: "", label: askCopy.card.notSet }, ...accountOptions]}
              onValueChange={(accountId) => onChange(card.fields.transferDirection === "in" ? { accountId } : { transferAccountId: accountId })}
            />
            {dateRow}
          </>
        ) : (
          <>
            {dateRow}
            <PickerRow
              {...pickerProps("category")}
              label={askCopy.card.rows.category}
              title={askCopy.card.rows.category}
              valueLabel={card.fields.categoryName || askCopy.card.notSet}
              filled={Boolean(filled.categoryName)}
              value={card.fields.categoryName}
              options={categoryOptions}
              categoryPick={{ description: card.fields.description }}
              onValueChange={(categoryName) => onChange({ categoryName })}
            />
            <PickerRow
              {...pickerProps("wallet")}
              label={askCopy.card.rows.wallet}
              title={askCopy.card.rows.wallet}
              valueLabel={card.fields.accountName || askCopy.card.chooseWallet}
              filled={Boolean(filled.accountId)}
              value={card.fields.accountId}
              options={accountOptions}
              onValueChange={(accountId) => onChange({ accountId })}
            />
          </>
        )}
        <PickerRow
          {...pickerProps("type")}
          label={askCopy.card.rows.type}
          title={askCopy.card.rows.type}
          valueLabel={askCopy.card.types[card.variant]}
          filled={Boolean(filled.variant)}
          value={card.variant}
          options={typeOptions}
          onValueChange={onVariantChange}
        />
        <MoreDetails
          open={moreOpen}
          onOpenChange={() => onToggleMore()}
          label={askCopy.card.moreDetails}
          openLabel={askCopy.card.fewerDetails}
          summary={askCopy.card.moreDetailsHint}
        >
          <DateRow
            rowKey="postDate"
            label={askCopy.card.rows.postDate}
            value={card.fields.postDate}
            valueLabel={card.fields.postDate ? formatCardDate(card.fields.postDate, today, { withYear: true }) : askCopy.card.notSet}
            filled={false}
            onChange={(postDate) => onChange({ postDate })}
          />
          <PickerRow
            {...pickerProps("owner")}
            label={askCopy.card.rows.owner}
            title={askCopy.card.rows.owner}
            valueLabel={card.fields.ownerName || askCopy.card.notSet}
            filled={Boolean(filled.ownerName)}
            value={card.fields.ownerName}
            options={ownerOptions}
            onValueChange={(ownerName) => onChange({ ownerName })}
          />
          {card.fields.ownerName === SHARED_OWNER ? (
            <PickerRow
              {...pickerProps("share")}
              label={askCopy.card.rows.share}
              title={askCopy.card.rows.share}
              valueLabel={askCopy.shareOption(context.people?.[0]?.name ?? "", card.fields.splitBasisPoints / 100)}
              filled={Boolean(filled.splitBasisPoints)}
              value={String(card.fields.splitBasisPoints / 100)}
              options={SPLIT_SHARE_OPTIONS.map((percent) => ({ value: String(percent), label: askCopy.shareOption(context.people?.[0]?.name ?? "", percent) }))}
              onValueChange={(percent) => onChange({ splitBasisPoints: Number(percent) * 100 })}
            />
          ) : null}
          <DetailRow label={askCopy.card.rows.note} className="lsd-row-note">
            <textarea
              ref={noteRef}
              className="lsd-row-input"
              rows={1}
              placeholder={askCopy.card.notePlaceholder}
              value={card.fields.note}
              onChange={(event) => onChange({ note: event.target.value })}
            />
            <LimitHint size={card.fields.note.length} max={ENTRY_NOTE_MAX} over={limitsCopy.noteTooLong} />
          </DetailRow>
        </MoreDetails>
      </DetailRows>
      {showShare ? (
        <div className="ask-share">
          <div className="ask-share-copy">
            <label htmlFor={switchId}>{partner ? askCopy.card.shareTitle(partner) : askCopy.card.shareTitleFallback}</label>
            {card.share.on && resolvedGroup ? <small>{resolvedGroup.name}</small> : null}
          </div>
          <button
            id={switchId}
            type="button"
            role="switch"
            aria-checked={card.share.on}
            className="ask-switch"
            onClick={() => onShareChange({ on: !card.share.on })}
          >
            <span className="ask-sr-only">{partner ? askCopy.card.shareTitle(partner) : askCopy.card.shareTitleFallback}</span>
          </button>
        </div>
      ) : null}
      {showShare && card.share.on && shareGroups.length > 1 ? (
        <DetailRows className="ask-rows-share">
          <PickerRow
            {...pickerProps("splitGroup")}
            label={askCopy.card.rows.splitGroup}
            title={askCopy.card.rows.splitGroup}
            valueLabel={resolvedGroup?.name ?? askCopy.card.chooseGroup}
            filled={false}
            value={resolvedGroupId}
            options={[{ value: "", label: askCopy.card.chooseGroup }, ...shareGroups.map((group) => ({ value: group.id, label: group.name }))]}
            onValueChange={(splitGroupId) => onShareChange({ on: true, splitGroupId })}
          />
        </DetailRows>
      ) : null}
    </div>
  );
}

export { describeTransfer, partnerName };
