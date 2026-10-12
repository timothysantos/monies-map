import "./lead-support-detail.css";
import { ChevronDown, ChevronRight, Lock, Receipt } from "lucide-react";
import { useState } from "react";

import { spendTone } from "../../domain/money-tone";
import { PrivateMoney, useMoneyPrivacy } from "../money-privacy";
import { moneyToneClass } from "../money-tone-class";
import { getPersonColourVars } from "../person-colour";
import { ICON_REGISTRY } from "../ui-options";

// Lead · Support · Detail (design.md): each sheet or screen top has one thing
// you look at first (the Lead card), a few facts that explain it (Support
// chips inside the card) and quiet rows you tap to change things (Detail
// rows), with the main action in a bar at the bottom where the thumb is.
// - LeadCard: a head line (category bubble, title, sub-label, the amount on
//   the right) or, without a title, an eyebrow over a big figure (the
//   Summary lead); optionally the actual-vs-plan bar and the Support chips.
// - MetaChip: one Support pill (a date, a wallet, a person in their colour,
//   a state in its pastel pair). A chip for a field you can change opens
//   that field's own picker, the one its Detail row opens.
// - DetailRows / DetailRow: the quiet rows you tap to change a field.
// - MoreDetails: the folding row that names what it holds.
// - BottomActions: the action bar, primary action last (under the thumb).
// These blocks hold only layout and the money-privacy rules for the lead;
// callers pass the copy, the controls and every handler.
//
// Bundle: ui-components.jsx re-exports the blocks so they share its chunk
// (the Summary lead is on the first screen, and check:bundle counts files),
// and this module imports its own stylesheet so every caller gets it.

const NEUTRAL_BUBBLE = "#7C8791";
const STATE_TONES = new Set(["mint", "rose", "sky", "butter", "lavender"]);

function joinClasses(...names) {
  return names.filter(Boolean).join(" ");
}

function isBlank(value) {
  return value === null || value === undefined || value === "" || value === false;
}

// How full the actual-vs-plan bar is (capped at 100) and whether it shows
// over plan: rose only past the plan (spendTone), so spending with no plan is
// over. `overIsShort: false` is for a figure where more is fine (income).
export function leadProgress(valueMinor, planMinor, { overIsShort = true } = {}) {
  const percent = planMinor > 0
    ? Math.min(100, Math.round((valueMinor / planMinor) * 100))
    : valueMinor > 0 ? 100 : 0;
  return { percent, isOver: overIsShort && spendTone(valueMinor, planMinor) === "short" };
}

/**
 * The one white card with the strong shadow.
 * - With a `title` it reads as a head line: the bubble (`bubble`, or one
 *   built from `category`: its colour and icon, else a neutral one), the
 *   title (a string becomes the strong title; a node, such as an inline
 *   field, is used as given), `subtitle` in the category colour, and the
 *   amount on the right with an optional `amountCaption` under it.
 * - Without one, `eyebrow` stacks over the amount and its `amountAside`.
 * A string `amount` goes through money privacy; `tone` gives the amount its
 * money tone; `editable` marks an amount the person types (a thin
 * terracotta underline; with a caption the column is a <label>, so a tap on
 * either opens the keypad). `progress` ({ valueMinor, planMinor,
 * overIsShort }) draws the actual-vs-plan bar; hidden money keeps only its
 * empty track (its length would say over or under plan) and swaps the line
 * under it for `hiddenProgressStart`. `tag` sits above the head line, then
 * the chips, then `children`.
 * @param {{
 *   className?: string, tag?: any, eyebrow?: any,
 *   category?: { colorHex?: string, iconKey?: string, icon?: any, bubble?: any } | null,
 *   bubble?: any, accentColor?: string, title?: any, subtitle?: any,
 *   amount?: any, tone?: string, amountAside?: any, amountCaption?: any, editable?: boolean,
 *   progress?: { valueMinor: number, planMinor: number, overIsShort?: boolean } | null,
 *   progressStart?: any, progressEnd?: any, hiddenProgressStart?: any,
 *   chips?: any, children?: any, [key: string]: any
 * }} props
 */
export function LeadCard({
  className = "",
  tag = null,
  eyebrow = null,
  category = null,
  bubble = null,
  accentColor = undefined,
  title = null,
  subtitle = null,
  amount = null,
  tone = undefined,
  amountAside = null,
  amountCaption = null,
  editable = false,
  progress = null,
  progressStart = null,
  progressEnd = null,
  hiddenProgressStart = null,
  chips = null,
  children = null,
  ...rest
}) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const colour = accentColor ?? category?.colorHex ?? NEUTRAL_BUBBLE;
  const hasChips = Array.isArray(chips) ? chips.some(Boolean) : Boolean(chips);
  const bar = progress ? leadProgress(progress.valueMinor, progress.planMinor, progress) : null;
  const lineStart = areTotalsVisible ? progressStart : hiddenProgressStart;
  const lineEnd = areTotalsVisible ? progressEnd : null;

  const amountNode = isBlank(amount) ? null : (
    <span className={joinClasses("lsd-amount", tone ? moneyToneClass(tone) : "", editable ? "is-editable" : "")}>
      {typeof amount === "string" ? <PrivateMoney>{amount}</PrivateMoney> : amount}
    </span>
  );
  const AmountColumn = editable ? "label" : "span";

  return (
    <section className={joinClasses("lsd-card", className)} {...rest}>
      {tag}
      {eyebrow ? <span className="lsd-eyebrow">{eyebrow}</span> : null}
      {title ? (
        <div className="lsd-hero">
          <LeadBubble bubble={bubble ?? category?.bubble ?? null} category={category} colour={colour} />
          <div className="lsd-heading">
            {typeof title === "string" ? <strong className="lsd-title">{title}</strong> : title}
            {subtitle ? <span className="lsd-subtitle" style={{ "--cat": colour }}>{subtitle}</span> : null}
          </div>
          {amountNode && amountCaption ? (
            <AmountColumn className="lsd-amount-column">
              {amountNode}
              <small className="lsd-amount-caption">{amountCaption}</small>
            </AmountColumn>
          ) : amountNode}
        </div>
      ) : amountNode ? (
        <div className="lsd-figure">
          {amountNode}
          {amountAside ? <span className="lsd-amount-aside">{amountAside}</span> : null}
        </div>
      ) : null}
      {bar ? (
        <div className="lsd-progress">
          <span className="lsd-bar" aria-hidden="true">
            {areTotalsVisible ? (
              <span
                className={`lsd-bar-fill ${moneyToneClass(bar.isOver ? "short" : "neutral")}`}
                style={{ width: `${bar.percent}%` }}
              />
            ) : null}
          </span>
          {lineStart || lineEnd ? (
            <div className="lsd-progress-line">
              {lineStart ? <span>{lineStart}</span> : null}
              {lineEnd ? <span>{lineEnd}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {hasChips ? <div className="lsd-chips">{chips}</div> : null}
      {children}
    </section>
  );
}

// The lead's bubble: a caller's own (a category appearance popover) in a
// slot, else the category's colour and icon, else a neutral one.
function LeadBubble({ bubble, category, colour }) {
  if (bubble) {
    return <span className="lsd-bubble-slot">{bubble}</span>;
  }
  const Icon = category?.icon ?? (category?.iconKey ? ICON_REGISTRY[category.iconKey] ?? Receipt : null);
  return (
    <span className="lsd-bubble" style={{ "--cat": colour }} aria-hidden="true">
      {Icon ? <Icon size={26} strokeWidth={2} /> : null}
    </span>
  );
}

/**
 * A Support chip: context you read but rarely change. `person` gives the
 * person's chip in their colour (person-colour.js, never a new hue); `tone`
 * a status in its pastel pair (an unknown tone is ignored); `icon` a 14px
 * lucide icon.
 *
 * A chip for a field you can change is tappable (design.md, "Tappable
 * chips"): `onClick` makes it a button that opens the field's own picker
 * (the one its Detail row opens), or `control` lays the field itself over
 * the chip (a date field, so a tap opens the phone's date picker). Either
 * way `actionLabel` names it for assistive tech ("Change date, Yesterday"),
 * a small muted chevron marks it, and its hit area is at least 44 x 44 px
 * around the smaller pill. `locked` (a field the statement certified)
 * shows a lock instead and is never tappable; `lockedLabel` is read after
 * the chip's text. A state chip (provisional, certified) is never an editor.
 * Other props (`data-chip`) go on the tappable element, else on the pill.
 * @param {{
 *   icon?: any, person?: string | null, tone?: string, children?: any, className?: string,
 *   onClick?: (event: any) => void, control?: any, actionLabel?: string, locked?: boolean,
 *   lockedLabel?: string, [key: string]: any
 * }} props
 */
export function MetaChip({
  icon: Icon = null,
  person = undefined,
  tone = undefined,
  children = null,
  className = "",
  onClick = undefined,
  control = null,
  actionLabel = undefined,
  locked = false,
  lockedLabel = undefined,
  ...rest
}) {
  const toneClass = tone && STATE_TONES.has(tone) ? `is-${tone}` : "";
  const isTappable = !locked && Boolean(onClick || control);
  const pill = (
    <span
      className={joinClasses("lsd-chip", person ? "is-person" : "", toneClass, isTappable ? "is-tappable" : "", locked ? "is-locked" : "", className)}
      style={person ? getPersonColourVars(person) : undefined}
      {...(isTappable ? {} : rest)}
    >
      {Icon ? <Icon size={14} aria-hidden="true" /> : null}
      {children}
      {locked ? <Lock size={12} aria-hidden="true" className="lsd-chip-lock" /> : null}
      {locked && lockedLabel ? <span className="lsd-sr-only">{`, ${lockedLabel}`}</span> : null}
      {isTappable ? <ChevronDown size={13} aria-hidden="true" className="lsd-chip-chevron" /> : null}
    </span>
  );
  if (!isTappable) {
    return pill;
  }
  if (control) {
    return <span className="lsd-chip-hit has-control" {...rest}>{pill}{control}</span>;
  }
  return (
    <button type="button" className="lsd-chip-hit" aria-label={actionLabel} aria-haspopup="dialog" onClick={onClick} {...rest}>
      {pill}
    </button>
  );
}

/**
 * The date field a tappable date chip lays over itself: a tap opens the
 * phone's date picker (and the browser's on a wide screen).
 * @param {{ value?: string, label: string, onValueChange: (value: string) => void }} props
 */
export function ChipDateField({ value = "", label, onValueChange }) {
  return (
    <input
      className="lsd-chip-native"
      type="date"
      aria-label={label}
      value={value ?? ""}
      onClick={(event) => {
        try {
          event.currentTarget.showPicker?.();
        } catch {
          // Some browsers only open the picker from the field itself.
        }
      }}
      onChange={(event) => {
        if (event.target.value) {
          onValueChange(event.target.value);
        }
      }}
    />
  );
}

/**
 * The select a tappable chip lays over itself, for a chip whose field has no
 * Detail row (the inline card on a wide screen): invisible, it takes the
 * tap and opens the browser's list.
 * @param {{ value?: string, label: string, options: Array<{ value: string, label: string }>, onValueChange: (value: string) => void }} props
 */
export function ChipSelectField({ value = "", label, options, onValueChange }) {
  return (
    <select className="lsd-chip-native" aria-label={label} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

/**
 * One rounded group of Detail rows, named for assistive tech.
 * @param {{ label?: string, children?: any, className?: string }} props
 */
export function DetailRows({ label = undefined, children = null, className = "" }) {
  return (
    <div className={joinClasses("lsd-rows", className)} role="group" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * One Detail row: a muted label on the left, the value on the right with a
 * `›` (or a lock). Three shapes:
 * - with `children` (the field's own control: an inline input, a
 *   ResponsiveSelect, or a native select or date field laid over the row
 *   with `lsd-row-native`): a <label> around it, so the control keeps the
 *   row's name and Tab order stays the field order;
 * - otherwise a button (an action row such as "See the 10 entries");
 * - locked: a plain line with a lock, never clickable;
 * - read-only (`readOnly`): a plain line with no icon, for a fact nobody
 *   changes here (who added an entry).
 * States: `state` "empty" | "action" | "locked", or the `action` and
 * `locked` flags; an empty `value` shows `emptyLabel` muted. `disabled`
 * mutes a button row and drops its `›`. `labelId` names the label so a
 * control that is itself a button (a ResponsiveSelect trigger, which takes
 * `labelId`) can say both the label and its value. `hint` is a muted aside
 * before the `›`.
 * @param {{
 *   label: any, value?: any, emptyLabel?: any, state?: "empty" | "action" | "locked",
 *   action?: boolean, locked?: boolean, readOnly?: boolean, disabled?: boolean, hint?: any, labelId?: string,
 *   onClick?: (event: any) => void, children?: any, className?: string, [key: string]: any
 * }} props
 */
export function DetailRow({
  label,
  value = null,
  emptyLabel = null,
  state = undefined,
  action = false,
  locked = false,
  readOnly = false,
  disabled = false,
  hint = null,
  labelId = undefined,
  onClick = undefined,
  children = null,
  className = "",
  ...rest
}) {
  const isLocked = locked || state === "locked";
  if (readOnly && !isLocked && !children) {
    return (
      <div className={joinClasses("lsd-row is-readonly", className)} {...rest}>
        <span id={labelId} className="lsd-row-label">{label}</span>
        {!isBlank(value) ? (
          <span className="lsd-row-value">{typeof value === "string" ? <span className="lsd-row-text">{value}</span> : value}</span>
        ) : null}
      </div>
    );
  }
  const hasValue = !isBlank(value);
  const isEmpty = state === "empty" || (!hasValue && !isBlank(emptyLabel));
  const isAction = !isLocked && (action || state === "action");
  const shown = hasValue ? value : emptyLabel;
  const Icon = isLocked ? Lock : ChevronRight;
  const valueContent = !isBlank(shown) ? (
    <span className={joinClasses("lsd-row-value", isAction ? "is-action" : "", isEmpty && !isAction ? "is-empty" : "", isLocked ? "is-locked" : "")}>
      {typeof shown === "string" ? <span className="lsd-row-text">{shown}</span> : shown}
      {hint ? <span className="lsd-row-hint">{hint}</span> : null}
      <Icon size={isLocked ? 15 : 16} aria-hidden="true" className={isLocked ? "lsd-row-lock" : "lsd-row-chevron"} />
    </span>
  ) : isLocked ? (
    <span className="lsd-row-value is-locked"><Lock size={15} aria-hidden="true" className="lsd-row-lock" /></span>
  ) : null;
  const content = (
    <>
      <span id={labelId} className="lsd-row-label">{label}</span>
      {valueContent}
    </>
  );
  const states = [isAction ? "is-action" : "", isEmpty && !isAction ? "is-empty" : "", isLocked ? "is-locked" : ""];

  if (children) {
    return (
      <label className={joinClasses("lsd-row has-control", ...states, className)} {...rest}>
        {content}
        {children}
      </label>
    );
  }
  if (isLocked) {
    return <div className={joinClasses("lsd-row", ...states, className)} {...rest}>{content}</div>;
  }
  return (
    <button type="button" className={joinClasses("lsd-row", ...states, className)} disabled={disabled || undefined} onClick={onClick} {...rest}>
      {content}
    </button>
  );
}

/**
 * The folding row for fields most people never change on that screen. It
 * lists what it holds while closed (`summary`), so nothing is hidden without
 * a hint; its rows render under it, inside the same group, only while open.
 * Controlled with `open` and `onOpenChange`, or on its own from
 * `defaultOpen`. `forceOpen` keeps it open: required fields and anything
 * with an error never fold.
 * @param {{
 *   summary?: any, open?: boolean, onOpenChange?: (open: boolean) => void, defaultOpen?: boolean,
 *   forceOpen?: boolean, label?: string, openLabel?: string, children?: any, [key: string]: any
 * }} props
 */
export function MoreDetails({
  summary = null,
  open = undefined,
  onOpenChange = undefined,
  defaultOpen = false,
  forceOpen = false,
  label = "More details",
  openLabel = "Fewer details",
  children = null,
  ...rest
}) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const isOpen = forceOpen || (open ?? ownOpen);
  const toggle = () => {
    if (open === undefined) setOwnOpen(!isOpen);
    onOpenChange?.(!isOpen);
  };
  return (
    <>
      <button
        type="button"
        className={joinClasses("lsd-row lsd-row-more", isOpen ? "is-open" : "")}
        aria-expanded={isOpen}
        disabled={forceOpen || undefined}
        onClick={toggle}
        {...rest}
      >
        <span className="lsd-row-label">{isOpen && !forceOpen ? openLabel : label}</span>
        <span className="lsd-row-value">
          {isOpen || !summary ? null : <span className="lsd-row-hint">{summary}</span>}
          <ChevronRight size={16} aria-hidden="true" className={isOpen ? "is-open" : undefined} />
        </span>
      </button>
      {isOpen ? children : null}
    </>
  );
}

/**
 * The bottom bar: a quiet or destructive action on its own at the start,
 * then the secondary action and the primary action at the end, where the
 * thumb is. Pass ready buttons (`destructive`, `secondary`, `primary`; use
 * the `lsd-quiet`, `lsd-quiet is-danger` and `lsd-primary` classes) or let
 * the bar build them: `primaryLabel` (submits the surrounding form unless
 * `onPrimary` is given) and `quietLabel` with `onQuiet` (`quietTone:
 * "danger"` for Delete). `className="is-sheet-bar"` makes it a sheet's
 * sticky footer inside the safe area.
 * @param {{
 *   primary?: any, secondary?: any, destructive?: any,
 *   primaryLabel?: any, onPrimary?: () => void, primaryDisabled?: boolean,
 *   quietLabel?: any, quietTone?: "danger", quietDisabled?: boolean, onQuiet?: () => void,
 *   className?: string
 * }} props
 */
export function BottomActions({
  primary = null,
  secondary = null,
  destructive = null,
  primaryLabel = null,
  onPrimary = undefined,
  primaryDisabled = false,
  quietLabel = null,
  quietTone = undefined,
  quietDisabled = false,
  onQuiet = undefined,
  className = ""
}) {
  const builtQuiet = quietLabel && onQuiet ? (
    <button
      type="button"
      className={quietTone === "danger" ? "lsd-quiet is-danger" : "lsd-quiet"}
      disabled={quietDisabled}
      onClick={onQuiet}
    >
      {quietLabel}
    </button>
  ) : null;
  const builtPrimary = primaryLabel ? (
    <button
      type={onPrimary ? "button" : "submit"}
      // dialog-primary: the app's primary button, which the sheet's save
      // hooks and browser tests look for.
      className="lsd-primary dialog-primary"
      disabled={primaryDisabled}
      onClick={onPrimary}
    >
      {primaryLabel}
    </button>
  ) : null;
  const start = destructive || builtQuiet ? <>{destructive}{builtQuiet}</> : null;
  return (
    <div className={joinClasses("lsd-bottom", className)}>
      {start ? <div className="lsd-bottom-start">{start}</div> : null}
      <div className="lsd-bottom-end">
        {secondary}
        {primary ?? builtPrimary}
      </div>
    </div>
  );
}
