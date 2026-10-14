import { askCopy, formatShortMonth } from "./copy/ask-copy";
import { moneyWithCurrency } from "./formatters";
import { PrivateMoney } from "./money-privacy";
import { DetailRow, DetailRows } from "./ui/lead-support-detail";

const copy = askCopy.turn.change.transfer;

function dayOf(date) {
  const [year, month, day] = String(date ?? "").split("-").map(Number);
  return year && month && day ? `${day} ${formatShortMonth(`${year}-${String(month).padStart(2, "0")}`)}` : date;
}

/**
 * The other sides of a transfer to choose from, as chips: the best match
 * first and selected, up to 3 more, then "No other side yet" (the entry
 * stays an unmatched transfer). Used by the change card (an entry becoming
 * a transfer) and the draft card (a new transfer). When the person named a
 * wallet that has no match, a line says so before the others.
 * @param {{ options: Array<{ id: string, wallet: string, date: string }>, selectedId: string, showNone: boolean, walletMissed?: string, disabled?: boolean, onChoose: (id: string) => void }} props
 */
export function TransferChoices({ options, selectedId, showNone, walletMissed = "", disabled = false, onChoose }) {
  return (
    <div className="ask-transfer-choices" data-transfer-choices="">
      {walletMissed ? (
        <p className="ask-transfer-note" data-transfer-wallet-missed="">
          {options.length ? copy.walletMissed(walletMissed) : copy.walletMissedNone(walletMissed)}
        </p>
      ) : null}
      {options.length || showNone ? (
        <div className="ask-transfer-chips" role="group" aria-label={copy.label}>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`ask-chip${option.id === selectedId ? " is-primary" : ""}`}
              aria-pressed={option.id === selectedId}
              data-transfer-choice={option.id}
              disabled={disabled}
              onClick={() => onChoose(option.id)}
            >
              {copy.chip(option.wallet, dayOf(option.date))}
            </button>
          ))}
          {showNone ? (
            <button
              type="button"
              className={`ask-chip${selectedId === "none" ? " is-primary" : ""}`}
              aria-pressed={selectedId === "none"}
              data-transfer-choice="none"
              disabled={disabled}
              onClick={() => onChoose("none")}
            >
              {copy.none}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Under a draft transfer card: the other side the card will link to when
 * saved (date, wallet, amount), or "No other side yet", with the choices.
 * Nothing is written until Save.
 * @param {{ match: { options: any[], walletMissed: string, selectedId: string }, currency: string, disabled?: boolean, onChoose: (id: string) => void }} props
 */
export function AskTransferMatchRows({ match, currency, disabled = false, onChoose }) {
  const selected = match.options.find((option) => option.entryId === match.selectedId) ?? null;
  return (
    <section className="ask-transfer-match" data-transfer-match={match.selectedId} aria-label={copy.label}>
      <DetailRows label={copy.label}>
        <DetailRow
          readOnly
          data-transfer-selected={match.selectedId}
          label={selected ? (
            <span className="ask-change-entry">
              <span className="ask-change-entry-name">{selected.description}</span>
              <span className="ask-change-entry-meta">{[dayOf(selected.date), selected.accountName].filter(Boolean).join(" · ")}</span>
            </span>
          ) : copy.noneRow}
          value={selected ? <PrivateMoney className="money-neutral">{moneyWithCurrency(selected.amountMinor, currency)}</PrivateMoney> : undefined}
        />
      </DetailRows>
      <TransferChoices
        options={match.options.map((option) => ({ id: option.entryId, wallet: option.accountName, date: option.date }))}
        selectedId={match.selectedId}
        showNone={match.options.length > 0}
        walletMissed={match.walletMissed}
        disabled={disabled}
        onChoose={onChoose}
      />
    </section>
  );
}
