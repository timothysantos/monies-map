import { messages } from "./copy/en-SG";
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
      <h3>{messages.settings.statementCorrectionTitle}</h3>
      {correction ? (
        <div className="import-card statement-fix-card statement-fix-applied">
          <div className="statement-fix-applied-head">
            <span>
              {correction.summary}
              {targetCard?.deltaMinor === 0 ? ` ${messages.settings.statementCorrectionMatches}` : ""}
            </span>
            <button type="button" className="subtle-action" disabled={isSubmitting} onClick={onUndo}>
              {messages.imports.statementFixUndo}
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
            title={messages.imports.statementFixMoveTitle(group.length, toName)}
            detail={messages.settings.statementCorrectionMoveDetail({
              count: group.length,
              fromName: accountName(fromAccountId),
              toName,
              amount: formatService.money(Math.abs(sumEffect(group))),
              closes: group.some((finding) => hasFact(finding, "closes_statement"))
            })}
            findings={group}
            actionLabel={messages.imports.statementFixMoveAction(group.length, toName)}
            onApply={(fixes) => onApply(fixes, messages.settings.statementCorrectionMoved(fixes.length, toName))}
          />
        );
      })}
      {Array.from(removalGroups.entries()).map(([accountId, group]) => {
        const otherAccountIds = new Set(group.map((finding) => finding.relatedAccountId).filter(Boolean));
        return (
          <FixGroup
            key={`remove-${accountId}`}
            {...fixGroupProps}
            title={messages.settings.statementCorrectionRemoveTitle(group.length)}
            detail={messages.settings.statementCorrectionRemoveDetail({
              count: group.length,
              accountName: accountName(accountId),
              otherName: otherAccountIds.size === 1 ? accountName(Array.from(otherAccountIds)[0]) : "",
              amount: formatService.money(Math.abs(sumEffect(group))),
              closes: group.some((finding) => hasFact(finding, "closes_statement"))
            })}
            findings={group}
            actionLabel={messages.settings.statementCorrectionRemoveAction(group.length)}
            onApply={(fixes) => onApply(fixes, messages.settings.statementCorrectionRemoved(fixes.length, accountName(accountId)))}
          />
        );
      })}
      {blocked.length ? (
        <div className="statement-fix-check">
          <strong>{messages.imports.statementFixAlsoCheck}</strong>
          <ul>
            {blocked.map((finding) => {
              const fact = finding.facts.find((item) => item.code === "unbalances_saved_statement");
              return (
                <li key={finding.id}>
                  {messages.settings.statementCorrectionBlocked(
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
