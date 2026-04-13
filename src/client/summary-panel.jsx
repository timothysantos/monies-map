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

export function SummaryPanel({ view, selectedMonth, categories, onCategoryAppearanceChange, onRefresh }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [monthNoteDialog, setMonthNoteDialog] = useState(null);
  const summaryFocusParam = searchParams.get("summary_focus");
  const latestRangeMonth = view.summaryPage.rangeMonths.at(-1) ?? "";
  const selectedFocusMonth = summaryFocusParam === SUMMARY_FOCUS_OVERALL
    ? ""
    : (summaryFocusParam && view.summaryPage.rangeMonths.includes(summaryFocusParam)
      ? summaryFocusParam
      : latestRangeMonth);
  const selectedDonutMonth = view.summaryPage.categoryShareByMonth.find((month) => month.month === selectedFocusMonth) ?? null;
  const donutData = selectedDonutMonth?.data ?? view.summaryPage.categoryShareChart;
  const totalSpendMinor = donutData.reduce((sum, item) => sum + item.valueMinor, 0);

  function handleFocusChange(value) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value) {
        next.set("summary_focus", SUMMARY_FOCUS_OVERALL);
      } else {
        next.set("summary_focus", value);
      }
      return next;
    });
  }

  function handleOpenEntriesForCategory(categoryName) {
    const next = new URLSearchParams(location.search);
    next.delete("entry_wallet");
    next.delete("entry_person");
    next.delete("entry_type");
    next.set("entry_category", categoryName);
    if (selectedFocusMonth) {
      next.set("month", selectedFocusMonth);
    }
    navigate({
      pathname: "/entries",
      search: `?${next.toString()}`
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

  function handleOpenEntriesForAccount(accountName) {
    const next = new URLSearchParams(location.search);
    next.delete("entry_category");
    next.delete("entry_person");
    next.delete("entry_type");
    next.set("month", selectedFocusMonth || selectedMonth);
    next.set("entry_wallet", accountName);
    navigate({
      pathname: "/entries",
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
                  onClick={() => handleFocusChange("")}
                >
                  {messages.summary.rangeOverall}
                </button>
                {view.summaryPage.rangeMonths.slice().reverse().map((month) => (
                  <button
                    key={month}
                    type="button"
                    className={`summary-focus-button ${selectedFocusMonth === month ? "is-active" : ""}`}
                    onClick={() => handleFocusChange(month)}
                  >
                    {formatMonthLabel(month)}
                  </button>
                ))}
              </div>
              <SpendingMixChart data={donutData} categories={categories} />
              <div className="share-list">
                {donutData.map((item) => {
                  const category = getCategory(categories, item);
                  return (
                    <div
                      key={item.key}
                      className="share-row"
                    >
                      <div className="category-key">
                        <CategoryAppearancePopover
                          category={category}
                          onChange={onCategoryAppearanceChange}
                        />
                        <button
                          type="button"
                          className="share-row-button"
                          onClick={() => handleOpenEntriesForCategory(category?.name ?? item.label)}
                        >
                          <strong>{category?.name ?? item.label}</strong>
                          <p>{money(item.valueMinor)}</p>
                          <span className="share-row-meta">
                            {item.entryCount === 1 ? "1 transaction" : `${item.entryCount ?? 0} transactions`}
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

        <section className="chart-card">
          <div className="chart-head">
            <h3>{messages.summary.intentVsOutcome}</h3>
            <p>{messages.summary.intentVsOutcomeDetail}</p>
          </div>
          <div className="chart-bars">
            {[...view.summaryPage.months]
              .sort((left, right) => right.month.localeCompare(left.month))
              .map((month, index) => {
                const spendVarianceMinor = month.estimatedExpensesMinor - month.realExpensesMinor;
                const savingsVarianceMinor = month.realizedSavingsMinor - month.savingsGoalMinor;
                return (
                  <details key={month.month} className="plan-row-card" open={index === 0}>
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
                                handleOpenMonth(month.month);
                              }}
                            >
                              {formatMonthLabel(month.month)}
                            </button>
                            <p>{messages.summary.incomeLabel(money(month.incomeMinor))}</p>
                          </div>
                        </div>
                        <span className={spendVarianceMinor >= 0 ? "positive" : "negative"}>
                          {money(spendVarianceMinor)}
                        </span>
                      </div>
                    </summary>
                    <div className="plan-row-content">
                      <BarLine
                        label={messages.month.table.planned}
                        valueMinor={month.estimatedExpensesMinor}
                        maxMinor={Math.max(month.realExpensesMinor, month.estimatedExpensesMinor)}
                        tone="planned"
                      />
                      <BarLine
                        label={messages.month.table.actual}
                        valueMinor={month.realExpensesMinor}
                        maxMinor={Math.max(month.realExpensesMinor, month.estimatedExpensesMinor)}
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
                              <td>{messages.summary.table.expectedExpenses}</td>
                              <td>{money(month.estimatedExpensesMinor)}</td>
                              <td>{money(month.realExpensesMinor)}</td>
                              <td className={spendVarianceMinor >= 0 ? "positive" : "negative"}>
                                {money(spendVarianceMinor)}
                              </td>
                            </tr>
                            <tr>
                              <td>{messages.summary.table.expectedSavings}</td>
                              <td>{money(month.savingsGoalMinor)}</td>
                              <td className={month.realizedSavingsMinor >= 0 ? "positive" : "negative"}>
                                {money(month.realizedSavingsMinor)}
                              </td>
                              <td className={savingsVarianceMinor >= 0 ? "positive" : "negative"}>
                                {money(savingsVarianceMinor)}
                              </td>
                            </tr>
                            <tr className="summary-context-row">
                              <td colSpan={4}>
                                <button
                                  type="button"
                                  className="note-trigger summary-note-trigger"
                                  onClick={() => setMonthNoteDialog({ month: month.month, draft: month.note ?? "" })}
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
              })}
          </div>
        </section>
      </div>

      {view.summaryPage.accountPills.length ? (
        <section className="summary-accounts">
          <div className="panel-subhead">
            <h3>Wallets in view</h3>
            <p>Current wallet balances from the ledger. These do not change with the selected summary range.</p>
          </div>
          <div className="summary-account-pills">
            {view.summaryPage.accountPills.map((account) => (
              <button
                key={account.accountId}
                type="button"
                className={`summary-account-pill ${account.reconciliationStatus ? `is-${account.reconciliationStatus}` : ""}`}
                onClick={() => handleOpenEntriesForAccount(account.accountName)}
              >
                <span className="summary-account-pill-name">{formatAccountDisplayName(account)}</span>
                <span className="summary-account-pill-amount">{money(account.balanceMinor)}</span>
                <span className="summary-account-pill-meta">{describeAccountHealth(account)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <Dialog.Root open={Boolean(monthNoteDialog)} onOpenChange={(open) => { if (!open) setMonthNoteDialog(null); }}>
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
                onClick={() => setMonthNoteDialog(null)}
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              className="note-dialog-textarea"
              value={monthNoteDialog?.draft ?? ""}
              onChange={(event) => setMonthNoteDialog((current) => current ? { ...current, draft: event.target.value } : current)}
              rows={10}
            />
            <div className="note-dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setMonthNoteDialog(null)}>
                {messages.month.cancelEdit}
              </button>
              <button type="button" className="dialog-primary" onClick={() => void saveSummaryMonthNote()}>
                {messages.month.doneEdit}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </article>
  );
}
