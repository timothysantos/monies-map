import { ChevronRight, SquarePen } from "lucide-react";

import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { StatementCompareResultView } from "./statement-compare";
import { DeleteRowButton } from "./ui-components";

const { accounts: accountService, format: formatService } = moniesClient;

// Account settings stay presentational here; SettingsPanel owns API calls and refresh sequencing.
export function SettingsAccountsSection({
  accounts,
  categories,
  people,
  isOpen,
  isSubmitting,
  statementComparePanel,
  statementCompareResult,
  statementCompareStatus,
  onToggle,
  onCreateAccount,
  onEditAccount,
  onArchiveAccount,
  onReconcileAccount,
  onOpenStatementCompare,
  onCloseStatementCompare,
  onUploadStatementCompare,
  onRowsMatched,
  onEntryAdded
}) {
  return (
    <section className="chart-card settings-card">
      <button
        type="button"
        className="settings-section-toggle"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <div className="settings-section-toggle-copy">
          <div className="chart-head">
            <h3>{messages.settings.accountsTitle}</h3>
            <p>{messages.settings.accountsDetail}</p>
          </div>
        </div>
        <span className={`settings-section-toggle-icon ${isOpen ? "is-open" : ""}`}>
          <ChevronRight size={18} />
        </span>
      </button>
      {isOpen ? (
        <>
          <div className="settings-actions">
            <button type="button" className="subtle-action" onClick={onCreateAccount}>
              {messages.settings.addAccount}
            </button>
          </div>
          <p className="lede compact">{messages.settings.accountBalanceHint}</p>
          <div className="settings-accounts-grid">
            {accounts.map((account) => {
              const latestCheckpoint = account.latestCheckpointMonth
                ? account.checkpointHistory?.find((item) => item.month === account.latestCheckpointMonth)
                : null;
              return (
                <div key={account.id} className={`settings-account-row settings-account-card ${!account.isActive ? "is-archived" : ""}`}>
                  <div className="settings-account-main">
                    <strong>{account.name}</strong>
                    <p>{messages.common.triplet(account.institution, account.kind, account.ownerLabel)}</p>
                    <p>{`Balance ${formatService.money(account.balanceMinor ?? 0)} • Opening ${formatService.money(account.openingBalanceMinor ?? 0)}`}</p>
                    <p className={`settings-account-health ${account.reconciliationStatus ? `is-${account.reconciliationStatus}` : ""}`}>
                      {accountService.describeHealth(account)}
                    </p>
                    <p className="settings-account-meta">
                      {account.latestImportAt
                        ? messages.settings.accountHealthLastImport(formatService.formatDate(account.latestImportAt))
                        : messages.settings.accountHealthNoImports}
                      {account.unresolvedTransferCount ? ` • ${messages.settings.accountHealthUnresolvedTransfers(account.unresolvedTransferCount)}` : ""}
                    </p>
                  </div>
                  <div className="settings-account-actions">
                    {!account.isActive ? <span className="account-badge">{messages.settings.archived}</span> : null}
                    <button type="button" className="subtle-action" onClick={() => onReconcileAccount(account)}>
                      {messages.settings.reconcileAccount}
                    </button>
                    {latestCheckpoint && account.latestCheckpointDeltaMinor != null && account.latestCheckpointDeltaMinor !== 0 ? (
                      <button type="button" className="settings-text-link" onClick={() => onOpenStatementCompare(account, latestCheckpoint)}>
                        {messages.settings.statementCompareOpen}
                      </button>
                    ) : null}
                    <button type="button" className="icon-action" aria-label={messages.settings.editAccount} onClick={() => onEditAccount(account)}>
                      <SquarePen size={16} />
                    </button>
                    {account.isActive ? (
                      <DeleteRowButton
                        label={account.name}
                        triggerLabel={messages.settings.archiveAccount}
                        confirmLabel={messages.settings.archiveAccount}
                        destructive={false}
                        prompt={messages.settings.archiveAccountDetail(account.name)}
                        onConfirm={() => onArchiveAccount(account.id)}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {statementComparePanel ? (
            <div className="settings-statement-compare-inline">
              <div className="settings-statement-compare-head">
                <div>
                  <strong>{messages.settings.statementComparePanelTitle(
                    statementComparePanel.accountName,
                    formatService.formatMonthLabel(statementComparePanel.checkpointMonth)
                  )}</strong>
                  <p>{messages.settings.statementComparePanelDetail}</p>
                  {statementComparePanel.deltaMinor != null ? (
                    <p className="settings-account-health is-mismatch">{messages.settings.statementCompareDelta(formatService.money(Math.abs(statementComparePanel.deltaMinor)))}</p>
                  ) : null}
                  {statementComparePanel.statementStartDate && statementComparePanel.statementEndDate ? (
                    <p>{messages.settings.statementCompareCheckpointPeriod(
                      formatService.formatDateOnly(statementComparePanel.statementStartDate),
                      formatService.formatDateOnly(statementComparePanel.statementEndDate)
                    )}</p>
                  ) : null}
                </div>
                <button type="button" className="subtle-cancel" onClick={onCloseStatementCompare}>
                  Cancel
                </button>
              </div>
              <input
                id="statement-compare-account-upload"
                type="file"
                accept=".csv,text/csv,.pdf,application/pdf"
                hidden
                onChange={(event) => void onUploadStatementCompare(statementComparePanel, event)}
              />
              <button
                type="button"
                className="subtle-action is-primary"
                disabled={isSubmitting}
                onClick={() => document.getElementById("statement-compare-account-upload")?.click()}
              >
                {messages.settings.statementCompareUpload}
              </button>
              {statementCompareStatus ? (
                <section className={`settings-statement-compare is-${statementCompareStatus.tone}`}>
                  <strong>{messages.settings.statementCompareTitle}</strong>
                  <p>{statementCompareStatus.message}</p>
                </section>
              ) : null}
              {statementCompareResult ? (
                <StatementCompareResultView
                  result={statementCompareResult}
                  deltaMinor={statementComparePanel.deltaMinor}
                  accounts={accounts}
                  categories={categories}
                  people={people}
                  onRowsMatched={onRowsMatched}
                  onEntryAdded={onEntryAdded}
                />
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
