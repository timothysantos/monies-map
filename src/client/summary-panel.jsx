import { ChevronRight } from "lucide-react";
import { createElement, lazy, Suspense, useMemo, useState } from "react";
import {
  useLocation,
  useNavigate,
  useSearchParams
} from "react-router-dom";

import { messages } from "./copy/en-SG";
import { describeAccountHealth, formatAccountDisplayName } from "./account-display";
import { formatMonthLabel, money, unmaskedMoney } from "./formatters";
import "./summary-body.css";
import { SpendingMixSection } from "./spending-mix-section";
import { buildSummaryEntriesForIdsLocation, buildSummaryEntriesLocation } from "./summary-workflow";
import { SummaryLead } from "./summary-lead";
import { buildSummaryLeadModel } from "./summary-lead-model";
import { useLeadView } from "./lead-view";
import { SummaryIntentVsOutcomeSection } from "./summary-intent-outcome";
import { FinancialInsight } from "./financial-insight";
import { checkInMemoryKey, useCheckInClock } from "./checkin-visit-memory";
import { useSummaryInsights } from "./money-insights-loader";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { useRouteWorkReport } from "./use-route-work-status";
import { useIsMobileLayout } from "./use-viewport";
import { reconciliationTone } from "../domain/money-tone";
import { moneyToneClass } from "./money-tone-class";
import { DetailRow, DetailRows } from "./ui-components";
// The Monthly Note dialog is only needed once a note is opened.
const MonthNoteDialog = lazy(() => import("./month-note-dialog"));
// The Simple view's month list replaces Intent vs Outcome; only Simple needs
// it. Its module imports no React (summary-earned-spent.js), so it is handed
// createElement and the chevron here and adds no first-screen file.
const SummaryEarnedSpentSection = lazy(() => import("./summary-earned-spent.js").then(({ renderEarnedSpent }) => ({
  default: function EarnedSpentSection(props) {
    const { areTotalsVisible } = useMoneyPrivacy();
    return renderEarnedSpent(createElement, { ...props, hidden: !areTotalsVisible, MonthIcon: ChevronRight });
  }
})));
// Read alongside docs/import-summary-code-glossary.md.
// This panel has three main blocks:
// 1. Range-level metrics and spending mix.
// 2. Month-by-month "intent vs outcome" plan review (in the Simple view,
//    earned against spent by month instead).
// 3. Account health pills that stay independent from the selected range.
export function SummaryPanel({ view, selectedMonth, categories, accounts = [], onCategoryAppearanceChange, onRefresh, onOpenMonth }) {
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobileLayout = useIsMobileLayout();
  const [monthNoteDialog, setMonthNoteDialog] = useState(null);
  const [isSavingMonthNote, setIsSavingMonthNote] = useState(false);
  const [monthNoteError, setMonthNoteError] = useState("");
  useRouteWorkReport({ busy: Boolean(monthNoteDialog) || isSavingMonthNote });
  const leadModel = useMemo(() => buildSummaryLeadModel(view.summaryPage?.metricCards, {
    categoryShare: view.summaryPage?.categoryShareChart,
    investmentMoves: view.summaryPage?.investmentMoves ?? null
  }), [view.summaryPage]);
  // Plan or Simple (lead-view.js): the lead and the month-by-month section
  // follow it. Until the figures arrive it is Plan, unless chosen before.
  const [leadView, setLeadView] = useLeadView(leadModel ? leadModel.hasPlan : null);
  // Summary can mount while the route payload is still hydrating, so keep a
  // fully shaped local summary slice instead of reading nested fields directly.
  const safeSummaryPage = useMemo(() => ({
    metricCards: [],
    rangeMonths: [],
    categoryShareByMonth: [],
    categoryShareChart: [],
    months: [],
    accountPills: [],
    ...view.summaryPage
  }), [view.summaryPage]);

  // Summary is the Summary tab's "All months": its Spending Mix covers the
  // whole range. One month of it is the Month page, picked with the tab's
  // month control (summary-month-choice.js), which replaced Spending Mix's
  // own month chips. The money check-in keeps the focus it had by default
  // before: its month-level lines talk about the range's latest month.
  const checkInFocusMonth = safeSummaryPage.rangeMonths.at(-1) ?? "";
  const checkInClock = useCheckInClock();
  const summaryInsights = useSummaryInsights();
  // Null until the insights module arrives: the insights show their frame.
  const checkIn = useMemo(() => (summaryInsights ? {
    memoryKey: checkInMemoryKey("summary", view.id),
    contextKey: [safeSummaryPage.rangeMonths[0], safeSummaryPage.rangeMonths.at(-1), checkInFocusMonth, view.selectedScope].join("|"),
    signals: summaryInsights.buildSummarySignals({
      audience: view.id === "household" ? "household" : "person",
      viewLabel: view.label,
      today: checkInClock.today,
      focusMonth: checkInFocusMonth,
      months: safeSummaryPage.months,
      categoryShareByMonth: safeSummaryPage.categoryShareByMonth,
      accountPills: safeSummaryPage.accountPills,
      accountKinds: Object.fromEntries(accounts.map((account) => [account.id, account.kind])),
      availableMonths: safeSummaryPage.availableMonths ?? [],
      formatMoney: unmaskedMoney
    }),
    page: "summary",
    // The range's last month is the period Summary rotates by.
    period: safeSummaryPage.rangeMonths.at(-1) ?? checkInClock.today.slice(0, 7),
    triviaRotation: summaryInsights.SUMMARY_TRIVIA_ROTATION,
    calmLines: summaryInsights.SUMMARY_CALM_LINES,
    alsoLabel: "Also in this period",
    clock: checkInClock
  } : null), [accounts, checkInClock, checkInFocusMonth, safeSummaryPage, summaryInsights, view.id, view.label, view.selectedScope]);
  function handleCheckInAction(action) {
    if (action.id === "review-statement") {
      handleOpenImports();
    } else if (action.id === "open-category" && action.categoryName) {
      handleOpenEntriesForCategory(action.categoryName);
    } else if (action.id === "show-entries" && action.entryIds?.length) {
      navigate(buildSummaryEntriesForIdsLocation(location.search, action));
    }
  }

  function navigateToEntries(nextFilters) {
    navigate(buildSummaryEntriesLocation(location.search, nextFilters));
  }

  // Scope is a route parameter, as on Month: the route reloads Summary for it.
  function handleScopeChange(scopeKey) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("scope", scopeKey);
      return next;
    });
  }

  function handleOpenEntriesForCategory(categoryName) {
    navigateToEntries({ entry_category: categoryName });
  }

  function handleOpenEntriesForAccount(accountId) {
    navigateToEntries({
      entry_wallet: accountId,
      month: selectedMonth
    });
  }

  function handleOpenImports() {
    navigate({
      pathname: "/imports",
      search: location.search
    });
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
          {/* A phone switches scope from the floating View and scope bar instead. */}
          {isMobileLayout ? null : <SummaryScopeSwitch view={view} onScopeChange={handleScopeChange} />}
        </div>
        <SummaryLead
          model={leadModel}
          view={leadView}
          onViewChange={setLeadView}
          rangeStartMonth={safeSummaryPage.rangeStartMonth}
          rangeEndMonth={safeSummaryPage.rangeEndMonth}
        />
      </div>

      <FinancialInsight
        audienceName={view.id === "household" ? "" : view.label}
        checkIn={checkIn}
        onCheckInAction={handleCheckInAction}
        className="financial-insight-summary"
      />

      <div className="summary-top-grid has-intent-grid">
        {/* All months: the whole range's spending by category. */}
        <SpendingMixSection
          donutData={safeSummaryPage.categoryShareChart}
          categories={categories}
          onCategoryAppearanceChange={onCategoryAppearanceChange}
          onOpenEntriesForCategory={handleOpenEntriesForCategory}
        />

        {leadView === "simple" ? (
          <Suspense fallback={null}>
            <SummaryEarnedSpentSection
              months={safeSummaryPage.months}
              categoryShareByMonth={safeSummaryPage.categoryShareByMonth}
              onOpenMonth={onOpenMonth}
            />
          </Suspense>
        ) : (
          <SummaryIntentVsOutcomeSection
            months={safeSummaryPage.months}
            onOpenMonth={onOpenMonth}
            onEditNote={(month, note) => setMonthNoteDialog({ month, draft: note ?? "" })}
          />
        )}
      </div>

      <SummaryAccountsSection
        accountPills={safeSummaryPage.accountPills}
        onOpenEntriesForAccount={handleOpenEntriesForAccount}
      />

      {monthNoteDialog ? (
        <Suspense fallback={null}>
          <MonthNoteDialog
            monthLabel={`${formatMonthLabel(monthNoteDialog.month)} · ${view.label}`}
            value={monthNoteDialog.draft ?? ""}
            onChange={(draft) => setMonthNoteDialog((current) => (current ? { ...current, draft } : current))}
            errorMessage={monthNoteError}
            isSaving={isSavingMonthNote}
            onSave={saveSummaryMonthNote}
            onClose={() => {
              if (!isSavingMonthNote) {
                setMonthNoteDialog(null);
                setMonthNoteError("");
              }
            }}
          />
        </Suspense>
      ) : null}
    </article>
  );
}

// A person view's figures follow the route's scope, so desktop Summary names
// the scope they count with a compact one-click switch in the empty space
// under its title, beside the taller metric cards. It adds no height, and no
// width to the title column: `contain: inline-size` drops its content size and
// a -12px margin cancels the title row's flex gap (.summary-scope-switch in
// styles.css). Where the header stacks (960px and below) it joins the title
// row instead. What each scope counts is the option's tooltip. The page view carries the scope of the
// request the figures answer (buildSummaryPageView), so it never runs ahead of
// them. The household has one Combined scope and no switch. On a phone the
// floating View and scope bar in App.jsx is the one scope control.
function SummaryScopeSwitch({ view, onScopeChange }) {
  const scopes = view.scopes ?? [];
  if (scopes.length < 2) {
    return null;
  }
  const { selectedScope } = view;
  return (
    <div className="summary-scope-switch">
      <div className="scope-toggle pill-row" role="group" aria-label={messages.summary.scope}>
        {scopes.map((scope) => (
          <button
            key={scope.key}
            className={`pill scope-button ${scope.key === selectedScope ? "is-active" : ""}`}
            type="button"
            aria-pressed={scope.key === selectedScope}
            title={messages.views.scopeHint[scope.key]?.(view.label)}
            onClick={() => onScopeChange(scope.key)}
          >
            {messages.summary.scopeSwitchLabel[scope.key] ?? scope.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Wallets in view (design.md, "Summary body"): one group of rows, each the
// wallet, how fresh its statement is (not shown while money is hidden, as it
// says which side of the statement the wallet is on) and its balance.
function SummaryAccountsSection({ accountPills, onOpenEntriesForAccount }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  if (!accountPills.length) {
    return null;
  }

  return (
    <section className="summary-accounts">
      <div className="summary-accounts-body">
        <div className="summary-accounts-head">
          <h3>Wallets in view</h3>
          <p>Current wallet balances from the ledger. These do not change with the selected summary range.</p>
        </div>
        <DetailRows label="Wallets in view">
          {accountPills.map((account) => (
            <DetailRow
              key={account.accountId}
              className="summary-wallet-row"
              label={(
                <>
                  <span className="summary-wallet-name">{formatAccountDisplayName(account)}</span>
                  {areTotalsVisible ? (
                    <span className={`summary-wallet-health ${moneyToneClass(reconciliationTone(account.reconciliationStatus))}`}>
                      {describeAccountHealth(account)}
                    </span>
                  ) : null}
                </>
              )}
              value={<PrivateMoney>{money(account.balanceMinor)}</PrivateMoney>}
              onClick={() => onOpenEntriesForAccount(account.accountId)}
            />
          ))}
        </DetailRows>
      </div>
    </section>
  );
}
