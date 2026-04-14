import { messages } from "./copy/en-SG";
import { formatDate, money } from "./formatters";

export function SplitMatchesList({ matches, pendingMatchCount, onDismissMatch, onConfirmMatch }) {
  return (
    <section className="split-list-section">
      <div className="panel-subhead">
        <div>
          <h2>{messages.splits.matches}</h2>
          <p className="lede compact">{pendingMatchCount ? messages.splits.toReview(pendingMatchCount) : messages.splits.noMatches}</p>
        </div>
      </div>
      <div className="split-match-list">
        {matches.length ? matches.map((match) => (
          <div key={match.id} className="split-match-card">
            <div>
              <strong>{match.reviewLabel}</strong>
              <p>{messages.common.triplet(formatDate(match.transactionDate), money(match.amountMinor), match.confidenceLabel)}</p>
              <p>{match.transactionDescription}</p>
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
