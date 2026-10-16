import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, RotateCcw, SquarePen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { ConfirmLead, SheetDialog } from "./sheet-dialog";
import { DetailRow, DetailRows, LeadCard } from "./ui/lead-support-detail";
import { useIsMobileLayout } from "./use-viewport";
import { SpendLeadGroup } from "./ui-components";
import { buildMonthLeadModel } from "./month-lead-model";
import { useLeadView } from "./lead-view";
import { buildMoneyIn } from "./month-money-in-model";
import { monthSimpleCopy } from "./copy/month-simple-copy";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { useRouteWorkBusy } from "./use-route-work-status";
import { InlineError } from "./ui-states";
import { reconciliationTone } from "../domain/money-tone";
import { getCurrentMonthKey } from "../lib/month";
import { moneyToneClass } from "./money-tone-class";

const { accounts: accountService, format: formatService } = moniesClient;

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
  onDeleteMonth,
  isDemoEnvironment = false
}) {
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // A failed action keeps its popover or dialog open and says why.
  const [duplicateError, setDuplicateError] = useState("");
  const [resetError, setResetError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  useRouteWorkBusy(resetDialogOpen || deleteDialogOpen);
  const monthLabel = `${formatService.formatMonthLabel(view.monthPage.month)} · ${view.label}`;
  const isSheet = useIsMobileLayout();

  // The Actions list is a popover on a wide screen and a bottom sheet on a
  // phone; both run the same three actions.
  function closeActions() {
    setDuplicateError("");
    onActionsOpenChange(false);
  }

  async function duplicateMonth() {
    if (await runAction(onDuplicateMonth, setDuplicateError, messages.month.duplicateMonthFailed)) {
      onActionsOpenChange(false);
    }
  }

  function openResetDialog() {
    setResetError("");
    setResetDialogOpen(true);
    onActionsOpenChange(false);
  }

  function openDeleteDialog() {
    setDeleteError("");
    setDeleteDialogOpen(true);
    onActionsOpenChange(false);
  }

  async function runAction(action, setError, fallback) {
    setError("");
    try {
      await action();
      return true;
    } catch (error) {
      setError(error instanceof Error && error.message ? error.message : fallback);
      return false;
    }
  }

  return (
    <div className="panel-head month-panel-head">
      <div>
        <h2 className="month-title">{messages.tabs.month}</h2>
        <span id="month-label" className="month-label">
          <span className="month-label-period">{formatService.formatMonthLabel(view.monthPage.month)}</span>
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
                aria-pressed={scope.key === view.monthPage.selectedScope}
                onClick={() => onScopeChange(scope.key)}
              >
                {scope.label}
              </button>
            ))}
          </div>
        ) : null}
        {isSheet ? (
          <>
            <button
              type="button"
              className="month-actions-trigger"
              aria-haspopup="dialog"
              aria-expanded={actionsOpen}
              onClick={() => onActionsOpenChange(true)}
            >
              {messages.month.actions}
            </button>
            {actionsOpen ? (
              <SheetDialog
                className="month-actions-sheet"
                title={messages.month.actions}
                description={monthLabel}
                descriptionHidden
                lead={(
                  <LeadCard className="sheet-dialog-lead" category={{ icon: CalendarDays }} title={monthLabel} subtitle={messages.month.actions} />
                )}
                errorMessage={duplicateError}
                quietLabel={null}
                primaryLabel="Done"
                onSubmit={closeActions}
                onClose={closeActions}
              >
                <DetailRows label={messages.month.actions}>
                  <DetailRow
                    label={isDuplicating ? messages.common.working : messages.month.duplicateMonth}
                    disabled={isDuplicating}
                    onClick={duplicateMonth}
                  />
                  <DetailRow label={messages.month.resetMonth} disabled={isResettingMonth} onClick={openResetDialog} />
                  <DetailRow
                    className="is-danger"
                    label={messages.month.deleteMonth}
                    disabled={isDeletingMonth}
                    onClick={openDeleteDialog}
                  />
                </DetailRows>
              </SheetDialog>
            ) : null}
          </>
        ) : (
        <Popover.Root modal
          open={actionsOpen}
          onOpenChange={(open) => {
            if (!open) {
              setDuplicateError("");
            }
            onActionsOpenChange(open);
          }}
        >
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
                onClick={duplicateMonth}
                disabled={isDuplicating}
              >
                {isDuplicating ? messages.common.working : messages.month.duplicateMonth}
              </button>
              <InlineError message={duplicateError} />
              <button
                type="button"
                onClick={openResetDialog}
                className="month-actions-item"
                disabled={isResettingMonth}
              >
                {messages.month.resetMonth}
              </button>
              <button
                type="button"
                onClick={openDeleteDialog}
                className="month-actions-item month-actions-item-danger"
                disabled={isDeletingMonth}
              >
                {messages.month.deleteMonth}
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        )}
        {/* The confirmation dialogs live outside the Actions popover: opening one
            closes the popover, which would otherwise unmount the dialog with it. */}
        {resetDialogOpen ? (
          <MonthTypedConfirmDialog
            icon={RotateCcw}
            title={messages.month.resetMonth}
            detail={messages.month.resetMonthDetail}
            monthLabel={monthLabel}
            placeholder={messages.month.resetMonthPlaceholder}
            phrase="reset month"
            confirmLabel={messages.month.resetMonthConfirm}
            text={resetMonthText}
            error={resetError}
            isWorking={isResettingMonth}
            onTextChange={onResetMonthTextChange}
            onClose={() => {
              setResetDialogOpen(false);
              setResetError("");
            }}
            onConfirm={async () => {
              if (await runAction(onResetMonth, setResetError, messages.month.resetMonthFailed)) {
                setResetDialogOpen(false);
              }
            }}
          />
        ) : null}
        {deleteDialogOpen ? (
          <MonthTypedConfirmDialog
            icon={Trash2}
            title={messages.month.deleteMonth}
            detail={messages.month.deleteMonthDetail({ isDemo: isDemoEnvironment })}
            monthLabel={monthLabel}
            placeholder={messages.month.deleteMonthPlaceholder}
            phrase="delete month"
            confirmLabel={messages.month.deleteMonthConfirm}
            text={deleteMonthText}
            error={deleteError}
            isWorking={isDeletingMonth}
            onTextChange={onDeleteMonthTextChange}
            onClose={() => {
              setDeleteDialogOpen(false);
              setDeleteError("");
            }}
            onConfirm={async () => {
              if (await runAction(onDeleteMonth, setDeleteError, messages.month.deleteMonthFailed)) {
                setDeleteDialogOpen(false);
              }
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

// The Month top (design.md, "Lead · Support · Detail"): the Summary spend
// lead for this month (actual spend against planned spend, the bar, the
// percent of plan and the spend gap as "under/over plan"), with Income,
// Saved and Remaining budget as Support pills. It replaced six tiles that
// scrolled sideways on a phone; every figure they showed is here.
// `model` is buildMonthLeadModel's (useMonthLead below); `leadView` is Plan
// or Simple (lead-view.js), which the panel also uses for the rest of the page.
export function MonthLead({ model, leadView, onLeadViewChange, month, categoryShare = [], isRefreshing = false }) {
  const setLeadView = onLeadViewChange;
  return (
    <>
      {isRefreshing ? <p className="month-refresh-hint">Updating totals and actuals...</p> : null}
      {model ? (
        <SpendLeadGroup
          model={model}
          view={leadView}
          onViewChange={setLeadView}
          categoryShare={categoryShare}
          className="month-lead-group"
          leadClassName="month-lead"
          inline
          periodLabel={formatService.formatMonthLabel(month)}
          period={{ startMonth: month, endMonth: month, inProgress: month === getCurrentMonthKey() }}
        >
          <RemainingColumn remaining={model.remaining} />
        </SpendLeadGroup>
      ) : null}
    </>
  );
}

// Month · Simple, in the plan tables' place (design.md "Plan or Simple"):
// "Money in", one row per source with what came in (mint; dots when money
// is hidden), each opening its entries; then a quiet "Plan this month" that
// switches the page to Plan, where the plan is edited. Where the money went
// is the Spending Mix above it (categories, amounts, shares, bars, each
// opening its entries), shown in both views.
export function MonthMoneyIn({ entries, onOpenEntries, onPlanThisMonth }) {
  const { rows } = useMemo(() => buildMoneyIn(entries), [entries]);
  return (
    <section className="chart-card month-money-in" data-money-in>
      <div className="chart-head">
        <h3>{monthSimpleCopy.title}</h3>
        <p>{monthSimpleCopy.detail}</p>
      </div>
      {rows.length ? (
        <DetailRows label={monthSimpleCopy.title}>
          {rows.map((row) => (
            <DetailRow
              key={row.label}
              data-source={row.label}
              label={row.entryIds.length > 1 ? `${row.label} · ${monthSimpleCopy.sources(row.entryIds.length)}` : row.label}
              value={<span className={moneyToneClass("in")}><PrivateMoney>{formatService.money(row.amountMinor)}</PrivateMoney></span>}
              onClick={() => onOpenEntries(row.entryIds)}
            />
          ))}
        </DetailRows>
      ) : <p className="month-money-in-empty">{monthSimpleCopy.empty}</p>}
      <button type="button" className="subtle-action month-plan-link" title={monthSimpleCopy.planThisMonthHint} onClick={onPlanThisMonth}>
        {monthSimpleCopy.planThisMonth}
      </button>
    </section>
  );
}

// The Month lead's model and the page's Plan | Simple view (the same
// remembered choice as Summary's): a month with no plan opens in Simple.
export function useMonthLead({ cards, monthSummary, planSections = [], categoryShare = [], investmentMoves = null }) {
  const model = useMemo(() => buildMonthLeadModel(cards, monthSummary, {
    planRows: planSections.flatMap((section) => section.rows ?? []),
    categoryShare,
    investmentMoves
  }), [cards, categoryShare, investmentMoves, monthSummary, planSections]);
  const [leadView, setLeadView] = useLeadView();
  return { model, leadView, setLeadView };
}

// Remaining budget (planned income minus planned spend), the third column of
// the lead's support row. Its label says which side of zero it is ("To
// allocate" or "Overplanned"), so with hidden money it falls back to the
// plain name. The whole column is an openable figure (design.md "Openable
// figures", a 44px target): its menu starts with the explanation, then Open
// plan and Ask about this.
function RemainingColumn({ remaining }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  return (
    <button type="button" className="lead-column is-button" data-metric="remaining" data-fig="plan" data-fig-plan="" data-fig-note={remaining.detailPopover}>
      <span className="lead-column-label">{areTotalsVisible ? remaining.detail : remaining.label}</span>
      <strong className={moneyToneClass(remaining.tone)}><PrivateMoney>{formatService.money(remaining.amountMinor)}</PrivateMoney></strong>
    </button>
  );
}

export function MonthNotesAndAccounts({
  monthNote,
  visibleAccounts,
  onEditMonthNote,
  onDraftMonthNote,
  isDraftingMonthNote = false,
  onOpenEntriesForAccount
}) {
  const { areTotalsVisible } = useMoneyPrivacy();
  return (
    <div className="panel-subgrid">
      <section>
        <div className="panel-subhead">
          <h3>{messages.month.notesTitle}</h3>
          <p>{messages.month.notesDetail}</p>
        </div>
        <div className="note-card-actions">
          <button
            type="button"
            className="note-card note-card-button"
            onClick={onEditMonthNote}
          >
            <p>{monthNote || messages.common.emptyValue}</p>
            <SquarePen size={16} />
          </button>
          <button type="button" className="subtle-action" onClick={onDraftMonthNote} disabled={isDraftingMonthNote}>
            {isDraftingMonthNote ? "Drafting..." : "Draft a summary"}
          </button>
        </div>
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
              className={`summary-account-pill ${moneyToneClass(reconciliationTone(account.reconciliationStatus), "soft")}`}
              onClick={() => onOpenEntriesForAccount(account)}
            >
              <span className="summary-account-pill-name">{accountService.formatDisplayName(account)}</span>
              <span className="summary-account-pill-amount"><PrivateMoney>{formatService.money(account.balanceMinor ?? 0)}</PrivateMoney></span>
              {areTotalsVisible ? <span className="summary-account-pill-meta">{accountService.describeHealth(account)}</span> : null}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// Reset and Delete month ask for the words typed first. The lead names the
// month and whose view it is; what it does follows as one line, and the typed
// words unlock the rose button.
function MonthTypedConfirmDialog({ icon, title, detail, monthLabel, placeholder, phrase, confirmLabel, text, error, isWorking, onTextChange, onClose, onConfirm }) {
  return (
    <SheetDialog
      tone="danger"
      title={title}
      description={detail}
      descriptionHidden
      lead={(
        <ConfirmLead icon={icon} title={monthLabel}>
          <p className="lsd-note">{detail}</p>
        </ConfirmLead>
      )}
      errorMessage={error}
      primaryLabel={isWorking ? messages.common.working : confirmLabel}
      primaryDisabled={text.trim().toLowerCase() !== phrase || isWorking}
      isSubmitting={isWorking}
      onSubmit={onConfirm}
      onClose={onClose}
    >
      <label className="sheet-dialog-field">
        <input
          className="table-edit-input"
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          autoCapitalize="none"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
        />
      </label>
    </SheetDialog>
  );
}
