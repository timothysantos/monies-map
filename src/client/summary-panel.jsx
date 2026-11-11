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
import { packSummarySpans, showsAsTile, SUMMARY_CARD_LAYOUT, SUMMARY_LEAD_SPAN, summaryTileFromHash, summaryTileHash, useSummaryCards } from "./summary-card-order";
import { FinancialInsight } from "./financial-insight";
import { checkInMemoryKey, useCheckInClock } from "./checkin-visit-memory";
import { useSummaryInsights } from "./money-insights-loader";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { useRouteWorkReport } from "./use-route-work-status";
import { useIsMobileLayout, useMediaQuery } from "./use-viewport";
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
const PaceChartSection = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.PaceChartSection })));
// Investments over time and Tax reliefs ride in the same chunk and read
// their data only once the top summary is usable; each shows nothing until
// it has something to show.
const CardRewardsSection = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.CardRewardsSection })));
const InvestmentsCard = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.InvestmentsCard })));
const TaxReliefsCard = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.TaxReliefsCard })));
// What changed this month rides in the same chunk (a chunk of its own added
// two first-screen files, check:bundle), reads its data only once the top
// summary is usable and shows only for a range that ends in the month in
// progress.
// The small tile each card can stand in as, and the sheet or dialog that opens
// the whole card from one (design.md "Summary tiles"), ride in the same chunk.
const SummaryTile = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.SummaryTile })));
const SummaryTileSheet = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.SummaryTileSheet })));
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
  // From a 1,100px window the big cards show in full; below it (and for the
  // cards that are always tiles) a tile stands in and opens the card in a sheet.
  const isDesktop = useMediaQuery("(min-width: 1100px)");
  const [monthNoteDialog, setMonthNoteDialog] = useState(null);
  const [summaryCards, saveSummaryCards] = useSummaryCards();
  const [arrangingCards, setArrangingCards] = useState(false);
  // Subscriptions and bills keeps the height it had on this device last
  // time while it loads, so nothing under it moves (none the first time).
  const [subsReserveHeight] = useState(readSubscriptionsCardHeight);
  const [isSavingMonthNote, setIsSavingMonthNote] = useState(false);
  const [monthNoteError, setMonthNoteError] = useState("");
  useRouteWorkReport({ busy: Boolean(monthNoteDialog) || isSavingMonthNote });
  // Summary is wider than the other pages (summary-body.css).
  useLayoutEffect(() => {
    document.body.dataset.summaryDashboard = "";
    return () => { delete document.body.dataset.summaryDashboard; };
  }, []);
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
  // If this keeps up (DOMAIN.md "Pace"): when the range ends in this month,
  // the current month's column carries the low-to-high range and the
  // sentence sits under the chart (or, when it cannot show, one line saying
  // why). The section owns the chart then, so it stays in one place in the
  // tree; its data is read once the top summary is usable.
  const thisMonth = useCheckInClock().today.slice(0, 7);
  const currentMonthRow = safeSummaryPage.months.find((month) => month.month === thisMonth);
  const renderMonthChart = (pace) => (
    <Suspense fallback={<div className="earned-spent-chart-reserve" aria-hidden="true" />}>
      <EarnedSpentChart key={leadView} mode={leadView} page={safeSummaryPage} pace={pace} />
    </Suspense>
  );
  const monthChart = safeSummaryPage.months.length > 1 && isMoneyShown ? (
    fetchRequiredQuery && currentMonthRow && safeSummaryPage.rangeEndMonth === thisMonth ? (
      <Suspense fallback={<div className="earned-spent-chart-reserve" aria-hidden="true" />}>
        <PaceChartSection
          view={view}
          enabled={cardsUsable}
          fetchRequiredQuery={fetchRequiredQuery}
          renderChart={renderMonthChart}
          spentSoFarMinor={currentMonthRow.realExpensesMinor ?? null}
          planMinor={leadView === "plan" ? currentMonthRow.estimatedExpensesMinor ?? null : null}
          showLeft
          yearMonths={safeSummaryPage.months}
          onOpenImports={handleOpenImports}
        />
      </Suspense>
    ) : renderMonthChart(null)
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

  // A tile opens its card in the sheet: the URL gets #summary-<card> (a push,
  // so Back closes it; opened from a link there is nothing to go back to).
  const tileTriggerRef = useRef(null);
  function openTile(id) {
    tileTriggerRef.current = document.activeElement;
    navigate({ pathname: location.pathname, search: location.search, hash: summaryTileHash(id) }, { state: { summaryTile: true } });
  }
  function closeTile() {
    if (location.state?.summaryTile) {
      navigate(-1);
    } else {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    }
    // Focus goes back to the tile that opened it, after the sheet is gone.
    window.setTimeout(() => {
      const trigger = tileTriggerRef.current;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    }, 80);
  }
  const tileBody = (id) => (cardsUsable && fetchRequiredQuery ? (
    <Suspense fallback={<div className="summary-tile-reserve" aria-hidden="true" />}>
      <SummaryTile id={id} view={view} enabled={cardsUsable} fetchRequiredQuery={fetchRequiredQuery} fees={safeSummaryPage.bankFeesYear} onOpen={openTile} />
    </Suspense>
  ) : <div className="summary-tile-reserve" aria-hidden="true" />);

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
    // Coming up and Bank fees this year are tiles; their card is the sheet.
    coming: tileBody("coming"),
    bankfees: tileBody("bankfees"),
    subs: cardsUsable && fetchRequiredQuery ? (
      <Suspense fallback={<SubscriptionsReserve height={subsReserveHeight} />}>
        <SubscriptionsSection view={view} categories={categories} enabled={cardsUsable} fetchRequiredQuery={fetchRequiredQuery} runBackgroundRefresh={runBackgroundRefresh} reserveHeight={subsReserveHeight} />
      </Suspense>
    ) : <SubscriptionsReserve height={subsReserveHeight} />,
    // Miles and cashback reads its data only once the top summary is usable.
    miles: cardsUsable && fetchRequiredQuery ? (
      <Suspense fallback={null}>
        <CardRewardsSection view={view} enabled={cardsUsable} fetchRequiredQuery={fetchRequiredQuery} />
      </Suspense>
    ) : null,
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
          dashboard
          spendChange={safeSummaryPage.spendChange}
          period={`${safeSummaryPage.rangeStartMonth}:${safeSummaryPage.rangeEndMonth}`}
        />
      </Suspense>
    ),
    plan: leadView === "simple" ? (
      // The Simple view's month list, loaded only in Simple.
      <Suspense fallback={<div className="summary-plan-reserve" aria-hidden="true" />}>
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
      <Suspense fallback={<div className="summary-plan-reserve" aria-hidden="true" />}>
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

  // Where each card sits on the grid: 12 columns on a wide page, 2 on a
  // tablet, 1 on a phone (the CSS picks by the page's width).
  const shownCards = summaryCards.filter((card) => !card.hidden && cardBody[card.id] !== null);
  // Cards that draw as tiles sit together, 3 across on a desktop and 2 across
  // on a tablet or phone, as one full-width block of the grid.
  const blocks = [];
  for (const card of shownCards) {
    const last = blocks.at(-1);
    if (showsAsTile(card.id, isDesktop)) {
      if (last?.tiles) last.ids.push(card.id);
      else blocks.push({ tiles: true, ids: [card.id] });
    } else {
      blocks.push({ tiles: false, id: card.id });
    }
  }
  const defaultSpans = [SUMMARY_LEAD_SPAN, ...blocks.map((block) => (block.tiles ? 12 : SUMMARY_CARD_LAYOUT[block.id].span))];
  const wideSpans = packSummarySpans(defaultSpans, 12);
  const tabletSpans = packSummarySpans(defaultSpans, 2);
  const spanStyle = (index) => ({ "--s12": wideSpans[index], "--s2": tabletSpans[index] });
  const slotSpans = { lead: spanStyle(0), blocks: blocks.map((_, index) => spanStyle(index + 1)) };
  const sheetId = summaryTileFromHash(location.hash);
  const sheetOpen = Boolean(sheetId) && summaryCards.some((card) => card.id === sheetId && !card.hidden);

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
      </div>

      {/* The dashboard grid (design.md "Summary dashboard layout"): the lead
          and the shown cards in the person's order, each on its default span
          of the 12 columns (summary-card-order.js). Rows fill in order and the
          last card of a short row grows, so a hidden card leaves no hole. A
          card with no body (What changed this month outside the month in
          progress) takes no place. */}
      <div className="summary-grid" data-summary-grid>
        <div className="summary-lead-slot" style={slotSpans.lead}>
          <SummaryLead
            model={leadModel}
            view={leadView}
            onViewChange={setLeadView}
            categoryShare={safeSummaryPage.categoryShareChart}
            rangeStartMonth={safeSummaryPage.rangeStartMonth}
            rangeEndMonth={safeSummaryPage.rangeEndMonth}
          />
        </div>
        {blocks.map((block, index) => (block.tiles ? (
          <div key={block.ids.join("-")} className="summary-tiles" data-summary-tiles style={slotSpans.blocks[index]}>
            {block.ids.map((id) => <div key={id} className="summary-tile-cell" data-summary-card={id}>{tileBody(id)}</div>)}
          </div>
        ) : (
          <div key={block.id} className="summary-card-slot" data-summary-card={block.id} data-span={SUMMARY_CARD_LAYOUT[block.id].span} style={slotSpans.blocks[index]}>{cardBody[block.id]}</div>
        )))}
      </div>

      <p className="summary-cards-arrange">
        <button type="button" className="subtle-action" onClick={() => setArrangingCards(true)}>
          {isMobileLayout ? "Edit cards" : "Arrange cards"}
        </button>
      </p>

      {sheetOpen ? (
        <Suspense fallback={null}>
          <SummaryTileSheet
            id={sheetId}
            view={view}
            categories={categories}
            enabled={cardsUsable}
            fetchRequiredQuery={fetchRequiredQuery}
            runBackgroundRefresh={runBackgroundRefresh}
            fees={safeSummaryPage.bankFeesYear}
            rangeEndMonth={safeSummaryPage.rangeEndMonth}
            onClose={closeTile}
          />
        </Suspense>
      ) : null}

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
// It starts as a glance: the first few rows and "Show all N ›".
const ACCOUNTS_GLANCE = 3;

function SummaryAccountsSection({ accountPills, onOpenEntriesForAccount }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const [showAll, setShowAll] = useState(false);
  if (!accountPills.length) {
    return null;
  }
  const listed = showAll ? accountPills : accountPills.slice(0, ACCOUNTS_GLANCE);

  return (
    <section className="summary-accounts">
      <div className="summary-accounts-body">
        <div className="summary-accounts-head">
          <h3>The accounts shown</h3>
          <p>Current wallet balances from the ledger. These do not change with the selected summary range.</p>
        </div>
        <DetailRows label="The accounts shown">
          {listed.map((account) => (
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
          {accountPills.length > ACCOUNTS_GLANCE ? (
            <button type="button" className="lsd-row summary-accounts-more" aria-expanded={showAll} onClick={() => setShowAll((current) => !current)}>
              {showAll ? messages.summary.accountsShowFewer : messages.summary.accountsShowAll(accountPills.length)}
            </button>
          ) : null}
        </DetailRows>
      </div>
    </section>
  );
}
