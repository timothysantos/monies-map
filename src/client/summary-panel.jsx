import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, SquarePen, X } from "lucide-react";
import {
  useLocation,
  useNavigate,
  useSearchParams
} from "react-router-dom";

import {
  describeAccountHealth,
  formatAccountDisplayName
} from "./account-display";
import {
  CategoryAppearancePopover,
  SpendingMixChart
} from "./category-visuals";
import { getCategory } from "./category-utils";
import { messages } from "./copy/en-SG";
import {
  formatMonthLabel,
  money
} from "./formatters";
import {
  BarLine,
  MetricCard
} from "./ui-components";

const SUMMARY_FOCUS_OVERALL = "overall";

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

  const summaryFocusParam = searchParams.get("summary_focus");
  const focusState = buildSummaryFocusState(view.summaryPage, summaryFocusParam);

  function navigateToEntries(nextFilters) {
    const next = new URLSearchParams(location.search);
    next.delete("entry_wallet");
    next.delete("entry_person");
    next.delete("entry_type");
    next.delete("entry_category");

    for (const [key, value] of Object.entries(nextFilters)) {
      if (value) {
        next.set(key, value);
      }
    }

    navigate({
      pathname: "/entries",
      search: `?${next.toString()}`
    });
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
    const next = new URLSearchParams(location.search);
    next.set("month", month);
    navigate({
      pathname: "/month",
      search: `?${next.toString()}`
    });
  }

  async function saveSummaryMonthNote() {
    if (!monthNoteDialog) {
      return;
    }

    await fetch("/api/month-note/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: monthNoteDialog.month,
        personScope: view.id,
        note: monthNoteDialog.draft
      })
    });

    setMonthNoteDialog(null);
    await onRefresh();
  }

  return (
    <article className="panel panel-accent">
      <div className="panel-head summary-head">
        <div>
          <h2>{messages.tabs.summary}</h2>
          <span className="panel-context">{messages.common.viewingDot(view.label)}</span>
        </div>
        <div className="metric-row metric-row-summary summary-head-metrics">
          {view.summaryPage.metricCards.map((card) => (
            <MetricCard key={card.label} card={card} />
          ))}
        </div>
      </div>

      <div className="summary-top-grid">
        <SummarySpendingMixSection
          rangeMonths={view.summaryPage.rangeMonths}
          focusState={focusState}
          categories={categories}
          onCategoryAppearanceChange={onCategoryAppearanceChange}
          onFocusChange={handleFocusChange}
          onOpenEntriesForCategory={handleOpenEntriesForCategory}
          summaryFocusParam={summaryFocusParam}
        />

        <SummaryIntentVsOutcomeSection
          months={view.summaryPage.months}
          onOpenMonth={handleOpenMonth}
          onEditNote={(month, note) => setMonthNoteDialog({ month, draft: note ?? "" })}
        />
      </div>

      <SummaryAccountsSection
        accountPills={view.summaryPage.accountPills}
        onOpenEntriesForAccount={handleOpenEntriesForAccount}
      />

      <SummaryMonthNoteDialog
        monthNoteDialog={monthNoteDialog}
        onClose={() => setMonthNoteDialog(null)}
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
                {formatMonthLabel(month)}
              </button>
            ))}
          </div>

          <SpendingMixChart
            data={focusState.donutData}
            categories={categories}
            totalMinor={focusState.totalSpendMinor}
          />

          <div className="share-list">
            {focusState.donutData.map((item) => {
              const category = getCategory(categories, item);
              const categoryName = category?.name ?? item.label;
              return (
                <div key={item.key} className="share-row">
                  <div className="category-key">
                    <CategoryAppearancePopover
                      category={category}
                      onChange={onCategoryAppearanceChange}
                    />
                    <button
                      type="button"
                      className="share-row-button"
                      onClick={() => onOpenEntriesForCategory(categoryName)}
                    >
                      <strong>{categoryName}</strong>
                      <p>{money(item.valueMinor)}</p>
                      <span className="share-row-meta">
                        {formatTransactionCount(item.entryCount)}
                      </span>
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
                {formatMonthLabel(month.month)}
              </button>
              <p>{messages.summary.incomeLabel(money(month.plannedIncomeMinor), money(month.actualIncomeMinor))}</p>
            </div>
          </div>
          <span className={monthPlanReview.spendVarianceMinor >= 0 ? "positive" : "negative"}>
            {money(monthPlanReview.spendVarianceMinor)}
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
                <td>{money(month.plannedIncomeMinor)}</td>
                <td>{money(month.actualIncomeMinor)}</td>
                <td className={monthPlanReview.incomeVarianceMinor >= 0 ? "positive" : "negative"}>
                  {money(monthPlanReview.incomeVarianceMinor)}
                </td>
              </tr>
              <tr>
                <td>{messages.summary.table.expectedExpenses}</td>
                <td>{money(month.estimatedExpensesMinor)}</td>
                <td>{money(month.realExpensesMinor)}</td>
                <td className={monthPlanReview.spendVarianceMinor >= 0 ? "positive" : "negative"}>
                  {money(monthPlanReview.spendVarianceMinor)}
                </td>
              </tr>
              <tr>
                <td>{messages.summary.table.expectedSavings}</td>
                <td>{money(month.savingsGoalMinor)}</td>
                <td className={month.realizedSavingsMinor >= 0 ? "positive" : "negative"}>
                  {money(month.realizedSavingsMinor)}
                </td>
                <td className={monthPlanReview.savingsVarianceMinor >= 0 ? "positive" : "negative"}>
                  {money(monthPlanReview.savingsVarianceMinor)}
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
            <span className="summary-account-pill-name">{formatAccountDisplayName(account)}</span>
            <span className="summary-account-pill-amount">{money(account.balanceMinor)}</span>
            <span className="summary-account-pill-meta">{describeAccountHealth(account)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SummaryMonthNoteDialog({ monthNoteDialog, onClose, onChangeDraft, onSave }) {
  return (
    <Dialog.Root open={Boolean(monthNoteDialog)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content">
          <div className="note-dialog-head">
            <div>
              <Dialog.Title>{messages.month.notesTitle}</Dialog.Title>
              <Dialog.Description>{messages.month.notesDetail}</Dialog.Description>
            </div>
            <button
              type="button"
              className="icon-action subtle-cancel"
              aria-label="Close month note editor"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
          <textarea
            className="note-dialog-textarea"
            value={monthNoteDialog?.draft ?? ""}
            onChange={(event) => onChangeDraft(event.target.value)}
            rows={10}
          />
          <div className="note-dialog-actions">
            <button type="button" className="subtle-cancel" onClick={onClose}>
              {messages.month.cancelEdit}
            </button>
            <button type="button" className="dialog-primary" onClick={() => void onSave()}>
              {messages.month.doneEdit}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function buildSummaryFocusState(summaryPage, summaryFocusParam) {
  const latestRangeMonth = summaryPage.rangeMonths.at(-1) ?? "";
  const selectedFocusMonth = summaryFocusParam === SUMMARY_FOCUS_OVERALL
    ? ""
    : (summaryFocusParam && summaryPage.rangeMonths.includes(summaryFocusParam)
      ? summaryFocusParam
      : latestRangeMonth);
  const selectedDonutMonth = summaryPage.categoryShareByMonth.find((month) => month.month === selectedFocusMonth) ?? null;
  const donutData = selectedDonutMonth?.data ?? summaryPage.categoryShareChart;
  const totalSpendMinor = selectedDonutMonth
    ? summaryPage.months.find((month) => month.month === selectedDonutMonth.month)?.realExpensesMinor ?? 0
    : summaryPage.months.reduce((sum, month) => sum + month.realExpensesMinor, 0);

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
