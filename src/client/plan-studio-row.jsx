import { Lock, LockOpen } from "lucide-react";
import { useId } from "react";

import { planStudioCopy } from "./copy/plan-studio-copy";
import { AmountEditor } from "./plan-studio-amount";
import { InfoButton, InfoPopover, useInfoOpen } from "./plan-studio-info";
import { RowMenu } from "./plan-studio-menu";
import { RollingMoney } from "./plan-studio-parts";
import { getPersonColourVars } from "./person-colour";
import { StudioSlider } from "./plan-studio-slider-control";
import { sliderValueText } from "./plan-studio-slider";
import { dueTagParts } from "./plan-studio-v2-model";
import { moneyToneClass } from "./money-tone-class";

const copy = planStudioCopy;

// The owner chip: one person's colour, or Shared with each person's part.
function OwnerChip({ row, halves, fmt }) {
  if (row.ownershipType === "shared") {
    const equal = halves.length > 0 && halves.every((half) => half.amountMinor === halves[0].amountMinor);
    let text = copy.row.shared;
    if (equal) text = copy.row.sharedEqual(fmt.money(halves[0].amountMinor));
    else if (halves.length) text = copy.row.sharedSplit(halves.map((half) => ({ name: half.personName, amount: fmt.money(half.amountMinor) })));
    return <span className="ps-owner" style={getPersonColourVars("shared")}>{text}</span>;
  }
  return row.ownerName ? <span className="ps-owner" style={getPersonColourVars(row.ownerName)}>{row.ownerName}</span> : null;
}

// The small "due 2 Oct" tag of a dated line.
function DueTag({ row }) {
  const parts = dueTagParts(row);
  return parts ? <span className="ps-due" data-ps-due>{copy.due(parts.day, copy.monthNames[parts.monthIndex])}</span> : null;
}

/**
 * One plan line in Plan Studio's list: its name (and due date), planned amount
 * (tap to type an exact one), a lock, the slider with nudge buttons of one
 * step and one line about where it stands. The controls carry a popover of
 * what the line did before and how it is doing (plan-studio-info.jsx); a menu
 * holds what the plan tables do that a slider cannot (notes, details,
 * matching entries, removing). Every control is a native button or a slider,
 * 44px tall; hidden money turns the amount to dots and drops the line and the
 * popover.
 */
export function StudioRow({
  row, plannedMinor, savedMinor, locked, fmt, status, paceMinor, scale, halves, dotColour, readOnlyReason, info, menuActions = {},
  onSet, onNudge, onGestureStart, onGestureEnd, onToggleLock
}) {
  const changed = plannedMinor !== savedMinor;
  const disabled = !row.editable || locked;
  const spendLike = row.job === "spend";
  const stepText = String(scale.stepMinor / 100);
  const infoId = useId();
  const popover = useInfoOpen();
  const figureProps = row.actualEntryIds.length
    ? row.job === "income"
      ? { "data-fig": "earned", "data-fig-ids": row.actualEntryIds.join(" ") }
      : { "data-fig": "spent", "data-fig-ids": row.actualEntryIds.join(" "), "data-fig-arg": row.categoryName, "data-fig-ask": row.categoryName ? "category" : undefined }
    : null;
  const statusText = fmt.hidden ? "" : copy.status[status.kind](fmt.money(status.amountMinor));
  const statusClass = `ps-row-status ${fmt.hidden ? "" : moneyToneClass(status.tone)}`;
  return (
    <div className={`ps-row${changed ? " is-changed" : ""}${locked ? " is-locked" : ""}`} data-ps-row={row.key} data-job={row.job}>
      <div className="ps-row-top">
        <span className="ps-dot" style={{ "--ps-dot": dotColour }} aria-hidden="true" />
        <span className="ps-row-name"><span className="ps-row-label">{row.label}</span><DueTag row={row} /></span>
        {row.editable ? (
          <AmountEditor
            label={row.label}
            valueMinor={plannedMinor}
            savedMinor={savedMinor}
            fmt={fmt}
            disabled={locked}
            display={<RollingMoney minor={plannedMinor} fmt={fmt} />}
            onApply={(minor) => onSet(row.key, minor)}
          />
        ) : (
          <span className="ps-amount is-static"><RollingMoney minor={plannedMinor} fmt={fmt} /></span>
        )}
        {row.editable ? (
          <button
            type="button"
            className="ps-icon-button"
            aria-pressed={locked}
            aria-label={locked ? copy.row.unlock(row.label) : copy.row.lock(row.label)}
            onClick={() => onToggleLock(row.key)}
          >
            {locked ? <Lock size={18} aria-hidden="true" /> : <LockOpen size={18} aria-hidden="true" />}
          </button>
        ) : null}
        {fmt.hidden ? null : <InfoButton label={row.label} pinned={popover.pinned} onClick={popover.togglePinned} />}
        <RowMenu row={row} actions={menuActions} />
      </div>
      {row.editable ? (
        <InfoPopover
          id={infoId}
          anchorProps={{ className: "ps-row-ctl", ...popover.handlers }}
          open={popover.open}
          pinned={popover.pinned}
          hidden={fmt.hidden}
          row={row}
          info={info}
          fmt={fmt}
          onDismiss={popover.dismiss}
        >
          <button type="button" className="ps-nudge" disabled={disabled || plannedMinor <= 0} aria-label={copy.row.lower(row.label, `${stepText} dollars`)} onClick={() => onNudge(row.key, -1)}>
            −{stepText}
          </button>
          <StudioSlider
            label={copy.row.sliderLabel(row.label)}
            valueMinor={plannedMinor}
            savedMinor={savedMinor}
            actualMinor={row.actualMinor}
            paceMinor={paceMinor}
            maxMinor={scale.maxMinor}
            stepMinor={scale.stepMinor}
            disabled={disabled}
            valueText={sliderValueText({ valueMinor: plannedMinor, hidden: fmt.hidden, format: fmt.money })}
            spendLike={spendLike}
            hidden={fmt.hidden}
            describedBy={popover.open && !fmt.hidden ? infoId : undefined}
            onChange={(minor) => onSet(row.key, minor)}
            onGestureStart={() => { popover.setDragging(true); onGestureStart(); }}
            onGestureEnd={() => { popover.setDragging(false); onGestureEnd(); }}
          />
          <button type="button" className="ps-nudge" disabled={disabled} aria-label={copy.row.raise(row.label, `${stepText} dollars`)} onClick={() => onNudge(row.key, 1)}>
            +{stepText}
          </button>
        </InfoPopover>
      ) : (
        readOnlyReason ? <p className="ps-row-readonly">{readOnlyReason}</p> : null
      )}
      <div className="ps-row-foot">
        {figureProps ? (
          <button type="button" className={`${statusClass} ps-row-figure`} {...figureProps}>{statusText}</button>
        ) : (
          <span className={statusClass}>{statusText}</span>
        )}
        <span className="ps-row-extra">
          {changed ? <span className="ps-delta">{copy.row.fromSaved(fmt.signed(plannedMinor - savedMinor))}</span> : null}
          <OwnerChip row={row} halves={halves} fmt={fmt} />
        </span>
      </div>
    </div>
  );
}
