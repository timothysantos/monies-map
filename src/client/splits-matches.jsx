import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";

const { format: formatService } = moniesClient;

export function SplitMatchesList({ matches, pendingMatchCount, onDismissMatch, onConfirmMatch }) {
  return (
    <section className="split-list-section split-match-review-section">
      <div className="panel-subhead">
        <div>
          <h2>{messages.splits.matches}</h2>
          <p className="lede compact">{pendingMatchCount ? messages.splits.matchReviewDetail(pendingMatchCount) : messages.splits.noMatches}</p>
        </div>
      </div>
      <div className="split-match-list">
        {matches.length ? matches.map((match) => (
          <div key={match.id} className="split-match-card">
            <div className="split-match-copy">
              <div className="split-match-headline">
                <strong>{match.reviewLabel}</strong>
                <span className={`split-match-confidence is-${match.confidenceLabel.toLowerCase()}`}>{match.confidenceLabel}</span>
              </div>
              <div className="split-match-compare">
                <SplitMatchSide
                  label={messages.splits.existingSplitRecord}
                  date={match.splitDate}
                  description={match.splitDescription}
                  amountMinor={match.splitAmountMinor}
                />
                <SplitMatchSide
                  label={messages.splits.importedLedgerRow}
                  date={match.transactionDate}
                  description={match.transactionDescription}
                  amountMinor={match.amountMinor}
                />
              </div>
              <p className="split-match-deltas">
                {messages.splits.matchDeltaSummary(
                  match.dateDeltaDays,
                  formatService.money(match.amountDeltaMinor)
                )}
              </p>
            </div>
            <div className="split-match-actions">
              <button type="button" className="subtle-action" onClick={() => onDismissMatch(match.id)}>
                {messages.splits.keepSeparate}
              </button>
              <button type="button" className="dialog-primary" onClick={() => void onConfirmMatch(match)}>
                {messages.splits.match}
              </button>
            </div>
          </div>
        )) : (
          <p className="lede compact">{messages.splits.noMatches}</p>
        )}
      </div>
    </section>
  );
}

function SplitMatchSide({ label, date, description, amountMinor }) {
  return (
    <div className="split-match-side">
      <span>{label}</span>
      <strong>{description}</strong>
      <p>{messages.common.triplet(formatService.formatDate(date), formatService.money(amountMinor))}</p>
    </div>
  );
}
