import { CheckCircle2, CircleAlert } from "lucide-react";

import { DeleteRowButton } from "./delete-row-button";
import { describeStatementDifference } from "./statement-difference-model";
import { getPersonColourVars } from "./person-colour";
import { moneyToneClass } from "./money-tone-class";
import { importMessages } from "./copy/en-SG-imports";
import { statementDifferenceMessages } from "./copy/en-SG-statement-difference";
import { messages } from "./copy/en-SG";
import { formatDateOnly, formatMonthLabel } from "./formatters";
import "./import-account-check.css";

// One line per bank or card account: the latest statement saved, whether it
// balances (and what explains it when it does not), how far the entries go
// and the statement months still to bring in. Open while anything needs a
// look; one summary line once every account balances.
export function ImportAccountCheck({ checks = [], onRemoveEntry = undefined }) {
  if (!checks.length) {
    return null;
  }
  const lines = checks.map((check) => ({
    check,
    line: check.balance === "no_statement" ? null : describeStatementDifference(check)
  }));
  const balancedCount = lines.filter(({ line }) => line?.tone === "in").length;
  const needsLook = lines.some(({ check, line }) => line?.tone === "short" || check.missingStatementMonths.length > 0);

  return (
    <details className="import-account-check" open={needsLook}>
      <summary>
        {needsLook
          ? <CircleAlert size={16} aria-hidden="true" />
          : <CheckCircle2 size={16} aria-hidden="true" />}
        <strong>{importMessages.accountCheckTitle}</strong>
        <span>{importMessages.accountCheckSummary(balancedCount, checks.length)}</span>
      </summary>
      <ul className="import-account-check-list">
        {lines.map(({ check, line }) => (
          <li
            key={check.accountId}
            className="import-account-check-row"
            style={getPersonColourVars(check.ownerPersonId ?? check.ownerLabel)}
            data-balance={check.balance}
          >
            <strong className="import-account-check-name">
              {messages.common.triplet(check.accountName, check.ownerLabel)}
            </strong>
            <span className="import-account-check-statement">
              {check.latestStatementEndDate
                ? importMessages.accountCheckStatementTo(formatDateOnly(check.latestStatementEndDate))
                : check.latestStatementMonth
                  ? importMessages.accountCheckStatementMonth(formatMonthLabel(check.latestStatementMonth))
                  : importMessages.accountCheckNoStatement}
            </span>
            <span className={`import-account-check-balance ${line ? moneyToneClass(line.tone) : ""}`}>
              {line ? line.headline : importMessages.accountCheckNothingToCompare}
            </span>
            <span className="import-account-check-entries">
              {check.latestEntryDate
                ? importMessages.accountCheckEntriesTo(formatDateOnly(check.latestEntryDate))
                : importMessages.accountCheckNoEntries}
            </span>
            {line?.details.length || check.missingStatementMonths.length ? (
              <div className="import-account-check-detail">
                {line?.details.map((detail) => <p key={detail}>{detail}</p>)}
                {line?.removableEntry && onRemoveEntry ? (
                  <DeleteRowButton
                    label={line.removableEntry.label}
                    triggerLabel={statementDifferenceMessages.removeEntry}
                    confirmLabel={statementDifferenceMessages.removeEntryConfirm}
                    prompt={statementDifferenceMessages.removeEntryPrompt(line.removableEntry.label)}
                    buttonClassName="import-account-check-remove"
                    onConfirm={() => onRemoveEntry(line.removableEntry)}
                  >
                    {statementDifferenceMessages.removeEntry}
                  </DeleteRowButton>
                ) : null}
                {check.missingStatementMonths.length ? (
                  <p>{importMessages.accountCheckMissing(check.missingStatementMonths.map(formatMonthLabel))}</p>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
