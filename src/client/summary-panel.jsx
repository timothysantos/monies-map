import { createElement, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useLocation,
  useNavigate,
  useSearchParams
} from "react-router-dom";

import { messages } from "./copy/en-SG";
import { describeAccountHealth, formatAccountDisplayName } from "./account-display";
import { formatMonthLabel, money, unmaskedMoney } from "./formatters";
import "./summary-body.css";
import { buildSummaryEntriesForIdsLocation, buildSummaryEntriesLocation } from "./summary-workflow";
import { SummaryLead } from "./summary-lead";
import { buildSummaryLeadModel } from "./summary-lead-model";
import { useLeadView } from "./lead-view";
import { useSummaryCards } from "./summary-card-order";
import { FinancialInsight } from "./financial-insight";
import { checkInMemoryKey, useCheckInClock } from "./checkin-visit-memory";
import { useSummaryInsights } from "./money-insights-loader";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { useRouteWorkReport } from "./use-route-work-status";
import { useIsMobileLayout } from "./use-viewport";
import { reconciliationTone } from "../domain/money-tone";
import { moneyToneClass } from "./money-tone-class";
import { DetailRow, DetailRows } from "./ui/lead-support-detail";
import { SimpleDetail } from "./ui/spend-lead-group";
// Arrange cards loads only when it is opened.
const SummaryCardEditor = lazy(() => import("./summary-card-editor").then((module) => ({ default: module.SummaryCardEditor })));
// The Monthly Note dialog is only needed once a note is opened.
const MonthNoteDialog = lazy(() => import("./month-note-dialog"));
// Spending Mix sits under the lead and the insights: its section (the list,
// the donut's slice menus and their words) loads beside the first screen.
const SpendingMixSection = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.SpendingMixSection })));
// Intent vs Outcome sits below the fold, under Spending Mix: it loads beside
// the first screen, which keeps the lead's openable figures in budget.
// The column + line chart at the top of the month-by-month card (Plan and
// Simple), in its own chunk like Spending Mix.
// It is handed React rather than importing it, so the bundler adds no shared
// chunk to the first screen (earned-spent-chart.js).
const EarnedSpentChart = lazy(() => import("./earned-spent-chart.js").then((module) => ({
  default: module.createEarnedSpentChart({ createElement, useEffect, useLayoutEffect, useMemo, useRef, useState })
})));
const SummaryIntentVsOutcomeSection = lazy(() => import("./summary-intent-outcome").then((module) => ({ default: module.SummaryIntentVsOutcomeSection })));
// Subscriptions and bills sits under Money insights. Its code rides in
// Spending Mix's chunk (a chunk of its own moved React out of the entry into
// a new first-screen file, check:bundle); it renders, and reads its data,
// only once the top summary is usable.
const SubscriptionsSection = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.SubscriptionsSection })));
// Investments over time and Tax reliefs ride in the same chunk and read
// their data only once the top summary is usable; each shows nothing until
// it has something to show.
const InvestmentsCard = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.InvestmentsCard })));
const TaxReliefsCard = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.TaxReliefsCard })));
// What changed this month rides in the same chunk (a chunk of its own added
// two first-screen files, check:bundle), reads its data only once the top
// summary is usable and shows only for a range that ends in the month in
// progress.
const SummaryChangedSection = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.SummaryChangedSection })));
// Read alongside docs/import-summary-code-glossary.md.
// This panel has three main blocks:
// 1. Range-level metrics and spending mix.
// 2. Month-by-month "intent vs outcome" plan review (in the Simple view,
//    earned against spent by month instead).
// 3. Account health pills that stay independent from the selected range.
export function SummaryPanel({ view, selectedMonth, categories, accounts = [], onCategoryAppearanceChange, onRefresh, onOpenMonth, cardsUsable = false, fetchRequiredQuery = undefined, runBackgroundRefresh = undefined }) {
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobileLayout = useIsMobileLayout();
  const [monthNoteDialog, setMonthNoteDialog] = useState(null);
  const [summaryCards, saveSummaryCards] = useSummaryCards();
  const [arrangingCards, setArrangingCards] = useState(false);
  // Subscriptions and bills keeps the height it had on this device last
  // time while it loads, so nothing under it moves (none the first time).
  const [subsReserveHeight] = useState(readSubscriptionsCardHeight);
  const [isSavingMonthNote, setIsSavingMonthNote] = useState(false);
  const [monthNoteError, setMonthNoteError] = useState("");
  useRouteWorkReport({ busy: Boolean(monthNoteDialog) || isSavingMonthNote });
  const leadModel = useMemo(() => buildSummaryLeadModel(view.summaryPage?.metricCards, {
    categoryShare: view.summaryPage?.categoryShareChart,
    investmentMoves: view.summaryPage?.investmentMoves ?? null
  }), [view.summaryPage]);
  // Plan or Simple (lead-view.js): the lead and the month-by-month section
  // follow it. Until the figures arrive it is Plan, unless chosen before.
  const [leadView, setLeadView] = useLeadView();
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
  // The column + line chart above the month-by-month list: only for two or
  // more months, and never while money is hidden (it would show the money).
  const { areTotalsVisible: isMoneyShown } = useMoneyPrivacy();
  const monthChart = safeSummaryPage.months.length > 1 && isMoneyShown ? (
    <Suspense fallback={<div className="earned-spent-chart-reserve" aria-hidden="true" />}>
      <EarnedSpentChart key={leadView} mode={leadView} page={safeSummaryPage} />
    </Suspense>
  ) : null;

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
    contextKey: [safeSummaryPage.rangeMonths[0], safeSummaryPage.rangeMonths.at(-1), checkInFocusMonth, view.selectedScope].join("|") + (leadView === "simple" ? "|simple" : ""),
    // Simple shows no plan, so it leaves out the insights about the plan.
    signals: (leadView === "simple" ? summaryInsights.withoutPlanSignals : (signals) => signals)(summaryInsights.buildSummarySignals({
      audience: view.id === "household" ? "household" : "person",
      viewLabel: view.label,
      today: checkInClock.today,
      focusMonth: checkInFocusMonth,
      months: safeSummaryPage.months,
      categoryShareByMonth: safeSummaryPage.categoryShareByMonth,
      accountPills: safeSummaryPage.accountPills,
      accountKinds: Object.fromEntries(accounts.map((account) => [account.id, account.kind])),
      availableMonths: safeSummaryPage.availableMonths ?? [],
      bankFeesYear: safeSummaryPage.bankFeesYear,
      formatMoney: unmaskedMoney
    })),
    page: "summary",
    // The range's last month is the period Summary rotates by.
    period: safeSummaryPage.rangeMonths.at(-1) ?? checkInClock.today.slice(0, 7),
    triviaRotation: summaryInsights.SUMMARY_TRIVIA_ROTATION,
    calmLines: summaryInsights.SUMMARY_CALM_LINES,
    alsoLabel: "Also in this period",
    clock: checkInClock
  } : null), [accounts, checkInClock, checkInFocusMonth, leadView, safeSummaryPage, summaryInsights, view.id, view.label, view.selectedScope]);
  function handleCheckInAction(action) {
    if (action.id === "review-statement") {
      handleOpenImports();
    } else if (action.id === "open-category" && action.categoryName) {
      handleOpenEntriesForCategory(action.categoryName);
    } else if (action.id === "ask-question" && action.askText) {
      // The shell asks Ask, as a figure's Ask about this does.
      window.dispatchEvent(new CustomEvent("monies:money-action", { detail: { askText: action.askText } }));
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

  // The cards under the top summary (design.md "Arrange Summary"), in the
  // person's order; a hidden card is not drawn and reads nothing.
  const cardBody = {
    insights: (
      <FinancialInsight
        audienceName={view.id === "household" ? "" : view.label}
        checkIn={checkIn}
        onCheckInAction={handleCheckInAction}
        className="financial-insight-summary"
      />
    ),
    // Only for a range that ends in the month in progress; it shows nothing
    // when there is nothing to compare.
    changed: cardsUsable && fetchRequiredQuery && safeSummaryPage.rangeEndMonth === checkInClock.today.slice(0, 7) ? (
      <Suspense fallback={null}>
        <SummaryChangedSection view={view} enabled={cardsUsable} fetchRequiredQuery={fetchRequiredQuery} />
      </Suspense>
    ) : null,
    subs: cardsUsable && fetchRequiredQuery ? (
      <Suspense fallback={<SubscriptionsReserve height={subsReserveHeight} />}>
        <SubscriptionsSection view={view} categories={categories} enabled={cardsUsable} fetchRequiredQuery={fetchRequiredQuery} runBackgroundRefresh={runBackgroundRefresh} reserveHeight={subsReserveHeight} />
      </Suspense>
    ) : <SubscriptionsReserve height={subsReserveHeight} />,
    // Each hides itself until it has something to show (an empty slot).
    investments: cardsUsable && fetchRequiredQuery ? (
      <Suspense fallback={null}>
        <InvestmentsCard view={view} enabled={cardsUsable} fetchRequiredQuery={fetchRequiredQuery} />
      </Suspense>
    ) : null,
    taxreliefs: cardsUsable && fetchRequiredQuery ? (
      <Suspense fallback={null}>
        <TaxReliefsCard view={view} enabled={cardsUsable} fetchRequiredQuery={fetchRequiredQuery} />
      </Suspense>
    ) : null,
    mix: (
      // All months: the whole range's spending by category.
      <Suspense fallback={<div className="spending-mix-reserve" aria-hidden="true" />}>
        <SpendingMixSection
          donutData={safeSummaryPage.categoryShareChart}
          categories={categories}
          onCategoryAppearanceChange={onCategoryAppearanceChange}
          period={`${safeSummaryPage.rangeStartMonth}:${safeSummaryPage.rangeEndMonth}`}
        />
      </Suspense>
    ),
    plan: leadView === "simple" ? (
      // The Simple view's month list, loaded only in Simple.
      <Suspense fallback={null}>
        <SimpleDetail
          part="months"
          months={safeSummaryPage.months}
          categoryShareByMonth={safeSummaryPage.categoryShareByMonth}
          investmentMovesByMonth={safeSummaryPage.investmentMovesByMonth}
          onOpenMonth={onOpenMonth}
          chart={monthChart}
        />
      </Suspense>
    ) : (
      <Suspense fallback={null}>
        <SummaryIntentVsOutcomeSection
          months={safeSummaryPage.months}
          onOpenMonth={onOpenMonth}
          chart={monthChart}
          onEditNote={(month, note) => setMonthNoteDialog({ month, draft: note ?? "" })}
        />
      </Suspense>
    ),
    accounts: (
      <SummaryAccountsSection
        accountPills={safeSummaryPage.accountPills}
        onOpenEntriesForAccount={handleOpenEntriesForAccount}
      />
    )
  };

  return (
    <article className="panel panel-accent">
      <div className="panel-head summary-head">
        <div>
          <h2>{messages.tabs.summary}</h2>
          {isMobileLayout ? null : <>
            <span className="panel-context">{messages.common.viewingDot(view.label)}</span>
            <SummaryScopeSwitch view={view} onScopeChange={handleScopeChange} />
          </>}
        </div>
        <SummaryLead
          model={leadModel}
          view={leadView}
          onViewChange={setLeadView}
          categoryShare={safeSummaryPage.categoryShareChart}
          rangeStartMonth={safeSummaryPage.rangeStartMonth}
          rangeEndMonth={safeSummaryPage.rangeEndMonth}
        />
      </div>

      {summaryCards.filter((card) => !card.hidden).reduce((blocks, card, index, shown) => {
        // Spending Mix and the month-by-month card sit side by side when
        // they are next to each other (in either order), as they always did.
        const next = shown[index + 1];
        if (blocks.paired.has(card.id)) return blocks;
        if ((card.id === "mix" && next?.id === "plan") || (card.id === "plan" && next?.id === "mix")) {
          blocks.paired.add(next.id);
          blocks.list.push(
            <div key="mix-plan" className="summary-top-grid has-intent-grid">
              {cardBody[card.id]}
              {cardBody[next.id]}
            </div>
          );
        } else if (card.id === "mix" || card.id === "plan") {
          blocks.list.push(<div key={card.id} className="summary-card-solo">{cardBody[card.id]}</div>);
        } else {
          blocks.list.push(<div key={card.id} className="summary-card-slot" data-summary-card={card.id}>{cardBody[card.id]}</div>);
        }
        return blocks;
      }, { list: [], paired: new Set() }).list}

      <p className="summary-cards-arrange">
        <button type="button" className="subtle-action" onClick={() => setArrangingCards(true)}>
          {isMobileLayout ? "Edit cards" : "Arrange cards"}
        </button>
      </p>

      {arrangingCards ? (
        <Suspense fallback={null}>
          <SummaryCardEditor
            cards={summaryCards}
            leadView={leadView}
            phone={isMobileLayout}
            onSave={(cards) => {
              saveSummaryCards(cards);
              setArrangingCards(false);
            }}
            onClose={() => setArrangingCards(false)}
          />
        </Suspense>
      ) : null}

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

// The height Subscriptions and bills had last time on this device
// (subscriptions-section.jsx writes it; 0 when it showed nothing).
const SUBSCRIPTIONS_HEIGHT_KEY = "monies-map:subs-card-height";

function readSubscriptionsCardHeight() {
  try {
    const value = Number(window.localStorage.getItem(SUBSCRIPTIONS_HEIGHT_KEY));
    return Number.isFinite(value) && value > 0 ? Math.min(value, 2000) : 0;
  } catch {
    return 0;
  }
}

function SubscriptionsReserve({ height }) {
  return height ? <div className="subs-reserve" aria-hidden="true" style={{ minHeight: height }} /> : null;
}

// A person view's figures follow the route's scope, so desktop Summary names
// the scope they count with a compact one-click switch in the title row,
// after "Viewing • Tim", above the full-width lead (Plan and Simple alike;
// .summary-head in styles.css). What each scope counts is the option's
// tooltip. The page view carries the scope of the
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
          <h3>The accounts shown</h3>
          <p>Current wallet balances from the ledger. These do not change with the selected summary range.</p>
        </div>
        <DetailRows label="The accounts shown">
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
