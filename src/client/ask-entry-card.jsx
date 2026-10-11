import { ArrowLeftRight, CalendarDays, Check, ChevronRight, CreditCard, Sparkles } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { describeTransfer, getTransferEnds, isCardEmpty, resolveShareGroupId, SHARED_OWNER } from "./ask-card-model";
import { askCopy, formatCardDate } from "./copy/ask-copy";
import { entryAmountTone } from "../domain/money-tone";
import { moneyWithCurrency } from "./formatters";
import { PrivateMoney } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { getPersonColourVars } from "./person-colour";
import { ResponsiveSelect } from "./responsive-select";
import { getIconComponent } from "./ui-components";
import { useIsMobileLayout } from "./use-viewport";

// The Ask page's entry card (design.md "Ask page"): the hero card with the
// category bubble, what it was, the amount and its date, wallet and person
// chips, then the quiet detail rows, each opening the app's existing picker,
// and the Splits switch. A saved card keeps the hero only, marked Saved.

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

export function AskEntryCard({
  card,
  context,
  today,
  descriptionRef,
  amountRef,
  onChange
}) {
  const isSaved = card.status === "saved";
  const isEditable = card.status === "draft";
  const category = categoryOf(context, card.fields.categoryName);
  const isTransfer = card.variant === "transfer";
  const bubbleColour = isTransfer ? TRANSFER_BUBBLE_COLOUR : category?.colorHex ?? TRANSFER_BUBBLE_COLOUR;
  const BubbleIcon = isTransfer ? ArrowLeftRight : category ? getIconComponent(category.iconKey) : CreditCard;
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
  const ownerVars = getPersonColourVars(card.fields.ownerName === SHARED_OWNER ? "shared" : card.fields.ownerName);

  return (
    <section className={`ask-card${isSaved ? " is-saved" : ""}`} aria-label={isSaved ? askCopy.card.savedTo : askCopy.card.label} data-ask-card={card.status}>
      {tag ? (
        <span className={`ask-card-tag ${tag.className}`}>
          {tag.icon}
          {tag.label}
        </span>
      ) : null}
      <div className="ask-card-hero">
        <span className="ask-card-bubble" style={{ "--cat": bubbleColour }} aria-hidden="true">
          <BubbleIcon size={26} strokeWidth={2} />
        </span>
        <div className="ask-card-title">
          {isTransfer ? (
            <strong className="ask-card-merchant">{askCopy.card.transferTitle(from.accountName, to.accountName)}</strong>
          ) : isEditable ? (
            <GrowingTextField
              inputRef={descriptionRef}
              className="ask-card-merchant ask-card-merchant-input"
              aria-label={askCopy.card.descriptionLabel}
              placeholder={askCopy.card.whatWasIt}
              value={card.fields.description}
              onChange={(value) => onChange({ description: value })}
            />
          ) : (
            <strong className="ask-card-merchant">{card.fields.description}</strong>
          )}
          <span className="ask-card-category" style={{ "--cat": bubbleColour }}>
            {isTransfer ? askCopy.card.transfer : card.fields.categoryName}
          </span>
        </div>
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
      </div>
      <div className="ask-card-meta">
        <span className="ask-meta-chip">
          <CalendarDays size={14} aria-hidden="true" />
          {formatCardDate(card.fields.date, today)}
        </span>
        {!isTransfer && card.fields.accountName ? (
          <span className="ask-meta-chip">
            <CreditCard size={14} aria-hidden="true" />
            {card.fields.accountName}
          </span>
        ) : null}
        {card.fields.ownerName ? (
          <span className="ask-meta-chip ask-meta-person" style={ownerVars}>
            {card.fields.ownerName}
          </span>
        ) : null}
      </div>
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
    </section>
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

// One quiet detail row that opens the app's own picker: the mobile picker
// sheet on a phone, a native select over the row on a desktop.
function PickerRow({ label, valueLabel, filled, title, value, options, onValueChange, open, onOpenChange, rowKey }) {
  const isMobile = useIsMobileLayout();
  const content = (
    <>
      <span className="ask-row-label">{label}</span>
      <span className="ask-row-value">
        <FilledDot filled={filled} />
        <span className="ask-row-text">{valueLabel}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </span>
    </>
  );
  if (isMobile) {
    return (
      <>
        <button type="button" className="ask-row" data-ask-row={rowKey} aria-haspopup="dialog" onClick={() => onOpenChange(true)}>
          {content}
        </button>
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
    <label className="ask-row" data-ask-row={rowKey}>
      {content}
      <select className="ask-row-native" aria-label={label} value={value} onChange={(event) => onValueChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function DateRow({ label, value, valueLabel, filled, onChange, rowKey }) {
  return (
    <label className="ask-row" data-ask-row={rowKey}>
      <span className="ask-row-label">{label}</span>
      <span className="ask-row-value">
        <FilledDot filled={filled} />
        <span className="ask-row-text">{valueLabel}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </span>
      <input
        className="ask-row-native"
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
    </label>
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
      <div className="ask-rows" role="group" aria-label={askCopy.card.moreDetails}>
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
        <button type="button" className="ask-row ask-row-more" aria-expanded={moreOpen} onClick={onToggleMore}>
          <span className="ask-row-label">{moreOpen ? askCopy.card.fewerDetails : askCopy.card.moreDetails}</span>
          <span className="ask-row-value">
            {moreOpen ? null : <span className="ask-row-hint">{askCopy.card.moreDetailsHint}</span>}
            <ChevronRight size={16} aria-hidden="true" className={moreOpen ? "is-open" : ""} />
          </span>
        </button>
        {moreOpen ? (
          <>
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
            <label className="ask-row ask-row-note">
              <span className="ask-row-label">{askCopy.card.rows.note}</span>
              <textarea
                ref={noteRef}
                className="ask-row-note-input"
                rows={1}
                placeholder={askCopy.card.notePlaceholder}
                value={card.fields.note}
                onChange={(event) => onChange({ note: event.target.value })}
              />
            </label>
          </>
        ) : null}
      </div>
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
        <div className="ask-rows ask-rows-share">
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
        </div>
      ) : null}
    </div>
  );
}

export { describeTransfer, partnerName };
