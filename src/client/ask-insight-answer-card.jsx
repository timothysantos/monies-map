import { Lightbulb, Sparkles } from "lucide-react";
import { useMemo } from "react";

import { useAskEntriesPage } from "./ask-data";
import { summarizeFilterAnswer } from "./ask-filter-answer";
import { askCopy, formatCardDate } from "./copy/ask-copy";
import { buildEntryRowDisplay } from "./entry-row-display";
import { CheckInChip } from "./financial-insight";
import { moneyWithCurrency } from "./formatters";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { LeadCard } from "./ui/lead-support-detail";

const NEUTRAL_BUBBLE_COLOUR = "#7C8791";
const ENTRY_ROWS = 5;

// The answer to an insight question (design.md "Insight answer";
// docs/flows/ask-flow.md "Insight questions"): the shared LeadCard. Lead:
// the insight's kind chip, the line as the page showed it and the figure it
// is about (the head is that figure's label and amount, and the line
// itself opens the Detail, so a long line never squeezes the head; a line
// about a count is the head itself); Detail: its think line, the optional
// AI explanation (tagged
// "Worded by AI"), what it is based on (the signal's own figures) and the
// entries behind it, read from the Entries page DTO through the Entries
// page's own filtering (ask-filter-answer.js), so Open in Entries shows the
// same rows. Its links are chips in the chip row. With money hidden the
// figures are masked and the words and lines (which say over, short or who
// owes whom) give way to the usual hidden note.
export function AskInsightAnswerCard({ id = undefined, answer, explanation = null, settled = false, queryClient, fetchEntriesPage, trackedMonths = undefined, today }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const aiWorded = Boolean(explanation?.text) && explanation.source === "ai" && areTotalsVisible;
  const factInHead = !answer.lead;
  const title = !areTotalsVisible ? askCopy.insight.hiddenTitle : factInHead ? answer.fact : answer.lead.label;
  return (
    <LeadCard
      id={id}
      className={`ask-answer ask-insight-answer${settled ? " is-settled" : ""}`}
      aria-label={areTotalsVisible ? answer.fact : askCopy.insight.hiddenTitle}
      data-ask-insight={answer.type}
      data-wording-source={aiWorded ? "ai" : "facts"}
      tag={(
        <span className="ask-insight-tags">
          <CheckInChip kind={answer.kind} />
          {aiWorded ? (
            <span className="ask-card-tag is-filled ask-money-ai-tag">
              <Sparkles size={13} aria-hidden="true" />
              {askCopy.money.wordedByAi}
            </span>
          ) : null}
        </span>
      )}
      category={{ colorHex: NEUTRAL_BUBBLE_COLOUR, icon: Lightbulb }}
      title={<strong className={`lsd-title ask-answer-title${factInHead && areTotalsVisible ? " ask-insight-fact" : ""}`}>{title}</strong>}
      amount={answer.lead ? <span className="ask-answer-amount"><PrivateMoney>{moneyWithCurrency(answer.lead.amountMinor, answer.lead.currency)}</PrivateMoney></span> : null}
      tone="neutral"
    >
      {areTotalsVisible ? (
        <>
          {factInHead ? null : <p className="ask-insight-fact">{answer.fact}</p>}
          {answer.think ? <p className="ask-insight-think">{answer.think}</p> : null}
          {aiWorded ? <p className="ask-money-wording ask-insight-explanation">{explanation.text}</p> : null}
          {answer.lines.length ? (
            <>
              <p className="ask-k ask-insight-k">{askCopy.insight.basedOn}</p>
              <ul className="ask-money-lines ask-insight-basis">
                {answer.lines.map((line, index) => (
                  <li key={`${line.label}-${index}`}>
                    <span className="ask-money-line-text"><span className="ask-money-line-label">{line.label}</span></span>
                    <span className="ask-money-line-figures">
                      <strong>{line.amountMinor !== undefined ? moneyWithCurrency(line.amountMinor, line.currency ?? "SGD") : line.text}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {answer.entries ? (
            <InsightEntries filter={answer.entries} queryClient={queryClient} fetchEntriesPage={fetchEntriesPage} trackedMonths={trackedMonths} today={today} />
          ) : null}
        </>
      ) : (
        <p className="ask-brief-hidden">{askCopy.briefHidden}</p>
      )}
    </LeadCard>
  );
}

// The entries behind the insight, largest first: the rows Open in Entries
// shows (the same Entries page DTO and filtering), at most five here.
function InsightEntries({ filter, queryClient, fetchEntriesPage, trackedMonths, today }) {
  const tracked = !trackedMonths?.length || trackedMonths.includes(filter.month);
  const entriesPage = useAskEntriesPage({ queryClient, fetchEntriesPage, viewId: filter.viewId, month: filter.month, enabled: tracked });
  const page = tracked && entriesPage.page?.monthPage?.month === filter.month ? entriesPage.page : null;
  const rows = useMemo(() => {
    if (!page) return null;
    const ids = new Set(summarizeFilterAnswer(page, filter).entryIds);
    return (page.monthPage.entries ?? [])
      .filter((entry) => ids.has(entry.id))
      .map((entry) => ({ entry, display: buildEntryRowDisplay(entry, filter.viewId) }))
      .sort((left, right) => Math.abs(right.display.primarySignedAmountMinor) - Math.abs(left.display.primarySignedAmountMinor)
        || String(right.entry.date).localeCompare(String(left.entry.date)));
  }, [filter, page]);
  const noMonth = !tracked || Boolean(entriesPage.page && !page);
  const status = rows ? "" : noMonth ? askCopy.insight.noEntries : entriesPage.status === "error" ? askCopy.insight.loadFailed : askCopy.insight.loading;
  return (
    <>
      <p className="ask-k ask-insight-k">{askCopy.insight.entries}</p>
      {rows?.length ? (
        <ul className="ask-money-lines ask-insight-entries" data-entry-count={rows.length}>
          {rows.slice(0, ENTRY_ROWS).map(({ entry, display }) => (
            <li key={entry.id} data-entry-id={entry.id}>
              <span className="ask-money-line-text">
                <span className="ask-money-line-label">{entry.description || entry.categoryName}</span>
                <small>{formatCardDate(entry.date, today)}</small>
              </span>
              <span className="ask-money-line-figures">
                <strong className={moneyToneClass(display.amountTone)}>{moneyWithCurrency(Math.abs(display.primarySignedAmountMinor), "SGD")}</strong>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ask-insight-status" aria-busy={!rows && !noMonth && entriesPage.status !== "error" ? "true" : undefined}>
          {rows ? askCopy.insight.noEntries : status}
        </p>
      )}
      {rows && rows.length > ENTRY_ROWS ? <p className="ask-insight-more">{askCopy.insight.moreEntries(rows.length - ENTRY_ROWS)}</p> : null}
    </>
  );
}
