import { ArrowLeftRight, Link2, PencilLine, Plane, Users } from "lucide-react";

import { NEUTRAL_BUBBLE_COLOUR } from "./ask-plan-draft-card";
import { effectiveChange, selectedChoiceId } from "./ask-turn-api";
import { TransferChoices } from "./ask-transfer-choices";
import { askCopy, formatShortMonth } from "./copy/ask-copy";
import { formatMonthYear } from "./copy/ask-plan-copy";
import { moneyWithCurrency } from "./formatters";
import { PrivateMoney } from "./money-privacy";
import { paletteColour } from "./palette-colour";
import { BottomActions, DetailRow, DetailRows, LeadCard, MetaChip } from "./ui/lead-support-detail";

const copy = askCopy.turn;

function formatDay(date) {
  const [year, month, day] = String(date ?? "").split("-").map(Number);
  return year && month && day ? `${day} ${formatShortMonth(`${year}-${String(month).padStart(2, "0")}`)}` : date;
}

/**
 * An add to Splits that Ask drafted from a message ("Add to splits, all
 * Joyce"; docs/flows/ask-flow.md "AI first"): the entry, who paid, each
 * person's share and the group, every figure the server's (from the
 * entry's own amount). Nothing is written until Add to Splits, which posts
 * the existing command; saved, it offers Open on Splits and Undo.
 */
export function AskSplitProposalCard({ item, busy = false, settled = false, onSave, onDiscard, onOpen, onUndo, onGuess }) {
  const { proposal } = item;
  const saved = item.status === "saved" || item.status === "undoing";
  return (
    <section id={item.id} className={`ask-plan-draft ask-turn-card${settled ? " is-settled" : ""}`} data-split-proposal={item.status} aria-label={copy.split.label}>
      <LeadCard
        className="ask-plan-lead"
        tag={<span className={`ask-card-tag ${saved ? "is-saved" : "is-filled"}`}>{saved ? copy.split.savedTag : copy.draftTag}</span>}
        category={{ colorHex: NEUTRAL_BUBBLE_COLOUR, icon: Users }}
        title={<strong className="lsd-title ask-plan-title">{proposal.description}</strong>}
        subtitle={<span className="ask-plan-subtitle">{copy.split.paidBy(proposal.payerName)}</span>}
        amount={moneyWithCurrency(proposal.amountMinor, proposal.currency)}
        tone="neutral"
        amountCaption={formatDay(proposal.date)}
        chips={<MetaChip>{proposal.groupName || copy.split.noGroup}</MetaChip>}
      />
      <DetailRows label={copy.split.label}>
        {proposal.shares.map((share) => (
          <DetailRow
            key={share.personName}
            readOnly
            data-split-share={share.personName}
            label={copy.split.share(share.personName)}
            value={(
              <span className="ask-plan-change">
                <PrivateMoney className="money-neutral">{moneyWithCurrency(share.amountMinor, proposal.currency)}</PrivateMoney>
                <span className="ask-turn-percent">{`${Math.round(share.basisPoints / 100)}%`}</span>
              </span>
            )}
          />
        ))}
        {/* A bare number was read as dollars: one tap reads it as a percentage instead. */}
        {!saved && item.status === "draft" && proposal.percentGuess && onGuess
          ? <DetailRow label={copy.split.percentInstead} state="action" onClick={onGuess} disabled={busy} data-split-percent-instead="" />
          : null}
        {saved ? <DetailRow label={copy.split.openOnSplits} state="action" onClick={onOpen} disabled={busy} /> : null}
        {saved ? <DetailRow label={item.status === "undoing" ? copy.split.undoing : copy.split.undo} onClick={onUndo} disabled={busy} data-split-undo="" /> : null}
      </DetailRows>
      {saved ? null : (
        <BottomActions
          className="ask-plan-actions"
          quietLabel={copy.split.discard}
          onQuiet={onDiscard}
          quietDisabled={busy}
          primaryLabel={item.status === "saving" ? copy.split.saving : copy.split.save}
          onPrimary={onSave}
          primaryDisabled={busy}
        />
      )}
    </section>
  );
}

/**
 * A settle-up payment Ask drafted ("Joyce paid me back $80"): who paid whom,
 * the amount the person wrote, the date and the group. Record payment
 * posts the existing settlement command.
 */
export function AskSettlementDraftCard({ item, busy = false, settled = false, onSave, onDiscard, onOpen }) {
  const { settlement } = item;
  const saved = item.status === "saved";
  const unsure = item.status === "unsure";
  return (
    <section id={item.id} className={`ask-plan-draft ask-turn-card${settled ? " is-settled" : ""}`} data-settlement-draft={item.status} aria-label={copy.settlement.label}>
      <LeadCard
        className="ask-plan-lead"
        tag={<span className={`ask-card-tag ${saved ? "is-saved" : "is-filled"}`}>{saved ? copy.settlement.savedTag : copy.draftTag}</span>}
        category={{ colorHex: NEUTRAL_BUBBLE_COLOUR, icon: ArrowLeftRight }}
        title={<strong className="lsd-title ask-plan-title">{copy.settlement.title(settlement.fromPersonName, settlement.toPersonName)}</strong>}
        subtitle={<span className="ask-plan-subtitle">{settlement.groupName || copy.settlement.noGroup}</span>}
        amount={moneyWithCurrency(settlement.amountMinor, settlement.currency)}
        tone="neutral"
        amountCaption={formatDay(settlement.date)}
      />
      {unsure ? <p className="ask-plan-warning">{copy.settlement.unsure}</p> : null}
      {saved || unsure ? (
        <DetailRows label={copy.settlement.label}>
          <DetailRow label={copy.settlement.openSplits} state="action" onClick={onOpen} disabled={busy} />
        </DetailRows>
      ) : (
        <BottomActions
          className="ask-plan-actions"
          quietLabel={copy.settlement.discard}
          onQuiet={onDiscard}
          quietDisabled={busy}
          primaryLabel={item.status === "saving" ? copy.settlement.saving : copy.settlement.save}
          onPrimary={onSave}
          primaryDisabled={busy}
        />
      )}
    </section>
  );
}

const changeCopy = copy.change;
const DATE_FIELDS = new Set(["date"]);

function changeValue(row, side) {
  const minor = side === "before" ? row.beforeMinor : row.afterMinor;
  if (Number.isInteger(minor)) {
    return <PrivateMoney className="money-neutral">{moneyWithCurrency(minor, row.currency)}</PrivateMoney>;
  }
  const text = row[side];
  if (row.field === "colour" && text) {
    return <span className="ask-change-swatch" style={{ background: paletteColour(text) }} aria-label={text} />;
  }
  if (!text) {
    return row.field === "group" ? changeCopy.noGroup : row.field === "trip" ? changeCopy.noTrip : changeCopy.none;
  }
  return DATE_FIELDS.has(row.field) ? formatDay(text) : text;
}

function subtitleOf(change, choiceId) {
  const line = changeCopy.subtitle[choiceId === "none" ? "link_transfer_none" : change.type];
  return typeof line === "function" ? line(change.count) : line;
}

function saveLabelOf(change, choiceId) {
  if (choiceId === "none") return changeCopy.saveTransferNone;
  const label = changeCopy.save[change.type];
  return typeof label === "function" ? label(change.count) : label ?? changeCopy.saveDefault;
}

/**
 * A change to saved data that Ask drafted from a message (docs/flows/
 * ask-flow.md "Phase 2"): what changes, before and after, every figure the
 * server's, and the entries it touches (count and the first few). Nothing
 * is written until its button, which posts the existing command; a change
 * over ten entries needs the "Yes, change all N" tap first. Saved, it
 * offers Undo where the command can take it back, and after a bulk
 * recategorise, the optional rule for new entries.
 */
export function AskChangeCard({ item, busy = false, settled = false, onSave, onDiscard, onUndo, onConfirm, onRule, onOpen, onChooseTransfer }) {
  // A transfer change shows the choice the person made (the best match to
  // begin with): its rows, entries, steps and Undo.
  const change = effectiveChange(item.change, item.choiceId);
  const choiceId = selectedChoiceId(item.change, item.choiceId);
  const choices = item.change.transfer;
  const saved = item.status === "saved" || item.status === "undoing";
  const undone = item.status === "undone";
  const needsConfirm = Boolean(change.confirmCount);
  const firstEntry = change.entries[0];
  const showEntries = change.type === "recategorise_bulk" || change.type === "plan_link" || change.type === "link_transfer" || change.type === "trip_event";
  const amount = change.entries.length === 1 && !showEntries ? firstEntry : null;
  return (
    <section id={item.id} className={`ask-plan-draft ask-turn-card ask-change${settled ? " is-settled" : ""}`} data-change-draft={item.status} data-change-type={change.type} aria-label={changeCopy.label}>
      <LeadCard
        className="ask-plan-lead"
        tag={<span className={`ask-card-tag ${saved ? "is-saved" : "is-filled"}`}>{saved ? changeCopy.savedTag : undone ? changeCopy.undoneTag : copy.draftTag}</span>}
        category={{ colorHex: NEUTRAL_BUBBLE_COLOUR, icon: change.type === "trip_event" || change.type === "trip_event_create" ? Plane : change.type === "link_transfer" || change.type === "plan_link" ? Link2 : PencilLine }}
        title={<strong className="lsd-title ask-plan-title">{change.title}</strong>}
        subtitle={<span className="ask-plan-subtitle">{subtitleOf(change, choiceId)}</span>}
        amount={amount ? moneyWithCurrency(amount.amountMinor, amount.currency) : undefined}
        tone="neutral"
        amountCaption={amount ? formatDay(amount.date) : undefined}
        chips={change.type === "month_note" ? <MetaChip>{formatMonthYear(change.month)}</MetaChip> : undefined}
      />
      <DetailRows label={changeCopy.label}>
        {change.rows.map((row, index) => (
          <DetailRow
            key={`${row.field}-${index}`}
            readOnly
            data-change-field={row.field}
            label={changeCopy.fields[row.field] ?? row.field}
            value={(
              <span className="ask-plan-change">
                {hasBefore(row) ? <span className="ask-plan-before ask-change-before">{changeValue(row, "before")}</span> : null}
                {hasBefore(row) ? <span aria-hidden="true">→</span> : null}
                <span className="ask-change-after">{changeValue(row, "after")}</span>
              </span>
            )}
          />
        ))}
      </DetailRows>
      {showEntries && change.entries.length ? (
        <DetailRows label={changeCopy.entriesLabel} className="ask-change-entries">
          {change.entries.map((entry) => (
            <DetailRow
              key={entry.entryId}
              readOnly
              data-change-entry={entry.entryId}
              label={(
                <span className="ask-change-entry">
                  <span className="ask-change-entry-name">{entry.description}</span>
                  <span className="ask-change-entry-meta">{[formatDay(entry.date), entry.trip ? tripMove(entry.trip) : entry.accountName ?? entry.categoryName].filter(Boolean).join(" · ")}</span>
                </span>
              )}
              value={<PrivateMoney className="money-neutral">{moneyWithCurrency(entry.amountMinor, entry.currency)}</PrivateMoney>}
            />
          ))}
          {change.count > change.entries.length ? <DetailRow readOnly label={changeCopy.more(change.count - change.entries.length)} /> : null}
        </DetailRows>
      ) : null}
      {choices && item.status === "draft" ? (
        <TransferChoices
          options={choices.options.map((option) => ({ id: option.id, wallet: option.entries[1]?.accountName ?? "", date: option.entries[1]?.date ?? "" }))}
          selectedId={choiceId}
          showNone={Boolean(choices.none)}
          walletMissed={choices.walletMissed}
          disabled={busy}
          onChoose={onChooseTransfer}
        />
      ) : null}
      {item.status === "draft" && needsConfirm ? (
        <DetailRows label={changeCopy.confirm(change.confirmCount, change.type)}>
          <DetailRow
            label={changeCopy.confirm(change.confirmCount, change.type)}
            value={item.confirmed ? "✓" : changeCopy.confirmHint}
            state="action"
            aria-pressed={item.confirmed ? "true" : "false"}
            data-change-confirm=""
            onClick={onConfirm}
            disabled={busy}
          />
        </DetailRows>
      ) : null}
      {saved ? (
        <DetailRows label={changeCopy.label}>
          {change.rule && !item.ruleSaved ? (
            <DetailRow label={item.ruleSaving ? changeCopy.ruleSaving : changeCopy.rule(change.rule.pattern, change.rule.categoryName)} state="action" onClick={onRule} disabled={busy} data-change-rule="" />
          ) : null}
          {onOpen ? <DetailRow label={changeCopy.open[openPageOf(change)]} state="action" onClick={onOpen} disabled={busy} /> : null}
          {change.undo ? <DetailRow label={item.status === "undoing" ? changeCopy.undoing : changeCopy.undo} onClick={onUndo} disabled={busy} data-change-undo="" /> : null}
        </DetailRows>
      ) : null}
      {item.status === "draft" || item.status === "saving" ? (
        <BottomActions
          className="ask-plan-actions"
          quietLabel={changeCopy.discard}
          onQuiet={onDiscard}
          quietDisabled={busy}
          primaryLabel={item.status === "saving" ? changeCopy.saving : saveLabelOf(change, choiceId)}
          onPrimary={onSave}
          primaryDisabled={busy || (needsConfirm && !item.confirmed)}
        />
      ) : null}
    </section>
  );
}

// Whether a row shows a before side: one with a value, and a trip row
// always ("No trip or event → Seoul trip").
function hasBefore(row) {
  return Boolean(row.before) || Number.isInteger(row.beforeMinor) || row.field === "trip";
}

// One entry's trip before and after: "No trip or event → Seoul trip".
function tripMove(trip) {
  return `${trip.before || changeCopy.noTrip} → ${trip.after || changeCopy.noTrip}`;
}

// Where a saved change can be seen.
export function openPageOf(change) {
  if (["group_create", "group_move", "simplify"].includes(change.type)) return "splits";
  if (["payment_way", "category_create", "category_rename", "category_colour"].includes(change.type)) return "settings";
  if (["month_note", "plan_link"].includes(change.type)) return "month";
  return "entries";
}

/**
 * Bank rows that may be the payment behind a split, as Splits' review lists
 * them. Match links one through Splits' own command; Not this one only
 * hides it here (Splits still lists it). A match that needs an exchange
 * rate checked is left to Splits.
 */
export function AskMatchesCard({ item, busy = false, settled = false, onLink, onSkip, onOpen }) {
  const matchesCopy = copy.matches;
  return (
    <section id={item.id} className={`ask-plan-draft ask-turn-card ask-matches${settled ? " is-settled" : ""}`} data-matches="" aria-label={matchesCopy.label}>
      <LeadCard
        className="ask-plan-lead"
        category={{ colorHex: NEUTRAL_BUBBLE_COLOUR, icon: Link2 }}
        title={<strong className="lsd-title ask-plan-title">{matchesCopy.title}</strong>}
        subtitle={<span className="ask-plan-subtitle">{matchesCopy.subtitle(formatMonthYear(item.month))}</span>}
      />
      {item.matches.map((match) => {
        const state = item.handled?.[match.id] ?? "";
        return (
          <div key={match.id} className="ask-match" data-match={match.id} data-match-state={state || "open"}>
          <DetailRows label={match.splitDescription}>
            <DetailRow
              readOnly
              label={(
                <span className="ask-change-entry">
                  <span className="ask-change-entry-name">{match.splitDescription}</span>
                  <span className="ask-change-entry-meta">{[formatDay(match.splitDate), match.groupName].filter(Boolean).join(" · ")}</span>
                </span>
              )}
              value={<PrivateMoney className="money-neutral">{moneyWithCurrency(Math.abs(match.splitAmountMinor), match.splitCurrency)}</PrivateMoney>}
            />
            <DetailRow
              readOnly
              label={(
                <span className="ask-change-entry">
                  <span className="ask-change-entry-name">{match.transactionDescription}</span>
                  <span className="ask-change-entry-meta">{[matchesCopy.bank, formatDay(match.transactionDate)].join(" · ")}</span>
                </span>
              )}
              value={<PrivateMoney className="money-neutral">{moneyWithCurrency(Math.abs(match.amountMinor), match.transactionCurrency)}</PrivateMoney>}
            />
            {state ? (
              <DetailRow readOnly label={state === "linked" ? matchesCopy.linked : matchesCopy.skipped} />
            ) : match.canLink ? (
              <BottomActions
                className="ask-plan-actions"
                quietLabel={matchesCopy.skip}
                onQuiet={() => onSkip(match.id)}
                quietDisabled={busy}
                primaryLabel={matchesCopy.accept}
                onPrimary={() => onLink(match.id)}
                primaryDisabled={busy}
              />
            ) : (
              <DetailRow label={matchesCopy.needsRate} state="action" onClick={onOpen} disabled={busy} />
            )}
          </DetailRows>
          </div>
        );
      })}
      <DetailRows label={matchesCopy.openSplits}>
        <DetailRow label={matchesCopy.openSplits} state="action" onClick={onOpen} disabled={busy} />
      </DetailRows>
    </section>
  );
}
