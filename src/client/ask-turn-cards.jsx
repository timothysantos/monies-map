import { ArrowLeftRight, Users } from "lucide-react";

import { NEUTRAL_BUBBLE_COLOUR } from "./ask-plan-draft-card";
import { askCopy, formatShortMonth } from "./copy/ask-copy";
import { moneyWithCurrency } from "./formatters";
import { PrivateMoney } from "./money-privacy";
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
export function AskSplitProposalCard({ item, busy = false, settled = false, onSave, onDiscard, onOpen, onUndo }) {
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
