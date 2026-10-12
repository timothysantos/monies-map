import { importMessages } from "./copy/en-SG-imports";
import { settingsMessages } from "./copy/en-SG-settings";
import { moniesClient } from "./monies-client-service";
import { FixGroup, groupBy, hasFact, sumEffect } from "./statement-fix-suggestions";

const { format: formatService } = moniesClient;

// The Settings statement comparison's suggested fixes for saved data, from
// the same deterministic diagnosis as the import review, run after commit:
// an entry the statement lists under another card moves there, and a second
// copy of a purchase the statement already matched is removed. Unlike the
// import review, applying writes straight away (with an undo), and nothing
// is ever applied without asking.
export function StatementCorrectionSuggestions({
  result,
  accounts,
  correction,
  dismissedFindingIds = [],
  isSubmitting,
  onApply,
  onUndo,
  onDismiss
}) {
  const diagnosis = result.statementDiagnosis;
  const findings = (diagnosis?.findings ?? []).filter((finding) => !dismissedFindingIds.includes(finding.id));
  const accountName = (id) => diagnosis?.cards.find((card) => card.accountId === id)?.accountName
    ?? accounts.find((account) => account.id === id)?.name
    ?? "";
  const isOpen = (finding) => finding.fix && finding.confidence !== "low";
  const moveGroups = groupBy(
    findings.filter((finding) => finding.kind === "wrong_account" && isOpen(finding)),
    (finding) => `${finding.fix.fromAccountId}>${finding.fix.toAccountId}`
  );
  const removalGroups = groupBy(
    findings.filter((finding) => finding.kind === "duplicate_entry" && isOpen(finding)),
    (finding) => finding.fix.accountId
  );
  const blocked = findings.filter((finding) => !finding.fix && hasFact(finding, "unbalances_saved_statement"));
  const targetCard = diagnosis?.cards.find((card) => card.accountName === result.accountName);

  if (!correction && !moveGroups.size && !removalGroups.size && !blocked.length) {
    return null;
  }

  const fixGroupProps = { isSubmitting, onDismiss };
  return (
    <div className="settings-statement-compare-block statement-fix-list statement-correction-list">
      <h3>{settingsMessages.statementCorrectionTitle}</h3>
      {correction ? (
        <div className="import-card statement-fix-card statement-fix-applied">
          <div className="statement-fix-applied-head">
            <span>
              {correction.summary}
              {targetCard?.deltaMinor === 0 ? ` ${settingsMessages.statementCorrectionMatches}` : ""}
            </span>
            <button type="button" className="subtle-action" disabled={isSubmitting} onClick={onUndo}>
              {importMessages.statementFixUndo}
            </button>
          </div>
        </div>
      ) : null}
      {Array.from(moveGroups.values()).map((group) => {
        const { fromAccountId, toAccountId } = group[0].fix;
        const toName = accountName(toAccountId);
        return (
          <FixGroup
            key={`move-${fromAccountId}-${toAccountId}`}
            {...fixGroupProps}
            title={importMessages.statementFixMoveTitle(group.length, toName)}
            detail={settingsMessages.statementCorrectionMoveDetail({
              count: group.length,
              fromName: accountName(fromAccountId),
              toName,
              amount: formatService.money(Math.abs(sumEffect(group))),
              closes: group.some((finding) => hasFact(finding, "closes_statement"))
            })}
            findings={group}
            actionLabel={importMessages.statementFixMoveAction(group.length, toName)}
            onApply={(fixes) => onApply(fixes, settingsMessages.statementCorrectionMoved(fixes.length, toName))}
          />
        );
      })}
      {Array.from(removalGroups.entries()).map(([accountId, group]) => {
        const otherAccountIds = new Set(group.map((finding) => finding.relatedAccountId).filter(Boolean));
        return (
          <FixGroup
            key={`remove-${accountId}`}
            {...fixGroupProps}
            title={settingsMessages.statementCorrectionRemoveTitle(group.length)}
            detail={settingsMessages.statementCorrectionRemoveDetail({
              count: group.length,
              accountName: accountName(accountId),
              otherName: otherAccountIds.size === 1 ? accountName(Array.from(otherAccountIds)[0]) : "",
              amount: formatService.money(Math.abs(sumEffect(group))),
              closes: group.some((finding) => hasFact(finding, "closes_statement"))
            })}
            findings={group}
            actionLabel={settingsMessages.statementCorrectionRemoveAction(group.length)}
            onApply={(fixes) => onApply(fixes, settingsMessages.statementCorrectionRemoved(fixes.length, accountName(accountId)))}
          />
        );
      })}
      {blocked.length ? (
        <div className="statement-fix-check">
          <strong>{importMessages.statementFixAlsoCheck}</strong>
          <ul>
            {blocked.map((finding) => {
              const fact = finding.facts.find((item) => item.code === "unbalances_saved_statement");
              return (
                <li key={finding.id}>
                  {settingsMessages.statementCorrectionBlocked(
                    finding.entry.description,
                    formatService.money(Math.abs(finding.entry.signedAmountMinor)),
                    fact.accountName,
                    formatService.formatMonthLabel(fact.month)
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
