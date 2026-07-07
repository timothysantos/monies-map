import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, SquarePen, X } from "lucide-react";
import {
  useLocation,
  useNavigate,
  useSearchParams
} from "react-router-dom";

import {
  CategoryAppearancePopover,
  SpendingMixChart
} from "./category-visuals";
import { messages } from "./copy/en-SG";
import {
  getDonutItemId,
  getVisibleDonutData,
  sumDonutValueMinor,
  toggleHiddenDonutItemIds
} from "./donut-visibility";
import { moniesClient } from "./monies-client-service";
import {
  buildSummaryEntriesLocation,
  buildSummaryMonthLocation,
  SUMMARY_FOCUS_OVERALL
} from "./summary-workflow";
import {
  BarLine,
  MetricCard
} from "./ui-components";
const {
  accounts: accountService,
  categories: categoryService,
  format: formatService
} = moniesClient;

// Read alongside docs/import-summary-code-glossary.md.
// This panel has three main blocks:
// 1. Range-level metrics and spending mix.
// 2. Month-by-month "intent vs outcome" plan review.
// 3. Account health pills that stay independent from the selected range.
export function SummaryPanel({ view, selectedMonth, categories, onCategoryAppearanceChange, onRefresh }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [monthNoteDialog, setMonthNoteDialog] = useState(null);
  const [isSavingMonthNote, setIsSavingMonthNote] = useState(false);
  const [monthNoteError, setMonthNoteError] = useState("");
  // Summary can mount while the route payload is still hydrating, so keep a
  // fully shaped local summary slice instead of reading nested fields directly.
  const safeSummaryPage = {
    metricCards: [],
    rangeMonths: [],
    categoryShareByMonth: [],
    categoryShareChart: [],
    months: [],
    accountPills: [],
    ...view.summaryPage
  };

  const summaryFocusParam = searchParams.get("summary_focus");
  const focusState = buildSummaryFocusState(safeSummaryPage, summaryFocusParam);

  function navigateToEntries(nextFilters) {
    navigate(buildSummaryEntriesLocation(location.search, nextFilters));
  }

  function handleFocusChange(nextMonth) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("summary_focus", nextMonth || SUMMARY_FOCUS_OVERALL);
      return next;
    });
  }

  function handleOpenEntriesForCategory(categoryName) {
    navigateToEntries({
      entry_category: categoryName,
      month: focusState.selectedFocusMonth
    });
  }

  function handleOpenEntriesForAccount(accountId) {
    navigateToEntries({
      entry_wallet: accountId,
      month: focusState.selectedFocusMonth || selectedMonth
    });
  }

  function handleOpenMonth(month) {
    navigate(buildSummaryMonthLocation(location.search, month));
  }

  async function saveSummaryMonthNote() {
    if (!monthNoteDialog) {
      return;
    }

    setIsSavingMonthNote(true);
    setMonthNoteError("");
    try {
      await onRefresh({
        month: monthNoteDialog.month,
        note: monthNoteDialog.draft
      });
      setMonthNoteDialog(null);
    } catch (error) {
      setMonthNoteError(error instanceof Error ? error.message : "Failed to save month note.");
    } finally {
      setIsSavingMonthNote(false);
    }
  }

  return (
    <article className="panel panel-accent">
      <div className="panel-head summary-head">
        <div>
          <h2>{messages.tabs.summary}</h2>
          <span className="panel-context">{messages.common.viewingDot(view.label)}</span>
        </div>
        <div className="metric-row metric-row-summary summary-head-metrics">
          {safeSummaryPage.metricCards.map((card) => (
            <MetricCard key={card.label} card={card} />
          ))}
        </div>
      </div>

      <div className="summary-top-grid">
        <SummarySpendingMixSection
          rangeMonths={safeSummaryPage.rangeMonths}
          focusState={focusState}
          categories={categories}
          onCategoryAppearanceChange={onCategoryAppearanceChange}
          onFocusChange={handleFocusChange}
          onOpenEntriesForCategory={handleOpenEntriesForCategory}
          summaryFocusParam={summaryFocusParam}
        />

        <SummaryIntentVsOutcomeSection
          months={safeSummaryPage.months}
          onOpenMonth={handleOpenMonth}
          onEditNote={(month, note) => setMonthNoteDialog({ month, draft: note ?? "" })}
        />
      </div>

      <SummaryAccountsSection
        accountPills={safeSummaryPage.accountPills}
        onOpenEntriesForAccount={handleOpenEntriesForAccount}
      />

      <SummaryMonthNoteDialog
        monthNoteDialog={monthNoteDialog}
        isSaving={isSavingMonthNote}
        errorMessage={monthNoteError}
        onClose={() => {
          if (!isSavingMonthNote) {
            setMonthNoteDialog(null);
            setMonthNoteError("");
          }
        }}
        onChangeDraft={(draft) => {
          setMonthNoteDialog((current) => (current ? { ...current, draft } : current));
        }}
        onSave={saveSummaryMonthNote}
      />
    </article>
  );
}

function SummarySpendingMixSection({
  rangeMonths,
  focusState,
  categories,
  onCategoryAppearanceChange,
  onFocusChange,
  onOpenEntriesForCategory,
  summaryFocusParam
}) {
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState(() => new Set());
  const visibleDonutData = useMemo(
    () => getVisibleDonutData(focusState.donutData, hiddenCategoryIds),
    [focusState.donutData, hiddenCategoryIds]
  );
  const visibleTotalMinor = sumDonutValueMinor(visibleDonutData);
  const hiddenCount = hiddenCategoryIds.size;

  function toggleCategoryVisibility(item) {
    setHiddenCategoryIds((current) => toggleHiddenDonutItemIds(current, getDonutItemId(item)));
  }

  return (
    <section className="chart-card">
      <div className="chart-head">
        <h3>{messages.summary.spendingMix}</h3>
      </div>
      <div className="summary-mix">
        <div className="summary-mix-main">
          <div className="summary-mix-months">
            <button
              type="button"
              className={`summary-focus-button ${summaryFocusParam === SUMMARY_FOCUS_OVERALL ? "is-active" : ""}`}
              onClick={() => onFocusChange("")}
            >
              {messages.summary.rangeOverall}
            </button>
            {rangeMonths.slice().reverse().map((month) => (
              <button
                key={month}
                type="button"
                className={`summary-focus-button ${focusState.selectedFocusMonth === month ? "is-active" : ""}`}
                onClick={() => onFocusChange(month)}
              >
                {formatService.formatMonthLabel(month)}
              </button>
            ))}
          </div>

          <SpendingMixChart
            data={visibleDonutData}
            categories={categories}
            totalMinor={visibleTotalMinor}
          />
          {hiddenCount ? (
            <button type="button" className="subtle-action donut-reset-action" onClick={() => setHiddenCategoryIds(new Set())}>
              {messages.common.resetHiddenCategories(hiddenCount)}
            </button>
          ) : null}

          <div className="share-list">
            {focusState.donutData.map((item) => {
              const category = categoryService.get(categories, item);
              const categoryName = category?.name ?? item.label;
              const isHidden = hiddenCategoryIds.has(getDonutItemId(item));
              return (
                <div key={item.key} className={`share-row chart-toggle-row ${isHidden ? "is-hidden-from-donut" : ""}`}>
                  <div className="category-key">
                    <CategoryAppearancePopover
                      category={category}
                      onChange={onCategoryAppearanceChange}
                    />
                    <button
                      type="button"
                      className="share-row-button"
                      aria-pressed={!isHidden}
                      onClick={() => toggleCategoryVisibility(item)}
                    >
                      <strong>{categoryName}</strong>
                      <p>{formatService.money(item.valueMinor)}</p>
                      <span className="share-row-meta">
                        {messages.common.triplet(formatTransactionCount(item.entryCount), isHidden ? messages.common.hiddenFromChart : messages.common.shownInChart)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-action share-row-secondary-action"
                      aria-label={messages.common.viewEntriesFor(categoryName)}
                      title={messages.common.viewEntries}
                      onClick={() => onOpenEntriesForCategory(categoryName)}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryIntentVsOutcomeSection({ months, onOpenMonth, onEditNote }) {
  const sortedMonths = [...months].sort((left, right) => right.month.localeCompare(left.month));

  return (
    <section className="chart-card">
      <div className="chart-head">
        <h3>{messages.summary.intentVsOutcome}</h3>
        <p>{messages.summary.intentVsOutcomeDetail}</p>
      </div>
      <div className="chart-bars">
        {sortedMonths.map((month, index) => {
          const monthPlanReview = buildMonthPlanReview(month);
          return (
            <SummaryMonthPlanCard
              key={month.month}
              month={month}
              monthPlanReview={monthPlanReview}
              isInitiallyOpen={index === 0}
              onOpenMonth={onOpenMonth}
              onEditNote={onEditNote}
            />
          );
        })}
      </div>
    </section>
  );
}

function SummaryMonthPlanCard({ month, monthPlanReview, isInitiallyOpen, onOpenMonth, onEditNote }) {
  return (
    <details className="plan-row-card" open={isInitiallyOpen}>
      <summary className="plan-row-summary">
        <div className="plan-row-head">
          <div className="plan-row-title">
            <span className="plan-row-disclosure" aria-hidden="true">
              <ChevronRight size={18} />
            </span>
            <div>
              <button
                type="button"
                className="summary-month-link"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenMonth(month.month);
                }}
              >
                {formatService.formatMonthLabel(month.month)}
              </button>
              <p>{messages.summary.incomeLabel(
                formatService.money(month.plannedIncomeMinor),
                formatService.money(month.actualIncomeMinor)
              )}</p>
            </div>
          </div>
          <span className={monthPlanReview.spendVarianceMinor >= 0 ? "positive" : "negative"}>
            {formatService.money(monthPlanReview.spendVarianceMinor)}
          </span>
        </div>
      </summary>

      <div className="plan-row-content">
        <BarLine
          label={messages.month.table.planned}
          valueMinor={month.estimatedExpensesMinor}
          maxMinor={monthPlanReview.maxExpenseBarMinor}
          tone="planned"
        />
        <BarLine
          label={messages.month.table.actual}
          valueMinor={month.realExpensesMinor}
          maxMinor={monthPlanReview.maxExpenseBarMinor}
          tone="actual"
        />

        <div className="table-wrap plan-detail-table-wrap">
          <table className="plan-detail-table">
            <thead>
              <tr>
                <th>{messages.summary.table.metric}</th>
                <th>{messages.summary.table.estimate}</th>
                <th>{messages.summary.table.actual}</th>
                <th>{messages.summary.table.variance}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{messages.summary.table.income}</td>
                <td>{formatService.money(month.plannedIncomeMinor)}</td>
                <td>{formatService.money(month.actualIncomeMinor)}</td>
                <td className={monthPlanReview.incomeVarianceMinor >= 0 ? "positive" : "negative"}>
                  {formatService.money(monthPlanReview.incomeVarianceMinor)}
                </td>
              </tr>
              <tr>
                <td>{messages.summary.table.expectedExpenses}</td>
                <td>{formatService.money(month.estimatedExpensesMinor)}</td>
                <td>{formatService.money(month.realExpensesMinor)}</td>
                <td className={monthPlanReview.spendVarianceMinor >= 0 ? "positive" : "negative"}>
                  {formatService.money(monthPlanReview.spendVarianceMinor)}
                </td>
              </tr>
              <tr>
                <td>{messages.summary.table.expectedSavings}</td>
                <td>{formatService.money(month.savingsGoalMinor)}</td>
                <td className={month.realizedSavingsMinor >= 0 ? "positive" : "negative"}>
                  {formatService.money(month.realizedSavingsMinor)}
                </td>
                <td className={monthPlanReview.savingsVarianceMinor >= 0 ? "positive" : "negative"}>
                  {formatService.money(monthPlanReview.savingsVarianceMinor)}
                </td>
              </tr>
              <tr className="summary-context-row">
                <td colSpan={4}>
                  <button
                    type="button"
                    className="note-trigger summary-note-trigger"
                    onClick={() => onEditNote(month.month, month.note)}
                  >
                    <span>{month.note || messages.common.emptyValue}</span>
                    <SquarePen size={14} />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

function SummaryAccountsSection({ accountPills, onOpenEntriesForAccount }) {
  if (!accountPills.length) {
    return null;
  }

  return (
    <section className="summary-accounts">
      <div className="panel-subhead">
        <h3>Wallets in view</h3>
        <p>Current wallet balances from the ledger. These do not change with the selected summary range.</p>
      </div>
      <div className="summary-account-pills">
        {accountPills.map((account) => (
          <button
            key={account.accountId}
            type="button"
            className={`summary-account-pill ${account.reconciliationStatus ? `is-${account.reconciliationStatus}` : ""}`}
            onClick={() => onOpenEntriesForAccount(account.accountId)}
          >
            <span className="summary-account-pill-name">{accountService.formatDisplayName(account)}</span>
            <span className="summary-account-pill-amount">{formatService.money(account.balanceMinor)}</span>
            <span className="summary-account-pill-meta">{accountService.describeHealth(account)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SummaryMonthNoteDialog({ monthNoteDialog, isSaving = false, errorMessage = "", onClose, onChangeDraft, onSave }) {
  return (
    <Dialog.Root open={Boolean(monthNoteDialog)} onOpenChange={(open) => { if (!open && !isSaving) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (isSaving) {
                return;
              }
              void onSave();
            }}
          >
            <div className="note-dialog-head">
              <div>
                <Dialog.Title>{messages.month.notesTitle}</Dialog.Title>
                <Dialog.Description>{messages.month.notesDetail}</Dialog.Description>
              </div>
              <button
                type="button"
                className="icon-action subtle-cancel"
                aria-label="Close month note editor"
                disabled={isSaving}
                onClick={onClose}
              >
                <X size={16} />
              </button>
            </div>
            {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}
            <textarea
              className="note-dialog-textarea"
              value={monthNoteDialog?.draft ?? ""}
              onChange={(event) => onChangeDraft(event.target.value)}
              rows={10}
              enterKeyHint="done"
            />
            <div className="note-dialog-actions">
              <button type="button" className="subtle-cancel" disabled={isSaving} onClick={onClose}>
                {messages.month.cancelEdit}
              </button>
              <button type="submit" className="dialog-primary" disabled={isSaving}>
                {isSaving ? messages.common.saving : messages.month.doneEdit}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function buildSummaryFocusState(summaryPage, summaryFocusParam) {
  // Summary can hydrate before the full range slice lands, so default to
  // empty collections instead of assuming every summary field is present.
  const safeSummaryPage = summaryPage ?? {
    rangeMonths: [],
    categoryShareByMonth: [],
    categoryShareChart: [],
    months: []
  };
  const rangeMonths = safeSummaryPage.rangeMonths ?? [];
  const categoryShareByMonth = safeSummaryPage.categoryShareByMonth ?? [];
  const categoryShareChart = safeSummaryPage.categoryShareChart ?? [];
  const months = safeSummaryPage.months ?? [];
  const latestRangeMonth = rangeMonths.at(-1) ?? "";
  const selectedFocusMonth = summaryFocusParam === SUMMARY_FOCUS_OVERALL
    ? ""
    : (summaryFocusParam && rangeMonths.includes(summaryFocusParam)
      ? summaryFocusParam
      : latestRangeMonth);
  const selectedDonutMonth = categoryShareByMonth.find((month) => month.month === selectedFocusMonth) ?? null;
  const donutData = selectedDonutMonth?.data ?? categoryShareChart;
  const totalSpendMinor = selectedDonutMonth
    ? months.find((month) => month.month === selectedDonutMonth.month)?.realExpensesMinor ?? 0
    : months.reduce((sum, month) => sum + month.realExpensesMinor, 0);

  return {
    selectedFocusMonth,
    donutData,
    totalSpendMinor
  };
}

function buildMonthPlanReview(month) {
  return {
    incomeVarianceMinor: month.actualIncomeMinor - month.plannedIncomeMinor,
    spendVarianceMinor: month.estimatedExpensesMinor - month.realExpensesMinor,
    savingsVarianceMinor: month.realizedSavingsMinor - month.savingsGoalMinor,
    maxExpenseBarMinor: Math.max(month.realExpensesMinor, month.estimatedExpensesMinor)
  };
}

function formatTransactionCount(entryCount) {
  return entryCount === 1 ? "1 transaction" : `${entryCount ?? 0} transactions`;
}
