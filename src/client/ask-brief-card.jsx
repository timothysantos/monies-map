import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { spendTone } from "../domain/money-tone";
import { applyCheckInAction } from "./check-in-action";
import { askCopy } from "./copy/ask-copy";
import { useCachedSummary } from "./ask-data";
// The check-in's own composer, kind chip and styles (money-checkin.css).
import { CheckInChip, checkInMemoryKey, composeCheckInHeadline, useCheckInClock } from "./financial-insight";
import { money, unmaskedMoney } from "./formatters";
import { useSummaryInsights } from "./money-insights-loader";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";

// "Since you last looked" (design.md "Ask page"): the Summary check-in's
// headline for this view, read from the Summary page and wallet pills that
// are already cached, and the month's spend against its plan. Nothing is
// fetched for it and no AI is asked: with no cached Summary it does not
// show. It only reads the visit memory, never records a visit (Summary
// does that when it is opened).
export function AskBriefCard({ queryClient, view, scope, month, accounts, params }) {
  const navigate = useNavigate();
  const { areTotalsVisible } = useMoneyPrivacy();
  const summary = useCachedSummary(queryClient, { viewId: view.id, scope, month, enabled: true });
  const insights = useSummaryInsights();
  const clock = useCheckInClock();

  const headline = useMemo(() => {
    if (!summary || !insights) {
      return null;
    }
    const page = summary.summaryPage;
    const contextKey = [page.rangeMonths?.[0], page.rangeMonths?.at(-1), month, scope].join("|");
    const memoryKey = checkInMemoryKey("summary", view.id);
    const signals = insights.buildSummarySignals({
      audience: view.id === "household" ? "household" : "person",
      viewLabel: view.label,
      today: clock.today,
      focusMonth: month,
      months: page.months ?? [],
      categoryShareByMonth: page.categoryShareByMonth ?? [],
      accountPills: page.accountPills ?? [],
      accountKinds: Object.fromEntries(accounts.map((account) => [account.id, account.kind])),
      availableMonths: page.availableMonths ?? [],
      formatMoney: unmaskedMoney
    });
    const composed = composeCheckInHeadline({
      memoryKey,
      contextKey,
      signals,
      period: month,
      triviaRotation: insights.SUMMARY_TRIVIA_ROTATION,
      calmLines: insights.SUMMARY_CALM_LINES,
      clock
    });
    return composed?.fact ? composed : null;
  }, [accounts, clock, insights, month, scope, summary, view.id, view.label]);

  const monthFigures = summary?.summaryPage?.months?.find((item) => item.month === month) ?? null;
  if (!summary || (!headline && !monthFigures)) {
    return null;
  }

  function handleAction(action) {
    if (action.id === "review-statement") {
      navigate({ pathname: "/imports", search: `?${params.toString()}` });
    } else if (action.id === "open-category" && action.categoryName) {
      navigate({ pathname: "/entries", search: `?${applyCheckInAction(params, action).toString()}` });
    }
  }

  const spent = monthFigures?.realExpensesMinor ?? 0;
  const planned = monthFigures?.estimatedExpensesMinor ?? 0;
  const ratio = planned > 0 ? Math.min(1, spent / planned) : spent > 0 ? 1 : 0;
  const tone = spendTone(spent, planned);
  const actionShown = headline?.action && ["review-statement", "open-category"].includes(headline.action.id);

  return (
    <>
      <p className="ask-k">{askCopy.sinceLastLooked}</p>
      <section className="ask-brief" aria-label={askCopy.sinceLastLooked}>
        {!areTotalsVisible ? (
          <p className="ask-brief-hidden">{askCopy.briefHidden}</p>
        ) : (
          <>
            {headline?.kind ? <CheckInChip kind={headline.kind} /> : null}
            {headline ? <strong className="ask-brief-fact">{headline.fact}</strong> : null}
            {actionShown ? (
              <button type="button" className="checkin-action ask-brief-action" onClick={() => handleAction(headline.action)}>
                {headline.action.label}
              </button>
            ) : null}
            {monthFigures && (planned > 0 || spent > 0) ? (
              <div className="ask-brief-month">
                <div className="ask-brief-month-row">
                  <span>{askCopy.monthSpent(month)}</span>
                  <span>
                    <strong className={moneyToneClass(tone)}><PrivateMoney>{money(spent)}</PrivateMoney></strong>
                    {planned > 0 ? <span className="money-plan"> {askCopy.ofPlan(money(planned))}</span> : null}
                  </span>
                </div>
                <span className={`ask-brief-bar${tone === "short" ? " is-over" : ""}`} aria-hidden="true">
                  <i style={{ width: `${Math.round(ratio * 100)}%` }} />
                </span>
              </div>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
