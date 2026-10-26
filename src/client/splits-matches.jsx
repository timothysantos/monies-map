import "./splits-matches.css";
import { ChevronLeft, Link2 } from "lucide-react";

import { messages } from "./copy/en-SG";
import { splitsMessages } from "./copy/en-SG-splits";
import { EmptyState } from "./ui-states";
import { moniesClient } from "./monies-client-service";
import { DetailRow, DetailRows, LeadCard, MetaChip } from "./ui/lead-support-detail";

const { format: formatService } = moniesClient;

// Splits terracotta, from the category palette (the split cards' colour).
const GROUP_BUBBLE_COLOUR = "#BF7D51";
// The confidence chip in its pastel pair; a label it does not know stays plain.
const CONFIDENCE_TONES = { high: "mint", medium: "butter", low: "rose" };

// The bank-match review (design.md, "Lead · Support · Detail"): a lead that
// says what this is and how many are waiting, with Back; then one white card
// per candidate: the label and its confidence, the existing split and the
// imported ledger row as two Detail rows, how far apart they are, and Keep
// separate (quiet) beside Match (the one primary).
export function SplitMatchesList({ matches, pendingMatchCount, onBackToGroup, onDismissMatch, onConfirmMatch }) {
  return (
    <section className="split-list-section split-match-review-section">
      <LeadCard
        className="split-match-lead"
        category={{ colorHex: GROUP_BUBBLE_COLOUR, icon: Link2 }}
        title={splitsMessages.matches}
        subtitle={pendingMatchCount ? splitsMessages.matchInboxTitle(pendingMatchCount) : null}
      >
        {pendingMatchCount ? <p className="lsd-note">{splitsMessages.matchReviewDetail(pendingMatchCount)}</p> : null}
        <div className="split-match-lead-actions">
          <button type="button" className="lsd-quiet split-match-back-action" aria-label={splitsMessages.backToGroup} onClick={onBackToGroup}>
            <ChevronLeft size={16} aria-hidden="true" />
            <span>Back</span>
          </button>
        </div>
      </LeadCard>
      <div className="split-match-list">
        {matches.length ? matches.map((match) => (
          <div key={match.id} className="split-match-card">
            <div className="split-match-copy">
              <div className="split-match-headline">
                <strong>{match.reviewLabel}</strong>
                <MetaChip tone={CONFIDENCE_TONES[match.confidenceLabel.toLowerCase()]}>{match.confidenceLabel}</MetaChip>
              </div>
              <DetailRows label={splitsMessages.matches} className="split-match-compare">
                <SplitMatchSide
                  label={splitsMessages.existingSplitRecord}
                  date={match.splitDate}
                  description={match.splitDescription}
                  amountMinor={match.splitAmountMinor}
                  currency={match.splitCurrency}
                />
                <SplitMatchSide
                  label={splitsMessages.importedLedgerRow}
                  date={match.transactionDate}
                  description={match.transactionDescription}
                  amountMinor={match.amountMinor}
                  currency={match.transactionCurrency}
                />
              </DetailRows>
              {match.requiresFxReview ? (
                <p className="split-match-deltas">
                  {match.dateDeltaDays} day{match.dateDeltaDays === 1 ? "" : "s"} apart. Confirm this conversion to store the final {match.transactionCurrency} ledger amount and FX evidence. The original {match.splitCurrency} split and shares will stay unchanged.
                </p>
              ) : (
                <p className="split-match-deltas">
                  {splitsMessages.matchDeltaSummary(
                    match.dateDeltaDays,
                    // Same-currency match: the delta is in that shared currency.
                    formatService.moneyWithCurrency(match.amountDeltaMinor, match.splitCurrency ?? "SGD")
                  )}
                </p>
              )}
            </div>
            <div className="split-match-actions">
              <button type="button" className="lsd-quiet" onClick={() => onDismissMatch(match.id)}>
                {splitsMessages.keepSeparate}
              </button>
              <button type="button" className="lsd-primary" onClick={() => void onConfirmMatch(match)}>
                {splitsMessages.match}
              </button>
            </div>
          </div>
        )) : (
          <EmptyState>{splitsMessages.noMatches}</EmptyState>
        )}
      </div>
    </section>
  );
}

function SplitMatchSide({ label, date, description, amountMinor, currency = "SGD" }) {
  return (
    <DetailRow
      label={label}
      readOnly
      className="split-match-record"
      value={(
        <span className="split-match-record-value">
          <strong>{description}</strong>
          <small>{messages.common.triplet(formatService.formatDate(date), formatService.moneyWithCurrency(amountMinor, currency))}</small>
        </span>
      )}
    />
  );
}
