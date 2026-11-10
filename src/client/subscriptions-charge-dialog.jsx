import "./sheet-dialog.css";
import { useState } from "react";

import { subscriptionsCopy as copy, dayMonth, ordinalDay, shortMonthName } from "./copy/subscriptions-copy";
import { money } from "./formatters";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { SheetDialog } from "./sheet-dialog";
import { DetailRow, DetailRows } from "./ui/lead-support-detail";

// One charge of Subscriptions and bills, opened from its row (design.md
// "Subscriptions and bills"): what it usually costs, a price rise, the last
// 12 months, when it comes and where it is paid from, then the household's
// choices: keep it on the list, rename it, or say it is not a subscription
// or bill (Show again brings it back). A phone gets the bottom sheet, a
// wider screen the small dialog (SheetDialog). The choice is saved by the
// card, which offers Undo.

/**
 * @param {{ series: any, saving: boolean, errorMessage: string, onChoose: (action: string, displayName?: string) => void, onClose: () => void }} props
 */
export function SubscriptionsChargeDialog({ series, saving, errorMessage, onChoose, onClose }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(series.name);
  const isTakenOff = series.status === "taken_off";
  const isLate = series.status === "late" || series.status === "stopped";
  const usual = series.kind === "varies" || isLate
    ? `${money(series.latest.amountMinor)} ${copy.lastOne}`
    : `${money(series.latest.amountMinor)} ${series.period === "yearly" ? copy.aYear : copy.aMonth}`;

  if (naming) {
    return (
      <SheetDialog
        title={copy.rename}
        primaryLabel={copy.saveName}
        primaryDisabled={saving || name.trim().length > copy.nameMax}
        isSubmitting={saving}
        isDirty={name !== series.name}
        errorMessage={errorMessage}
        onSubmit={() => onChoose("rename", name)}
        onQuiet={() => setNaming(false)}
        onClose={onClose}
      >
        <label className="subs-name-field">
          <span>{copy.nameLabel}</span>
          <input value={name} maxLength={copy.nameMax} onChange={(event) => setName(event.target.value)} />
        </label>
        <p className="subs-dialog-note">{copy.renameNote}</p>
      </SheetDialog>
    );
  }

  return (
    <SheetDialog
      title={series.name}
      primaryLabel={isTakenOff ? copy.showAgain : series.kept ? null : copy.keep}
      hideSubmit={!isTakenOff && Boolean(series.kept)}
      isSubmitting={saving}
      errorMessage={errorMessage}
      onSubmit={() => onChoose(isTakenOff ? "show_again" : "keep")}
      quietLabel={null}
      secondary={(
        <button type="button" className="lsd-quiet" disabled={saving} onClick={() => setNaming(true)}>{copy.rename}</button>
      )}
      destructive={isTakenOff ? null : (
        <button type="button" className="lsd-quiet" disabled={saving} onClick={() => onChoose("take_off")}>{copy.notRepeating}</button>
      )}
      onClose={onClose}
    >
      <DetailRows label={series.name}>
        <DetailRow readOnly label={copy.usually} value={<PrivateMoney>{usual}</PrivateMoney>} />
        {series.wentUp ? (
          <DetailRow
            readOnly
            label={copy.wentUpLabel}
            value={areTotalsVisible
              ? `${money(series.wentUp.fromMinor)} → ${money(series.wentUp.toMinor)} in ${shortMonthName(series.wentUp.date.slice(0, 7))}`
              : copy.wentUpHidden(series.wentUp.date)}
          />
        ) : null}
        <DetailRow readOnly label={copy.lastYear} value={<PrivateMoney>{money(series.year.amountMinor)}</PrivateMoney>} />
        <DetailRow readOnly label={copy.comes} value={series.period === "yearly" ? `around ${dayMonth(series.nextDate)}` : `around ${ordinalDay(series.usualDay)}`} />
        {series.account ? <DetailRow readOnly label={copy.paidFrom} value={series.account} /> : null}
      </DetailRows>
      <p className="subs-dialog-note">{copy.found(series)}</p>
    </SheetDialog>
  );
}
