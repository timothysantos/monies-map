import "./lead-support-detail.css";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { useId, useState } from "react";

import { spendTone } from "../../domain/money-tone";
import { useMoneyPrivacy } from "../money-privacy";
import { moneyToneClass } from "../money-tone-class";
import { getPersonColourVars } from "../person-colour";

// Lead · Support · Detail (design.md): each sheet or screen top has one thing
// you look at first (the Lead card), a few facts that explain it (Support
// chips inside the card) and quiet rows you tap to change things (Detail
// rows), with the main action in a bar at the bottom where the thumb is.
// These blocks hold only layout and the money-privacy rules for the lead;
// callers pass the copy, the controls and every handler.

// How full the actual-vs-plan bar is (capped at 100) and whether it shows
// over plan: rose only past the plan (spendTone), so spending with no plan is
// over. `overIsShort: false` is for a figure where more is fine (income).
export function leadProgress(valueMinor, planMinor, { overIsShort = true } = {}) {
  const percent = planMinor > 0
    ? Math.min(100, Math.round((valueMinor / planMinor) * 100))
    : valueMinor > 0 ? 100 : 0;
  return { percent, isOver: overIsShort && spendTone(valueMinor, planMinor) === "short" };
}

// The one white card with the strong shadow. With a `title` it reads as a
// head line (bubble, title and sub-label, the amount on the right); without
// one the `eyebrow` and the amount stack (the Summary lead). `editable`
// marks an amount the person types (a plan): a thin terracotta underline,
// and the column is a <label>. `progress`
// ({ valueMinor, planMinor, overIsShort }) draws the actual-vs-plan bar.
// Hidden money keeps only the bar's empty track, because its length would
// say over or under plan, and swaps the line under it for
// `hiddenProgressStart` (the side-of-zero words go).
export function LeadCard({
  className = "",
  eyebrow = null,
  bubble = null,
  title = null,
  subtitle = null,
  accentColor = undefined,
  amount = null,
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
  const style = accentColor ? { "--lead-accent": accentColor } : undefined;
  const amountNode = amount === null ? null : (
    <span className={editable ? "lead-card-amount is-editable" : "lead-card-amount"}>{amount}</span>
  );
  const AmountColumn = editable ? "label" : "span";
  const bar = progress ? leadProgress(progress.valueMinor, progress.planMinor, progress) : null;
  const lineStart = areTotalsVisible ? progressStart : hiddenProgressStart;
  const lineEnd = areTotalsVisible ? progressEnd : null;

  return (
    <section className={`lead-card ${className}`.trim()} style={style} {...rest}>
      {eyebrow ? <span className="lead-card-eyebrow">{eyebrow}</span> : null}
      {title ? (
        <div className="lead-card-head">
          {bubble ? <span className="lead-card-bubble">{bubble}</span> : null}
          <span className="lead-card-heading">
            <strong className="lead-card-title">{title}</strong>
            {subtitle ? <span className="lead-card-subtitle">{subtitle}</span> : null}
          </span>
          {amountNode ? (
            // An editable amount is labelled by its caption ("planned"), so
            // a tap on either opens the number keypad.
            <AmountColumn className="lead-card-amount-column">
              {amountNode}
              {amountCaption ? <small className="lead-card-amount-caption">{amountCaption}</small> : null}
            </AmountColumn>
          ) : null}
        </div>
      ) : amountNode ? (
        <div className="lead-card-figure">
          {amountNode}
          {amountAside ? <span className="lead-card-amount-aside">{amountAside}</span> : null}
        </div>
      ) : null}
      {bar ? (
        <div className="lead-card-progress">
          <span className="lead-card-bar" aria-hidden="true">
            {areTotalsVisible ? (
              <span
                className={`lead-card-bar-fill ${moneyToneClass(bar.isOver ? "short" : "neutral")}`}
                style={{ width: `${bar.percent}%` }}
              />
            ) : null}
          </span>
          {lineStart || lineEnd ? (
            <div className="lead-card-progress-line">
              {lineStart ? <span>{lineStart}</span> : null}
              {lineEnd ? <span>{lineEnd}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {chips ? <div className="lead-card-chips">{chips}</div> : null}
      {children}
    </section>
  );
}

const STATE_CHIP_TONES = new Set(["mint", "rose", "sky", "butter", "lavender"]);

// A Support chip: context you read but rarely change. `person` gives the
// person's chip in their colour (person-colour.js, never a new hue); `tone`
// a status in its pastel pair; `icon` a 14px lucide icon.
export function MetaChip({ icon: Icon = null, person = undefined, tone = undefined, children }) {
  const kind = person !== undefined ? " meta-chip-person" : STATE_CHIP_TONES.has(tone) ? ` meta-chip-${tone}` : "";
  return (
    <span className={`meta-chip${kind}`} style={person !== undefined ? getPersonColourVars(person) : undefined}>
      {person !== undefined ? <span className="meta-chip-dot" aria-hidden="true" /> : null}
      {Icon ? <Icon size={14} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

// One rounded group of Detail rows.
export function DetailRows({ label = undefined, className = "", children }) {
  return (
    <div className={`detail-rows ${className}`.trim()} role="group" aria-label={label}>
      {children}
    </div>
  );
}

// One Detail row: a muted label on the left, the value on the right and a
// `›`. Three shapes:
// - with children (a control): a <label> around it, so the control keeps its
//   name and opens in place (an input, a ResponsiveSelect, a date input);
// - with onClick: a button (an action row such as "See the 10 entries");
// - otherwise a plain row.
// `action` is terracotta, an empty `value` shows `emptyLabel` muted, and
// `locked` is muted with a lock instead of the `›` and never clickable.
// `labelId` names the label so a control that is itself a button (a
// ResponsiveSelect trigger, which takes `labelId`) can say both the label
// and its value.
export function DetailRow({
  label,
  value = null,
  emptyLabel = null,
  action = false,
  locked = false,
  disabled = false,
  onClick = undefined,
  labelId = undefined,
  className = "",
  children = null,
  ...rest
}) {
  const isEmpty = !children && (value === null || value === "" || value === undefined);
  const states = [
    action && !locked ? "is-action" : "",
    isEmpty && !action ? "is-empty" : "",
    locked ? "is-locked" : "",
    className
  ].filter(Boolean).join(" ");
  const content = (
    <>
      <span id={labelId} className="detail-row-label">{label}</span>
      <span className="detail-row-value">{children ?? (isEmpty ? emptyLabel : value)}</span>
      {locked
        ? <Lock className="detail-row-lock" size={14} aria-hidden="true" />
        : <ChevronRight className="detail-row-chevron" size={16} aria-hidden="true" />}
    </>
  );

  if (children && !locked) {
    return <label className={`detail-row is-field ${states}`.trim()} {...rest}>{content}</label>;
  }
  if (onClick && !locked) {
    return (
      <button type="button" className={`detail-row is-button ${states}`.trim()} disabled={disabled} onClick={onClick} {...rest}>
        {content}
      </button>
    );
  }
  return <div className={`detail-row ${states}`.trim()} {...rest}>{content}</div>;
}

// The fold for fields most people never change on that screen. The toggle
// row lists what is inside (`summary`), so nothing hides without a hint.
// `forceOpen` keeps it open: required fields and anything with an error
// never fold.
export function MoreDetails({ label = "More details", summary = null, defaultOpen = false, forceOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const isOpen = forceOpen || open;
  return (
    <div className={isOpen ? "more-details is-open" : "more-details"}>
      <button
        type="button"
        className="more-details-toggle"
        aria-expanded={isOpen}
        aria-controls={contentId}
        disabled={forceOpen}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="more-details-label">{label}</span>
        {summary ? <span className="more-details-summary">{summary}</span> : null}
        <ChevronDown className="more-details-chevron" size={16} aria-hidden="true" />
      </button>
      {isOpen ? <div id={contentId} className="more-details-content">{children}</div> : null}
    </div>
  );
}

// The bottom action bar: one quiet text action on the left (Cancel, or a
// danger action such as Delete) and the primary on the right, both 50px
// tall, inside the safe area. The primary submits the surrounding form
// unless `onPrimary` is given.
export function BottomActions({
  primaryLabel,
  onPrimary = undefined,
  primaryDisabled = false,
  quietLabel = null,
  quietTone = undefined,
  quietDisabled = false,
  onQuiet = undefined,
  className = ""
}) {
  return (
    <div className={`bottom-actions ${className}`.trim()}>
      {quietLabel && onQuiet ? (
        <button
          type="button"
          className={quietTone === "danger" ? "bottom-actions-quiet is-danger" : "bottom-actions-quiet"}
          disabled={quietDisabled}
          onClick={onQuiet}
        >
          {quietLabel}
        </button>
      ) : null}
      <button
        type={onPrimary ? "button" : "submit"}
        className="dialog-primary bottom-actions-primary"
        disabled={primaryDisabled}
        onClick={onPrimary}
      >
        {primaryLabel}
      </button>
    </div>
  );
}
