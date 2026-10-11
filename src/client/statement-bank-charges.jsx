import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { summarizeStatementCharges } from "./statement-charges-model";

const { format: formatService } = moniesClient;

// The bank's charges on one statement card (late charge, interest, annual
// fee) and its notices (past due, penalty interest), as a rose attention
// banner. Nothing shows for a statement without them.
export function StatementBankCharges({ rows, notices }) {
  const summary = summarizeStatementCharges(rows, notices);
  if (!summary.hasAnything) {
    return null;
  }
  const kinds = messages.imports.statementChargeKinds;
  const list = (items) => items.map((item) => `${kinds[item.kind]} ${formatService.money(item.amountMinor)}`).join(" · ");
  return (
    <div className="statement-bank-charges" role="note">
      {summary.charges.length ? (
        <p>
          <strong>{messages.imports.statementChargesTitle}:</strong> {list(summary.charges)}
        </p>
      ) : null}
      {summary.reversals.length ? <p>{messages.imports.statementChargesReversed(list(summary.reversals))}</p> : null}
      {summary.notices.map((notice) => (
        <p key={notice.code}>
          {notice.code === "penalty_interest"
            ? messages.imports.statementNotices.penalty_interest(notice.annualRatePercent)
            : messages.imports.statementNotices.past_due}
        </p>
      ))}
    </div>
  );
}
