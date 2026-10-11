import { CreditCard, Search } from "lucide-react";
import { useMemo } from "react";

import { summarizeFilterAnswer } from "./ask-filter-answer";
import { useAskEntriesPage } from "./ask-data";
import { askCopy } from "./copy/ask-copy";
import { describeFilterParts } from "./copy/entry-filter-copy";
import { flowTone } from "../domain/money-tone";
import { money } from "./formatters";
import { PrivateMoney } from "./money-privacy";
import { getIconComponent, LeadCard, MetaChip } from "./ui-components";

const NEUTRAL_BUBBLE_COLOUR = "#7C8791";

// An Ask answer (design.md "Ask page", "Answer card"): Lead, the total in
// big type with what it counts ("Spent · 6 entries") and the view's share
// when it differs; Support, the applied filters as chips. Its numbers
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

  const detail = summary ? (
    <>
      {askCopy.answer.detail(askCopy.answer.leads[summary.lead.kind], summary.count)}
      {summary.lead.shareMinor !== null ? (
        <>
          {" · "}
          {askCopy.answer.share(shareOwner(filter, people))} <PrivateMoney>{money(summary.lead.shareMinor)}</PrivateMoney>
        </>
      ) : null}
    </>
  ) : noMonth
    ? askCopy.answer.noMonth(parts.find((part) => part.key === "month")?.label ?? filter.month)
    : entriesPage.status === "error" ? askCopy.answer.loadFailed : askCopy.answer.loading;

  // The shared lead card (ui/lead-support-detail.jsx), as the entry card
  // beside it: the subject's bubble and title, what the total counts under
  // it, the total on the right, the filters as Support chips.
  return (
    <LeadCard
      className={`ask-answer${settled ? " is-settled" : ""}`}
      aria-label={subject.title}
      aria-busy={loading || undefined}
      data-ask-answer={summary ? summary.count : noMonth ? "none" : ""}
      category={{ colorHex: subject.colour, icon: subject.Icon }}
      title={<strong className="lsd-title ask-answer-title">{subject.title}</strong>}
      subtitle={<span className="ask-answer-detail">{detail}</span>}
      amount={summary ? (
        <span className="ask-answer-amount"><PrivateMoney>{money(summary.lead.amountMinor)}</PrivateMoney></span>
      ) : null}
      tone={summary ? leadTone(summary.lead) : undefined}
      chips={parts.map((part) => (
        <MetaChip key={part.key} className="ask-answer-chip" data-part={part.key}>{part.label}</MetaChip>
      ))}
    />
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
