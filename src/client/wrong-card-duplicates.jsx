import { ImportRollbackConfirm } from "./import-rollback-confirm";
import { importMessages } from "./copy/en-SG-imports";
import { moniesClient } from "./monies-client-service";
import { groupBy } from "./statement-fix-suggestions";
import "./statement-fix-suggestions.css";

const { format: formatService } = moniesClient;

// Apple Pay entries this card's file does not list although the same
// purchase is a bank row on another card (src/domain/wrong-card-apple-pay-
// duplicate.ts). A clear one is offered for removal, asked about in a
// dialog first; a doubtful one is only a note. Confirming changes the
// preview only: the import commit removes the entry, after checking again,
// and rolling the import back brings it back. The same card family as the
// statement fixes (statement-fix-suggestions.jsx).
export function WrongCardDuplicates({ items, confirmedIds, keptIds, isSubmitting, onConfirm, onKeep, onUndo }) {
  const open = items.filter((item) => item.confidence === "high" && !keptIds.includes(item.transactionId));
  const toConfirm = open.filter((item) => !confirmedIds.includes(item.transactionId));
  const confirmed = open.filter((item) => confirmedIds.includes(item.transactionId));
  const notes = items.filter((item) => item.confidence === "medium");
  const groupKey = (item) => `${item.entry.accountId}|${item.twin.accountId}`;
  const total = (group) => formatService.money(group.reduce((sum, item) => sum + item.entry.amountMinor, 0));

  if (!toConfirm.length && !confirmed.length && !notes.length) {
    return null;
  }

  return (
    <div className="statement-fix-list wrong-card-list" aria-label={importMessages.wrongCardListLabel}>
      {Array.from(groupBy(toConfirm, groupKey).values()).map((group) => {
        const [{ entry, twin, coverage }] = group;
        const amount = total(group);
        return (
          <div key={groupKey(group[0])} className="import-card statement-fix-card wrong-card-card">
            <strong>{importMessages.wrongCardTitle(group.length, entry.accountName)}</strong>
            <p className="lede compact">
              {importMessages.wrongCardDetail({
                count: group.length,
                entryAccountName: entry.accountName,
                twinAccountName: twin.accountName,
                amount,
                isEarlierFile: coverage.kind === "earlier_import",
                fileDate: coverage.importedAt ? formatService.formatDateOnly(coverage.importedAt.slice(0, 10)) : ""
              })}
            </p>
            <div className="statement-fix-rows">
              {group.map((item) => <WrongCardRow key={item.transactionId} item={item} />)}
            </div>
            <div className="statement-fix-actions">
              <ImportRollbackConfirm
                bareTrigger
                buttonClassName="dialog-primary statement-fix-apply"
                triggerLabel={importMessages.wrongCardRemoveAction(entry.accountName)}
                title={importMessages.wrongCardConfirmTitle(group.length, entry.accountName)}
                confirmLabel={importMessages.wrongCardConfirm(group.length)}
                prompt={importMessages.wrongCardConfirmDetail({ count: group.length, entryAccountName: entry.accountName, twinAccountName: twin.accountName, amount })}
                onConfirm={() => onConfirm(group.map((item) => item.transactionId))}
              />
              <button
                type="button"
                className="statement-fix-keep"
                disabled={isSubmitting}
                onClick={() => onKeep(group.map((item) => item.transactionId))}
              >
                {importMessages.statementFixKeep}
              </button>
            </div>
          </div>
        );
      })}
      {Array.from(groupBy(confirmed, groupKey).values()).map((group) => (
        <div key={`confirmed-${groupKey(group[0])}`} className="import-card statement-fix-card statement-fix-applied wrong-card-card">
          <div className="statement-fix-applied-head">
            <span>{importMessages.wrongCardApplied(group.length, group[0].entry.accountName)}</span>
            <button type="button" className="subtle-action" disabled={isSubmitting} onClick={() => onUndo(group.map((item) => item.transactionId))}>
              {importMessages.statementFixUndo}
            </button>
          </div>
          <div className="statement-fix-rows">
            {group.map((item) => (
              <div key={item.transactionId} className="import-overlap-entry-row">
                <span className="import-overlap-entry-description">{item.entry.description}</span>
                <strong className="import-overlap-entry-amount">{formatService.money(item.entry.amountMinor)}</strong>
              </div>
            ))}
          </div>
        </div>
      ))}
      {notes.length ? (
        <div className="statement-fix-check wrong-card-notes">
          <strong>{importMessages.statementFixAlsoCheck}</strong>
          <ul>
            {notes.map((item) => (
              <li key={item.transactionId}>
                {importMessages.wrongCardCheckThisOne({
                  description: item.entry.description,
                  amount: formatService.money(item.entry.amountMinor),
                  entryAccountName: item.entry.accountName,
                  twinAccountName: item.twin.accountName,
                  twinDescription: item.twin.description,
                  twinDate: formatService.formatDateOnly(item.twin.date),
                  isLinked: Boolean(item.isLinked)
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// One stray entry and the proof: the other card's bank row of the purchase.
function WrongCardRow({ item }) {
  return (
    <div className="import-overlap-entry-row statement-fix-row">
      <span className="import-overlap-entry-description">
        {item.entry.description}
        <span className="import-history-inline">{formatService.formatDateOnly(item.entry.date)}</span>
        <span className="import-history-inline">
          {importMessages.wrongCardEvidence({
            twinAccountName: item.twin.accountName,
            twinDescription: item.twin.description,
            twinDate: formatService.formatDateOnly(item.twin.date),
            isInThisFile: item.twin.kind === "this_file",
            importedDate: item.twin.importedAt ? formatService.formatDateOnly(item.twin.importedAt.slice(0, 10)) : ""
          })}
        </span>
      </span>
      <strong className="import-overlap-entry-amount">{formatService.money(item.entry.amountMinor)}</strong>
    </div>
  );
}
