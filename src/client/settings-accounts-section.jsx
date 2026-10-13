import { SquarePen } from "lucide-react";

import { settingsMessages } from "./copy/en-SG-settings";
import { moniesClient } from "./monies-client-service";
import { StatementCompareResultView } from "./statement-compare";
import { describeAccountLine } from "./settings-account-line";
import { AddRow } from "./settings-add-row";
import { SettingsSection } from "./settings-section";
import { DeleteRowButton } from "./delete-row-button";
import { DetailRows } from "./ui-components";
import { moneyToneClass } from "./money-tone-class";
import { useMoneyPrivacy } from "./money-privacy";
import { reconciliationTone } from "../domain/money-tone";

const { accounts: accountService, format: formatService } = moniesClient;

// Account settings stay presentational here; SettingsPanel owns API calls and refresh sequencing.
export function SettingsAccountsSection({
  accounts,
  categories,
  people,
  isOpen,
  isSubmitting,
  summary,
  statementComparePanel,
  statementCompareResult,
  statementCompareStatus,
  statementCorrection,
  dismissedCorrectionFindingIds,
  onToggle,
  onCreateAccount,
  onEditAccount,
  onArchiveAccount,
  onReconcileAccount,
  onOpenStatementCompare,
  onCloseStatementCompare,
  onUploadStatementCompare,
  onApplyStatementCorrections,
  onUndoStatementCorrections,
  onDismissStatementCorrections,
  onRowsMatched,
  onEntryAdded
}) {
  const { areTotalsVisible } = useMoneyPrivacy();
  return (
    <SettingsSection title={settingsMessages.accountsTitle} value={summary?.text} isOpen={isOpen} onToggle={onToggle}>
      <p className="settings-hint">{settingsMessages.accountBalanceHint}</p>
      <div className="settings-accounts-grid">
        {accounts.map((account) => {
          const latestCheckpoint = account.latestCheckpointMonth
            ? account.checkpointHistory?.find((item) => item.month === account.latestCheckpointMonth)
            : null;
          return (
            <div key={account.id} className={`settings-account-row settings-account-card ${!account.isActive ? "is-archived" : ""}`}>
              <div className="settings-account-top">
                <div className="settings-account-main">
                  <strong>{account.name}</strong>
                  <p>{describeAccountLine(account)}</p>
                </div>
                <div className="settings-account-balance">
                  <strong>{formatService.money(account.balanceMinor ?? 0)}</strong>
                  <small>{settingsMessages.accountOpening(formatService.money(account.openingBalanceMinor ?? 0))}</small>
                </div>
              </div>
              <div className="settings-account-facts">
                {areTotalsVisible ? (
                  <p className={`settings-account-health ${moneyToneClass(reconciliationTone(account.reconciliationStatus))}`}>
                    {accountService.describeHealth(account)}
                  </p>
                ) : null}
                <p className="settings-account-meta">
                  {account.latestImportAt
                    ? settingsMessages.accountHealthLastImport(formatService.formatDate(account.latestImportAt))
                    : settingsMessages.accountHealthNoImports}
                  {account.unresolvedTransferCount ? ` • ${settingsMessages.accountHealthUnresolvedTransfers(account.unresolvedTransferCount)}` : ""}
                </p>
              </div>
              <div className="settings-account-actions">
                {!account.isActive ? <span className="account-badge">{settingsMessages.archived}</span> : null}
                <button type="button" className="subtle-action" onClick={() => onReconcileAccount(account)}>
                  {settingsMessages.reconcileAccount}
                </button>
                {latestCheckpoint && account.latestCheckpointDeltaMinor != null && account.latestCheckpointDeltaMinor !== 0 ? (
                  <button type="button" className="subtle-action" onClick={() => onOpenStatementCompare(account, latestCheckpoint)}>
                    {settingsMessages.statementCompareOpen}
                  </button>
                ) : null}
                <span className="settings-account-icons">
                  <button type="button" className="icon-action settings-row-icon" aria-label={settingsMessages.editAccount} onClick={() => onEditAccount(account)}>
                    <SquarePen size={16} />
                  </button>
                  {account.isActive ? (
                    <DeleteRowButton
                      label={account.name}
                      triggerLabel={settingsMessages.archiveAccount}
                      confirmLabel={settingsMessages.archiveAccount}
                      destructive={false}
                      buttonClassName="settings-row-icon"
                      prompt={settingsMessages.archiveAccountDetail(account.name)}
                      onConfirm={() => onArchiveAccount(account.id)}
                    />
                  ) : null}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <DetailRows>
        <AddRow onClick={onCreateAccount}>{settingsMessages.addAccount}</AddRow>
      </DetailRows>
          {statementComparePanel ? (
            <div className="settings-statement-compare-inline">
              <div className="settings-statement-compare-head">
                <div>
                  <strong>{settingsMessages.statementComparePanelTitle(
                    statementComparePanel.accountName,
                    formatService.formatMonthLabel(statementComparePanel.checkpointMonth)
                  )}</strong>
                  <p>{settingsMessages.statementComparePanelDetail}</p>
                  {statementComparePanel.deltaMinor != null ? (
                    <p className="settings-account-health money-short">{settingsMessages.statementCompareDelta(formatService.money(Math.abs(statementComparePanel.deltaMinor)))}</p>
                  ) : null}
                  {statementComparePanel.statementStartDate && statementComparePanel.statementEndDate ? (
                    <p>{settingsMessages.statementCompareCheckpointPeriod(
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
                {settingsMessages.statementCompareUpload}
              </button>
              {statementCompareStatus ? (
                <section className={`settings-statement-compare is-${statementCompareStatus.tone}`}>
                  <strong>{settingsMessages.statementCompareTitle}</strong>
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
                  isSubmitting={isSubmitting}
                  statementCorrection={statementCorrection}
                  dismissedCorrectionFindingIds={dismissedCorrectionFindingIds}
                  onApplyStatementCorrections={onApplyStatementCorrections}
                  onUndoStatementCorrections={onUndoStatementCorrections}
                  onDismissStatementCorrections={onDismissStatementCorrections}
                />
              ) : null}
            </div>
          ) : null}
    </SettingsSection>
  );
}
