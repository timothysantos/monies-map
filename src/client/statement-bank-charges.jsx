import { importMessages } from "./copy/en-SG-imports";
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
  const kinds = importMessages.statementChargeKinds;
  const list = (items) => items.map((item) => `${kinds[item.kind]} ${formatService.money(item.amountMinor)}`).join(" · ");
  return (
    <div className="statement-bank-charges" role="note">
      {summary.charges.length ? (
        <p>
          <strong>{importMessages.statementChargesTitle}:</strong> {list(summary.charges)}
        </p>
      ) : null}
      {summary.reversals.length ? <p>{importMessages.statementChargesReversed(list(summary.reversals))}</p> : null}
      {summary.notices.map((notice) => (
        <p key={notice.code}>
          {notice.code === "penalty_interest"
            ? importMessages.statementNotices.penalty_interest(notice.annualRatePercent)
            : importMessages.statementNotices.past_due}
        </p>
      ))}
    </div>
  );
}
