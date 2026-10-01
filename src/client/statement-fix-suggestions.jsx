import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import "./statement-fix-suggestions.css";

const { format: formatService } = moniesClient;

// The statement check's suggested fixes for one statement card, from the
// preview's deterministic diagnosis (src/domain/statement-mismatch-
// diagnosis.ts). Strong suggestions are grouped under one action; a medium
// one is approved on its own; weak ones are listed to check, with no action.
// Approving a fix only changes the preview: the import commit writes it.
export function StatementFixSuggestions({
  accountId,
  statementEndDate,
  diagnosis,
  accounts,
  dismissedFindingIds,
  isSubmitting,
  onApplyStatementFixes,
  onUndoStatementFixes,
  onDismissStatementFindings,
  isAutomaticStatementFixes = false,
  onAutomaticStatementFixesChange = undefined
}) {
  const card = diagnosis?.cards?.find((item) => item.accountId === accountId);
  if (!card) {
    return null;
  }

  const findings = diagnosis.findings.filter((finding) => !dismissedFindingIds.includes(finding.id));
  const accountName = (id) => diagnosis.cards.find((item) => item.accountId === id)?.accountName
    ?? accounts.find((account) => account.id === id)?.name
    ?? "";
  const isOpenFix = (finding) => finding.fix && !finding.applied && finding.confidence !== "low";
  const moves = findings.filter((finding) => finding.kind === "wrong_account" && finding.accountId === accountId);
  const moveGroups = groupBy(moves.filter(isOpenFix), (finding) => finding.relatedAccountId);
  const appliedMoveGroups = groupBy(moves.filter((finding) => finding.applied), (finding) => finding.relatedAccountId);
  // Rows on this card whose entries sit on another card of the statement:
  // the move is offered there, where it explains the difference.
  const incomingMoves = findings.filter((finding) => (
    finding.kind === "wrong_account"
    && finding.relatedAccountId === accountId
    && finding.accountId !== accountId
    && isOpenFix(finding)
  ));
  const defers = findings.filter((finding) => finding.kind === "next_statement" && finding.accountId === accountId);
  const openDefers = defers.filter(isOpenFix);
  const appliedDefers = defers.filter((finding) => finding.applied);
  const toCheck = findings.filter((finding) => finding.accountId === accountId && !finding.applied && !isOpenFix(finding));
  const hasOpenFixes = moveGroups.size > 0 || openDefers.length > 0;

  if (!hasOpenFixes && !appliedMoveGroups.size && !appliedDefers.length && !incomingMoves.length && !toCheck.length && !card.laterStatementEntryCount) {
    return null;
  }

  return (
    <div className="statement-fix-list" aria-label={messages.imports.statementReconciliationTitle}>
      {Array.from(moveGroups.entries()).map(([toAccountId, group]) => (
        <FixGroup
          key={`move-${toAccountId}`}
          title={messages.imports.statementFixMoveTitle(group.length, accountName(toAccountId))}
          detail={messages.imports.statementFixMoveDetail({
            count: group.length,
            fromName: accountName(group[0].entry.accountId),
            toName: accountName(toAccountId),
            amount: sumEffect(group) ? formatService.money(Math.abs(sumEffect(group))) : "",
            closes: group.some((finding) => hasFact(finding, "closes_statement"))
          })}
          findings={group}
          actionLabel={messages.imports.statementFixMoveAction(group.length, accountName(toAccountId))}
          isSubmitting={isSubmitting}
          onApply={onApplyStatementFixes}
          onDismiss={onDismissStatementFindings}
          isAutomatic={isAutomaticStatementFixes}
          onAutomaticChange={onAutomaticStatementFixesChange}
        />
      ))}
      {openDefers.length ? (
        <FixGroup
          title={messages.imports.statementFixDeferTitle(openDefers.length)}
          detail={messages.imports.statementFixDeferDetail({
            count: openDefers.length,
            endDate: formatService.formatDateOnly(statementEndDate),
            amount: formatService.money(Math.abs(sumEffect(openDefers))),
            closes: openDefers.some((finding) => hasFact(finding, "closes_statement"))
          })}
          findings={openDefers}
          actionLabel={messages.imports.statementFixDeferAction(openDefers.length)}
          isSubmitting={isSubmitting}
          onApply={onApplyStatementFixes}
          onDismiss={onDismissStatementFindings}
          isAutomatic={isAutomaticStatementFixes}
          onAutomaticChange={onAutomaticStatementFixesChange}
        />
      ) : null}
      {Array.from(appliedMoveGroups.entries()).map(([toAccountId, group]) => (
        <AppliedFixes
          key={`applied-move-${toAccountId}`}
          message={messages.imports.statementFixMoveApplied(group.length, accountName(toAccountId))}
          findings={group}
          isSubmitting={isSubmitting}
          onUndo={onUndoStatementFixes}
        />
      ))}
      {appliedDefers.length ? (
        <AppliedFixes
          message={messages.imports.statementFixDeferApplied(appliedDefers.length, formatService.formatDateOnly(appliedDefers[0].fix.postDate))}
          findings={appliedDefers}
          isSubmitting={isSubmitting}
          onUndo={onUndoStatementFixes}
        />
      ) : null}
      {incomingMoves.length ? (
        <p className="lede compact">{messages.imports.statementFixDestinationNote(incomingMoves.length, accountName(incomingMoves[0].accountId))}</p>
      ) : null}
      {hasOpenFixes && card.projectedDeltaMinor !== 0 ? (
        <p className="lede compact">{messages.imports.statementFixUnexplained(formatService.money(Math.abs(card.projectedDeltaMinor)))}</p>
      ) : null}
      {toCheck.length ? (
        <div className="statement-fix-check">
          <strong>{messages.imports.statementFixAlsoCheck}</strong>
          <ul>
            {toCheck.map((finding) => (
              <li key={finding.id}>{describeFindingToCheck(finding, accountName)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {card.laterStatementEntryCount ? (
        <div className="statement-fix-later">
          <span>{messages.imports.statementFixLaterEntries(card.laterStatementEntryCount)}</span>
          {card.laterStatementEntries.map((entry) => (
            <div key={entry.id} className="import-overlap-entry-row">
              <span className="import-overlap-entry-date">{formatService.formatDateOnly(entry.transactionDate)}</span>
              <span className="import-overlap-entry-description">{entry.description}</span>
              <strong className="import-overlap-entry-amount">{formatService.money(Math.abs(entry.signedAmountMinor))}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// One action for every strong suggestion in the group; a medium one is
// approved on its own so the user looks at it first.
function FixGroup({ title, detail, findings, actionLabel, isSubmitting, onApply, onDismiss, isAutomatic, onAutomaticChange }) {
  const strong = findings.filter((finding) => finding.confidence === "high");
  const toReview = findings.filter((finding) => finding.confidence !== "high");
  return (
    <div className="import-card statement-fix-card">
      <strong>{title}</strong>
      <p className="lede compact">{detail}</p>
      <div className="statement-fix-rows">
        {findings.map((finding) => (
          <FixRow
            key={finding.id}
            finding={finding}
            isSubmitting={isSubmitting}
            onApply={finding.confidence === "high" ? undefined : onApply}
          />
        ))}
      </div>
      <div className="statement-fix-actions">
        {strong.length ? (
          <button
            type="button"
            className="subtle-action statement-fix-apply"
            disabled={isSubmitting}
            onClick={() => onApply(strong.map((finding) => finding.fix))}
          >
            {strong.length === findings.length ? actionLabel : messages.imports.statementFixApplyClear(strong.length)}
          </button>
        ) : null}
        <button
          type="button"
          className="subtle-action"
          disabled={isSubmitting}
          onClick={() => onDismiss([...strong, ...toReview].map((finding) => finding.id))}
        >
          {messages.imports.statementFixKeep}
        </button>
        {strong.length && onAutomaticChange ? (
          <label className="statement-fix-automatic">
            <input
              type="checkbox"
              checked={isAutomatic}
              onChange={(event) => onAutomaticChange(event.target.checked)}
            />
            {messages.imports.statementFixAutomatic}
          </label>
        ) : null}
      </div>
    </div>
  );
}

function FixRow({ finding, isSubmitting, onApply }) {
  const entry = finding.entry;
  const statementRow = finding.statementRow;
  const transactionDate = statementRow?.transactionDate ?? statementRow?.postedDate ?? entry.transactionDate;
  return (
    <div className="import-overlap-entry-row statement-fix-row">
      <span className="import-overlap-entry-description">
        {entry.description}
        <span className="import-history-inline">
          {messages.imports.statementFixRowDates(
            formatService.formatDateOnly(transactionDate),
            statementRow?.postedDate ? formatService.formatDateOnly(statementRow.postedDate) : undefined
          )}
        </span>
      </span>
      <strong className="import-overlap-entry-amount">{formatService.money(Math.abs(entry.signedAmountMinor))}</strong>
      {onApply ? (
        <span className="statement-fix-row-review">
          <span className="pill warning">{messages.imports.statementFixCheckThisOne}</span>
          <button type="button" className="subtle-action" disabled={isSubmitting} onClick={() => onApply([finding.fix])}>
            {finding.fix.kind === "move_to_statement_account"
              ? messages.imports.statementFixMoveOne
              : messages.imports.statementFixDeferAction(1)}
          </button>
        </span>
      ) : null}
    </div>
  );
}

function AppliedFixes({ message, findings, isSubmitting, onUndo }) {
  return (
    <div className="import-card statement-fix-card statement-fix-applied">
      <div className="statement-fix-applied-head">
        <span>{message}</span>
        <button type="button" className="subtle-action" disabled={isSubmitting} onClick={() => onUndo(findings.map((finding) => finding.fix))}>
          {messages.imports.statementFixUndo}
        </button>
      </div>
      <div className="statement-fix-rows">
        {findings.map((finding) => (
          <div key={finding.id} className="import-overlap-entry-row">
            <span className="import-overlap-entry-description">{finding.entry.description}</span>
            <strong className="import-overlap-entry-amount">{formatService.money(Math.abs(finding.entry.signedAmountMinor))}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function describeFindingToCheck(finding, accountName) {
  const explain = messages.imports.statementFixExplanation;
  const amount = (minor) => formatService.money(Math.abs(minor ?? 0));
  const description = finding.entry?.description ?? finding.statementRow?.description ?? "";
  switch (finding.kind) {
    case "duplicate_entry":
      return explain.duplicate_entry(description, amount(finding.entry.signedAmountMinor), finding.relatedAccountId ? accountName(finding.relatedAccountId) : "");
    case "amount_differs":
      return explain.amount_differs(description, amount(finding.entry.signedAmountMinor), amount(finding.statementRow.signedAmountMinor));
    case "excluded_statement_row":
      return explain.excluded_statement_row(description, amount(finding.statementRow.signedAmountMinor));
    case "opening_balance_gap":
      return explain.opening_balance_gap(amount(finding.effectMinor));
    case "wrong_account":
      return explain.wrong_account(description, amount(finding.entry.signedAmountMinor), finding.entry.accountName);
    case "next_statement":
      return explain.next_statement(description, amount(finding.entry.signedAmountMinor));
    default:
      return explain.not_on_statement(description, amount(finding.entry?.signedAmountMinor));
  }
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  }
  return groups;
}

function sumEffect(findings) {
  return findings.reduce((total, finding) => total + (finding.effectMinor ?? 0), 0);
}

function hasFact(finding, code) {
  return finding.facts.some((fact) => fact.code === code);
}
