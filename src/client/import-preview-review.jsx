import { getAccountSelectOptions } from "./account-display";
import { messages } from "./copy/en-SG";
import {
  formatDate,
  formatDateOnly,
  formatMinorInput,
  formatMonthLabel,
  formatStatementReconciliationLine,
  money,
  parseMoneyInput
} from "./formatters";

// Preview review surfaces the import guardrails while ImportsPanel keeps ownership of the mutable draft.
export function ImportPreviewReview({
  preview,
  accounts,
  knownAccountNames,
  detectedPreviewAccountNames,
  unknownPreviewAccountNames,
  unknownCategoryMode,
  showStatementAccountMapping,
  visibleOverlapImports,
  previewDuplicateRowCount,
  statementReconciliations,
  hasStatementReconciliationMismatch,
  statementCheckpoints,
  hasDuplicateCheckpointAccounts,
  duplicateCheckpointAccounts,
  isSubmitting,
  onRemapPreviewAccount,
  onDismissOverlap,
  onRefreshStatementReconciliation,
  onUpdateStatementCheckpoint
}) {
  if (!preview) {
    return null;
  }

  return (
    <>
      {showStatementAccountMapping ? (
        <StatementAccountMapping
          accounts={accounts}
          knownAccountNames={knownAccountNames}
          detectedPreviewAccountNames={detectedPreviewAccountNames}
          unknownPreviewAccountNames={unknownPreviewAccountNames}
          onRemapPreviewAccount={onRemapPreviewAccount}
        />
      ) : null}

      {preview.unknownCategories?.length ? (
        <UnknownCategories
          categoryNames={preview.unknownCategories}
          unknownCategoryMode={unknownCategoryMode}
        />
      ) : null}

      <PreviewGuardrailPills
        preview={preview}
        previewDuplicateRowCount={previewDuplicateRowCount}
        visibleOverlapImports={visibleOverlapImports}
      />

      {visibleOverlapImports.length ? (
        <OverlapImports
          imports={visibleOverlapImports}
          onDismissOverlap={onDismissOverlap}
        />
      ) : null}

      {statementReconciliations.length ? (
        <StatementBalanceCheck
          reconciliations={statementReconciliations}
          hasMismatch={hasStatementReconciliationMismatch}
          isSubmitting={isSubmitting}
          onRefreshStatementReconciliation={onRefreshStatementReconciliation}
        />
      ) : null}

      {statementCheckpoints.length ? (
        <StatementCheckpointDrafts
          accounts={accounts}
          knownAccountNames={knownAccountNames}
          statementCheckpoints={statementCheckpoints}
          hasDuplicateCheckpointAccounts={hasDuplicateCheckpointAccounts}
          duplicateCheckpointAccounts={duplicateCheckpointAccounts}
          onUpdateStatementCheckpoint={onUpdateStatementCheckpoint}
        />
      ) : null}

      {previewDuplicateRowCount ? (
        <div className="import-warning import-warning-attention">
          <strong>{messages.imports.duplicateMatchesTitle}</strong>
          <p className="lede compact">{messages.imports.duplicateMatchesDetail}</p>
        </div>
      ) : null}
    </>
  );
}

function StatementAccountMapping({
  accounts,
  knownAccountNames,
  detectedPreviewAccountNames,
  unknownPreviewAccountNames,
  onRemapPreviewAccount
}) {
  const accountOptions = getAccountSelectOptions(accounts, { valueKey: "id" });
  const accountOptionsByName = accounts.reduce((optionsByName, account) => {
    const current = optionsByName.get(account.name) ?? [];
    current.push(account);
    optionsByName.set(account.name, current);
    return optionsByName;
  }, new Map());

  return (
    <div className="import-warning import-warning-action">
      <strong>{unknownPreviewAccountNames.length ? messages.imports.unknownAccounts : messages.imports.accountMappingTitle}</strong>
      <p className="lede compact">{messages.imports.accountMappingDetail}</p>
      <div className="statement-account-map-grid">
        {detectedPreviewAccountNames.map((accountName) => (
          <label key={accountName} className="entries-filter statement-account-map-row">
            <span className="entries-filter-label">{messages.imports.detectedAccount(accountName)}</span>
            <select
              className="table-edit-input"
              value={(accountOptionsByName.get(accountName) ?? []).length === 1 ? accountOptionsByName.get(accountName)[0].id : ""}
              onChange={(event) => onRemapPreviewAccount(accountName, event.target.value)}
            >
              <option value="">{messages.imports.chooseAccount}</option>
              {accountOptions.map((account) => (
                <option key={account.id} value={account.value}>{account.label}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}

function UnknownCategories({ categoryNames, unknownCategoryMode }) {
  return (
    <div className="import-warning import-warning-attention">
      <strong>{messages.imports.unknownCategories}</strong>
      <div className="pill-row dense">
        {categoryNames.map((categoryName) => (
          <span key={categoryName} className="pill warning">{categoryName}</span>
        ))}
      </div>
      <p className="lede compact">
        {unknownCategoryMode === "other" ? messages.imports.categoryFallbackHelp : messages.imports.categoryFallbackBlocked}
      </p>
    </div>
  );
}

function PreviewGuardrailPills({ preview, previewDuplicateRowCount, visibleOverlapImports }) {
  return (
    <div className="pill-row dense">
      {preview.startDate && preview.endDate ? (
        <span className="pill">{messages.imports.previewCoverage(formatDateOnly(preview.startDate), formatDateOnly(preview.endDate))}</span>
      ) : null}
      {previewDuplicateRowCount ? (
        <span className="pill warning">{messages.imports.duplicateCandidates(previewDuplicateRowCount)}</span>
      ) : null}
      {visibleOverlapImports.length ? (
        <span className="pill warning">{messages.imports.overlappingImports(visibleOverlapImports.length)}</span>
      ) : null}
    </div>
  );
}

function OverlapImports({ imports, onDismissOverlap }) {
  return (
    <div className="import-warning import-warning-overlap">
      <strong>{messages.imports.previewOverlapTitle}</strong>
      <p className="lede compact">{messages.imports.previewOverlapDetail}</p>
      <div className="stack">
        {imports.map((item) => (
          <div key={item.id} className="import-card import-card-compact">
            <div className="import-history-main">
              <strong>{item.sourceLabel}</strong>
              <span className="import-history-inline">
                {messages.common.triplet(
                  item.importedAt ? formatDate(item.importedAt) : messages.common.emptyValue,
                  messages.imports.transactionCount(item.transactionCount),
                  item.sourceType ? item.sourceType.toUpperCase() : messages.common.emptyValue
                )}
              </span>
              {item.startDate && item.endDate ? (
                <span className="import-history-inline">{messages.imports.importCoverage(formatDateOnly(item.startDate), formatDateOnly(item.endDate))}</span>
              ) : null}
              {item.accountNames.length ? <span className="import-history-inline">{item.accountNames.join(", ")}</span> : null}
            </div>
            <div className="import-meta import-meta-compact">
              <button type="button" className="subtle-action" onClick={() => onDismissOverlap(item.id)}>
                {messages.imports.dismissOverlap}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatementBalanceCheck({ reconciliations, hasMismatch, isSubmitting, onRefreshStatementReconciliation }) {
  return (
    <div className={`import-warning ${hasMismatch ? "import-warning-attention" : "import-warning-reconciled"}`}>
      <div className="import-warning-head">
        <div>
          <strong>{messages.imports.statementReconciliationTitle}</strong>
          <p className="lede compact">
            {hasMismatch
              ? messages.imports.statementReconciliationMismatchDetail
              : messages.imports.statementReconciliationMatchedDetail}
          </p>
        </div>
        <button type="button" className="subtle-action" onClick={onRefreshStatementReconciliation} disabled={isSubmitting}>
          {messages.imports.statementReconciliationRefresh}
        </button>
      </div>
      <div className="stack">
        {reconciliations.map((item) => (
          <div key={`${item.accountName}-${item.checkpointMonth}`} className="import-card import-card-compact statement-reconciliation-row">
            <div className="import-history-main">
              <strong>{messages.imports.statementReconciliationAccount(item.accountName, formatMonthLabel(item.checkpointMonth))}</strong>
              {item.statementStartDate && item.statementEndDate ? (
                <span className="import-history-inline">{messages.imports.importCoverage(formatDateOnly(item.statementStartDate), formatDateOnly(item.statementEndDate))}</span>
              ) : null}
              <span className="import-history-inline">{formatStatementReconciliationLine(item)}</span>
            </div>
            <div className="import-meta import-meta-compact">
              <span className={`pill ${item.status === "matched" ? "success" : "warning"}`}>
                {messages.imports.statementReconciliationStatus[item.status]}
              </span>
              {item.deltaMinor != null && item.deltaMinor !== 0 ? (
                <p>{messages.imports.statementReconciliationDelta(money(Math.abs(item.deltaMinor)))}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatementCheckpointDrafts({
  accounts,
  knownAccountNames,
  statementCheckpoints,
  hasDuplicateCheckpointAccounts,
  duplicateCheckpointAccounts,
  onUpdateStatementCheckpoint
}) {
  const accountOptions = getAccountSelectOptions(accounts, { valueKey: "id" });

  return (
    <div className="import-warning import-warning-review">
      <strong>{messages.imports.statementCheckpointsTitle(statementCheckpoints.length)}</strong>
      <p className="lede compact">{messages.imports.statementCheckpointsDetail(statementCheckpoints.length)}</p>
      {hasDuplicateCheckpointAccounts ? (
        <p className="form-error">{messages.imports.duplicateCheckpointAccounts(duplicateCheckpointAccounts.join(", "))}</p>
      ) : null}
      <div className="statement-checkpoint-grid">
        {statementCheckpoints.map((checkpoint, index) => (
          <div key={`${checkpoint.accountName}-${index}`} className="statement-checkpoint-row">
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.statementCheckpointAccount}</span>
              <select
                className="table-edit-input"
                value={checkpoint.accountId ?? accounts.find((account) => account.name === checkpoint.accountName)?.id ?? checkpoint.accountName}
                onChange={(event) => {
                  const nextAccount = accounts.find((account) => account.id === event.target.value);
                  onUpdateStatementCheckpoint(index, {
                    accountId: nextAccount?.id,
                    accountName: nextAccount?.name ?? event.target.value
                  });
                }}
              >
                {checkpoint.accountName && !knownAccountNames.has(checkpoint.accountName) ? (
                  <option value={checkpoint.accountName}>{checkpoint.accountName}</option>
                ) : null}
                {accountOptions.map((account) => (
                  <option key={account.id} value={account.value}>{account.label}</option>
                ))}
              </select>
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.statementCheckpointMonth}</span>
              <input className="table-edit-input" type="month" value={checkpoint.checkpointMonth} onChange={(event) => onUpdateStatementCheckpoint(index, { checkpointMonth: event.target.value })} />
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.statementCheckpointStart}</span>
              <input className="table-edit-input" type="date" value={checkpoint.statementStartDate ?? ""} onChange={(event) => onUpdateStatementCheckpoint(index, { statementStartDate: event.target.value })} />
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.statementCheckpointEnd}</span>
              <input className="table-edit-input" type="date" value={checkpoint.statementEndDate ?? ""} onChange={(event) => onUpdateStatementCheckpoint(index, { statementEndDate: event.target.value })} />
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.statementCheckpointBalance}</span>
              <input className="table-edit-input" value={formatMinorInput(checkpoint.statementBalanceMinor)} onChange={(event) => onUpdateStatementCheckpoint(index, { statementBalanceMinor: parseMoneyInput(event.target.value, checkpoint.statementBalanceMinor) })} />
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.statementCheckpointNote}</span>
              <input className="table-edit-input" value={checkpoint.note ?? ""} onChange={(event) => onUpdateStatementCheckpoint(index, { note: event.target.value })} />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
