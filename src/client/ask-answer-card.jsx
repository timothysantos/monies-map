import { CreditCard, Search } from "lucide-react";
import { useMemo } from "react";

import { summarizeFilterAnswer } from "./ask-filter-answer";
import { useAskEntriesPage } from "./ask-data";
import { askCopy } from "./copy/ask-copy";
import { describeFilterParts } from "./copy/entry-filter-copy";
import { flowTone } from "../domain/money-tone";
import { money } from "./formatters";
import { PrivateMoney } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { getIconComponent } from "./ui-components";

const NEUTRAL_BUBBLE_COLOUR = "#7C8791";

// An Ask answer (design.md "Ask page", "Answer card"): Lead, the total in
// big type with what it counts ("Spent · 6 entries"); Support, the applied
// filters as chips; Detail, the view's share when it differs. Its numbers
// come from the Entries page DTO of the filter's view and month (borrowed
// from the query cache or read through the shell's lease, ask-data.js)
// through the Entries page's own filtering (ask-filter-answer.js), so
// "Open in Entries" shows the same rows and total. Only the filter is kept
// in the conversation; the numbers are read again each time it shows.
export function AskAnswerCard({ filter, settled = false, queryClient, fetchEntriesPage, accounts, categories, people, trackedMonths = undefined }) {
  // A month the household has no entries for has no Entries page: the
  // server would answer with the nearest month, so nothing is read.
  const tracked = !trackedMonths?.length || trackedMonths.includes(filter.month);
  const entriesPage = useAskEntriesPage({ queryClient, fetchEntriesPage, viewId: filter.viewId, month: filter.month, enabled: tracked });
  const page = tracked && entriesPage.page?.monthPage?.month === filter.month ? entriesPage.page : null;
  const noMonth = !tracked || Boolean(entriesPage.page && !page);
  const summary = useMemo(() => (page ? summarizeFilterAnswer(page, filter) : null), [page, filter]);
  const parts = describeFilterParts(filter, { accounts, people, withContext: true });
  const subject = answerSubject(filter, { accounts, categories });
  const loading = !summary && !noMonth && entriesPage.status !== "error";

  return (
    <section className={`ask-answer${settled ? " is-settled" : ""}`} aria-label={subject.title} aria-busy={loading || undefined} data-ask-answer={summary ? summary.count : noMonth ? "none" : ""}>
      <div className="ask-answer-head">
        <span className="ask-answer-bubble" style={{ "--cat": subject.colour }} aria-hidden="true">
          <subject.Icon size={18} strokeWidth={2.2} />
        </span>
        <strong className="ask-answer-title">{subject.title}</strong>
      </div>
      {summary ? (
        <>
          <strong className={`ask-answer-amount ${moneyToneClass(leadTone(summary.lead))}`}>
            <PrivateMoney>{money(summary.lead.amountMinor)}</PrivateMoney>
          </strong>
          <span className="ask-answer-detail">
            {askCopy.answer.detail(askCopy.answer.leads[summary.lead.kind], summary.count)}
            {summary.lead.shareMinor !== null ? (
              <>
                {" · "}
                {askCopy.answer.share(shareOwner(filter, people))} <PrivateMoney>{money(summary.lead.shareMinor)}</PrivateMoney>
              </>
            ) : null}
          </span>
        </>
      ) : noMonth ? (
        <span className="ask-answer-detail">{askCopy.answer.noMonth(parts.find((part) => part.key === "month")?.label ?? filter.month)}</span>
      ) : entriesPage.status === "error" ? (
        <span className="ask-answer-detail">{askCopy.answer.loadFailed}</span>
      ) : (
        <span className="ask-answer-detail">{askCopy.answer.loading}</span>
      )}
      <ul className="ask-answer-chips" aria-label={askCopy.answer.filtersLabel}>
        {parts.map((part) => <li key={part.key} className="ask-answer-chip" data-part={part.key}>{part.label}</li>)}
      </ul>
    </section>
  );
}

// Spending is not bad for being spending (design.md "Money colour"): the
// total stays plain ink; income is mint; transfers keep the ink.
function leadTone(lead) {
  return lead.kind === "income" ? flowTone(lead.amountMinor) : "neutral";
}

function shareOwner(filter, people) {
  return people.find((person) => person.id === filter.viewId)?.name ?? "";
}

// What the answer is about, for its title and bubble: a category, a
// wallet, the searched words, the type, or everything.
export function answerSubject(filter, { accounts = [], categories = [] } = {}) {
  if (filter.categories?.length) {
    const category = categories.find((item) => item.name === filter.categories[0]);
    return {
      title: filter.categories.length > 1 ? askCopy.answer.more(filter.categories[0], filter.categories.length - 1) : filter.categories[0],
      colour: category?.colorHex ?? NEUTRAL_BUBBLE_COLOUR,
      Icon: category ? getIconComponent(category.iconKey) : Search
    };
  }
  if (filter.wallets?.length) {
    const name = accounts.find((account) => account.id === filter.wallets[0])?.name ?? filter.wallets[0];
    return {
      title: filter.wallets.length > 1 ? askCopy.answer.more(name, filter.wallets.length - 1) : name,
      colour: NEUTRAL_BUBBLE_COLOUR,
      Icon: CreditCard
    };
  }
  if (filter.search) {
    return { title: askCopy.answer.searched(filter.search), colour: NEUTRAL_BUBBLE_COLOUR, Icon: Search };
  }
  return {
    title: askCopy.answer.types[filter.type] ?? askCopy.answer.allEntries,
    colour: NEUTRAL_BUBBLE_COLOUR,
    Icon: Search
  };
}
