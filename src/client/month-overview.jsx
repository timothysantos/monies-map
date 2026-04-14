import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { SquarePen } from "lucide-react";

import { describeAccountHealth, formatAccountDisplayName } from "./account-display";
import { messages } from "./copy/en-SG";
import { formatMonthLabel, money } from "./formatters";
import { MetricCard } from "./ui-components";

export function MonthPanelHeader({
  view,
  actionsOpen,
  isDuplicating,
  isResettingMonth,
  isDeletingMonth,
  resetMonthText,
  deleteMonthText,
  onActionsOpenChange,
  onScopeChange,
  onDuplicateMonth,
  onResetMonthTextChange,
  onDeleteMonthTextChange,
  onResetMonth,
  onDeleteMonth
}) {
  return (
    <div className="panel-head">
      <div>
        <h2 className="month-title">{messages.tabs.month}</h2>
        <span id="month-label" className="month-label">
          <span className="month-label-period">{formatMonthLabel(view.monthPage.month)}</span>
          <span className="month-label-separator">•</span>
          <span className="month-label-view">{view.label}</span>
        </span>
      </div>
      <div className="month-header-controls">
        {view.monthPage.scopes.length > 1 ? (
          <div className="scope-toggle pill-row scope-toggle-row desktop-scope-toggle">
            {view.monthPage.scopes.map((scope) => (
              <button
                key={scope.key}
                className={`pill scope-button ${scope.key === view.monthPage.selectedScope ? "is-active" : ""}`}
                type="button"
                onClick={() => onScopeChange(scope.key)}
              >
                {scope.label}
              </button>
            ))}
          </div>
        ) : null}
        <Popover.Root open={actionsOpen} onOpenChange={onActionsOpenChange}>
          <Popover.Trigger asChild>
            <button type="button" className="month-actions-trigger">
              {messages.month.actions}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="month-actions-popover" sideOffset={12} align="end">
              <button
                type="button"
                className="month-actions-item"
                onClick={() => {
                  onActionsOpenChange(false);
                  void onDuplicateMonth();
                }}
                disabled={isDuplicating}
              >
                {messages.month.duplicateMonth}
              </button>
              <Dialog.Root>
                <Dialog.Trigger asChild>
                  <button
                    type="button"
                    className="month-actions-item"
                    onClick={() => onActionsOpenChange(false)}
                    disabled={isResettingMonth}
                  >
                    {messages.month.resetMonth}
                  </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="note-dialog-overlay" />
                  <Dialog.Content className="note-dialog-content">
                    <div className="note-dialog-head">
                      <Dialog.Title>{messages.month.resetMonth}</Dialog.Title>
                      <Dialog.Description>{messages.month.resetMonthDetail}</Dialog.Description>
                    </div>
                    <input
                      className="table-edit-input"
                      placeholder={messages.month.resetMonthPlaceholder}
                      value={resetMonthText}
                      onChange={(event) => onResetMonthTextChange(event.target.value)}
                    />
                    <div className="note-dialog-actions">
                      <Dialog.Close asChild>
                        <button type="button" className="subtle-action">Cancel</button>
                      </Dialog.Close>
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className="subtle-action subtle-danger"
                          disabled={resetMonthText.trim().toLowerCase() !== "reset month" || isResettingMonth}
                          onClick={() => void onResetMonth()}
                        >
                          {messages.month.resetMonthConfirm}
                        </button>
                      </Dialog.Close>
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
              <Dialog.Root>
                <Dialog.Trigger asChild>
                  <button
                    type="button"
                    className="month-actions-item month-actions-item-danger"
                    onClick={() => onActionsOpenChange(false)}
                    disabled={isDeletingMonth}
                  >
                    {messages.month.deleteMonth}
                  </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="note-dialog-overlay" />
                  <Dialog.Content className="note-dialog-content">
                    <div className="note-dialog-head">
                      <Dialog.Title>{messages.month.deleteMonth}</Dialog.Title>
                      <Dialog.Description>{messages.month.deleteMonthDetail}</Dialog.Description>
                    </div>
                    <input
                      className="table-edit-input"
                      placeholder={messages.month.deleteMonthPlaceholder}
                      value={deleteMonthText}
                      onChange={(event) => onDeleteMonthTextChange(event.target.value)}
                    />
                    <div className="note-dialog-actions">
                      <Dialog.Close asChild>
                        <button type="button" className="subtle-action">Cancel</button>
                      </Dialog.Close>
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className="subtle-action subtle-danger"
                          disabled={deleteMonthText.trim().toLowerCase() !== "delete month" || isDeletingMonth}
                          onClick={() => void onDeleteMonth()}
                        >
                          {messages.month.deleteMonthConfirm}
                        </button>
                      </Dialog.Close>
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

export function MonthMetricRow({ cards }) {
  return (
    <div className="metric-row metric-row-month">
      {cards.map((card) => <MetricCard key={card.label} card={card} />)}
    </div>
  );
}

export function MonthNotesAndAccounts({
  monthNote,
  visibleAccounts,
  onEditMonthNote,
  onOpenEntriesForAccount
}) {
  return (
    <div className="panel-subgrid">
      <section>
        <div className="panel-subhead">
          <h3>{messages.month.notesTitle}</h3>
          <p>{messages.month.notesDetail}</p>
        </div>
        <button
          type="button"
          className="note-card note-card-button"
          onClick={onEditMonthNote}
        >
          <p>{monthNote || messages.common.emptyValue}</p>
          <SquarePen size={16} />
        </button>
      </section>

      <section>
        <div className="panel-subhead">
          <h3>{messages.month.accountsTitle}</h3>
          <p>{messages.month.accountsDetail}</p>
        </div>
        <div className="summary-account-pills">
          {visibleAccounts.map((account) => (
            <button
              key={account.id}
              type="button"
              className={`summary-account-pill ${account.reconciliationStatus ? `is-${account.reconciliationStatus}` : ""}`}
              onClick={() => onOpenEntriesForAccount(account)}
            >
              <span className="summary-account-pill-name">{formatAccountDisplayName(account)}</span>
              <span className="summary-account-pill-amount">{money(account.balanceMinor ?? 0)}</span>
              <span className="summary-account-pill-meta">{describeAccountHealth(account)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
