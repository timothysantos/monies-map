import { ChevronRight, Lock, Receipt } from "lucide-react";

import { moneyToneClass } from "../money-tone-class";
import { PrivateMoney } from "../money-privacy";
import { getPersonColourVars } from "../person-colour";
import { ICON_REGISTRY } from "../ui-options";

// The Lead · Support · Detail blocks (design.md, "Lead · Support · Detail"),
// first built for the Ask entry card and shared by the edit sheets:
// - LeadCard: the one thing the sheet is about (a category bubble, what it
//   was, its category line and the amount in its money tone), with the
//   Support chips under the lead line.
// - MetaChip: one Support pill (a date, a wallet, a person in their colour,
//   a state in its pastel pair).
// - DetailRows / DetailRow: the quiet rows you tap to change a field.
// - MoreDetails: the folding row that names what it holds.
// - BottomActions: the sticky footer, primary action last (under the thumb).
// Styles: lead-support-detail.css, imported by each route that uses them so
// none of it is in the first-screen stylesheet.

const NEUTRAL_BUBBLE = "#7C8791";
const STATE_TONES = new Set(["mint", "rose", "sky", "butter", "lavender"]);

function joinClasses(...names) {
  return names.filter(Boolean).join(" ");
}

/**
 * @param {{
 *   category?: { colorHex?: string, iconKey?: string, icon?: any, bubble?: any } | null,
 *   title?: any, subtitle?: any, amount?: any, tone?: string, editable?: boolean,
 *   tag?: any, chips?: any, children?: any, className?: string, [key: string]: any
 * }} props
 */
export function LeadCard({ category = null, title = null, subtitle = null, amount = null, tone = undefined, editable = false, tag = null, chips = null, children = null, className = "", ...rest }) {
  const colour = category?.colorHex ?? NEUTRAL_BUBBLE;
  const Icon = category?.icon ?? (category?.iconKey ? ICON_REGISTRY[category.iconKey] ?? Receipt : null);
  const hasChips = Array.isArray(chips) ? chips.length > 0 : Boolean(chips);
  return (
    <section className={joinClasses("lsd-card", className)} {...rest}>
      {tag}
      <div className="lsd-hero">
        {category?.bubble ? (
          <span className="lsd-bubble-slot">{category.bubble}</span>
        ) : (
          <span className="lsd-bubble" style={{ "--cat": colour }} aria-hidden="true">
            {Icon ? <Icon size={26} strokeWidth={2} /> : null}
          </span>
        )}
        <div className="lsd-heading">
          {typeof title === "string" ? <strong className="lsd-title">{title}</strong> : title}
          {subtitle ? <span className="lsd-subtitle" style={{ "--cat": colour }}>{subtitle}</span> : null}
        </div>
        <div className={joinClasses("lsd-amount", tone ? moneyToneClass(tone) : "", editable ? "is-editable" : "")}>
          {typeof amount === "string" ? <PrivateMoney>{amount}</PrivateMoney> : amount}
        </div>
      </div>
      {children}
      {hasChips ? <div className="lsd-chips">{chips}</div> : null}
    </section>
  );
}

/**
 * @param {{ icon?: any, person?: string, tone?: string, children?: any, className?: string }} props
 */
export function MetaChip({ icon: Icon = null, person = undefined, tone = undefined, children = null, className = "" }) {
  const toneClass = tone && STATE_TONES.has(tone) ? `is-${tone}` : "";
  return (
    <span
      className={joinClasses("lsd-chip", person ? "is-person" : "", toneClass, className)}
      style={person ? getPersonColourVars(person) : undefined}
    >
      {Icon ? <Icon size={14} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/**
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
 * One Detail row. Without `children` it is a button (or, when locked, a
 * plain line with a lock); with `children` (the field's own control: an
 * inline input, or a native select or date field over the row) it is a
 * label around that control, so the control keeps the row's name and Tab
 * order stays the field order.
 * @param {{
 *   label: any, value?: any, state?: "empty" | "action" | "locked", hint?: any,
 *   onClick?: (event: any) => void, children?: any, className?: string, [key: string]: any
 * }} props
 */
export function DetailRow({ label, value = null, state = undefined, hint = null, onClick = undefined, children = null, className = "", ...rest }) {
  const isLocked = state === "locked";
  const valueContent = value !== null && value !== undefined && value !== "" ? (
    <span className={joinClasses("lsd-row-value", state ? `is-${state}` : "")}>
      {typeof value === "string" ? <span className="lsd-row-text">{value}</span> : value}
      {hint ? <span className="lsd-row-hint">{hint}</span> : null}
      {isLocked ? <Lock size={15} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
    </span>
  ) : isLocked ? (
    <span className="lsd-row-value is-locked"><Lock size={15} aria-hidden="true" /></span>
  ) : null;
  const content = (
    <>
      <span className="lsd-row-label">{label}</span>
      {valueContent}
    </>
  );

  if (children) {
    return (
      <label className={joinClasses("lsd-row has-control", isLocked ? "is-locked" : "", className)} {...rest}>
        {content}
        {children}
      </label>
    );
  }
  if (isLocked) {
    return <div className={joinClasses("lsd-row is-locked", className)} {...rest}>{content}</div>;
  }
  return (
    <button type="button" className={joinClasses("lsd-row", className)} onClick={onClick} {...rest}>
      {content}
    </button>
  );
}

/**
 * The folding row. It lists what it holds while closed, so nothing is
 * hidden without a hint; its rows render under it only while open.
 * @param {{
 *   summary?: any, open: boolean, onOpenChange: (open: boolean) => void,
 *   label?: string, openLabel?: string, children?: any, [key: string]: any
 * }} props
 */
export function MoreDetails({ summary = null, open, onOpenChange, label = "More details", openLabel = "Fewer details", children = null, ...rest }) {
  return (
    <>
      <button type="button" className="lsd-row lsd-row-more" aria-expanded={open} onClick={() => onOpenChange(!open)} {...rest}>
        <span className="lsd-row-label">{open ? openLabel : label}</span>
        <span className="lsd-row-value">
          {open || !summary ? null : <span className="lsd-row-hint">{summary}</span>}
          <ChevronRight size={16} aria-hidden="true" className={open ? "is-open" : undefined} />
        </span>
      </button>
      {open ? children : null}
    </>
  );
}

/**
 * The bottom bar: a destructive action on its own at the start, then the
 * quiet action and the primary action at the end, where the thumb is.
 * @param {{ primary?: any, secondary?: any, destructive?: any, className?: string }} props
 */
export function BottomActions({ primary = null, secondary = null, destructive = null, className = "" }) {
  return (
    <div className={joinClasses("lsd-bottom", className)}>
      {destructive ? <div className="lsd-bottom-start">{destructive}</div> : null}
      <div className="lsd-bottom-end">
        {secondary}
        {primary}
      </div>
    </div>
  );
}
