import { ArrowRight, Banknote, ChartPie, PiggyBank, Receipt, Scale, Sparkles, Target, TrendingUp, Users, Wallet } from "lucide-react";

import { skewCountedKind } from "./ask-skew-check";
import { askCopy, formatCardDate } from "./copy/ask-copy";
import { moneyWithCurrency } from "./formatters";
import { splitMoneyUse } from "./money-jobs-model";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { LeadCard, MetaChip } from "./ui/lead-support-detail";
import { SavingsBar } from "./ui/savings-bar";

const NEUTRAL_BUBBLE_COLOUR = "#7C8791";
const INTENT_ICONS = {
  spending: ChartPie,
  plan: Target,
  compare: Scale,
  biggest: Receipt,
  owed: Users,
  income: Banknote,
  invested: TrendingUp,
  saved: PiggyBank,
  spentVsEarned: Wallet
};

// An Ask answer to a money question (design.md "Ask page", "Money answer";
// docs/flows/ask-flow.md "Money questions"): the shared LeadCard. Lead:
// the figure the question is about, with the actual-vs-plan bar when there
// is a plan; Support: the plan, the other month or the largest shares as
// chips; Detail: the answer in words, then the rows behind it. Every
// figure is the server's, read from the same projections the screens
// show; only the words may be AI-phrased (validated against those facts).
// With money hidden, amounts are masked and the words and rows (which say
// over, under, or who owes whom) give way to the usual hidden note. Words
// the optional AI phrased are tagged "Worded by AI".
export function AskMoneyAnswerCard({ id = undefined, answer, wording, intent, settled = false }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const { lead } = answer;
  const plan = Number.isFinite(lead.planMinor) && lead.planMinor > 0 ? lead.planMinor : null;
  // Words the optional AI phrased carry the entry card's butter tag; the
  // computed wording has none. It goes with the words: hidden money hides
  // both.
  const aiWorded = wording.source === "ai" && areTotalsVisible;
  return (
    <LeadCard
      id={id}
      className={`ask-answer ask-money-answer${settled ? " is-settled" : ""}`}
      aria-label={answer.title}
      data-ask-money-answer={intent}
      data-wording-source={wording.source}
      tag={aiWorded ? (
        <span className="ask-card-tag is-filled ask-money-ai-tag">
          <Sparkles size={13} aria-hidden="true" />
          {askCopy.money.wordedByAi}
        </span>
      ) : null}
      category={{ colorHex: NEUTRAL_BUBBLE_COLOUR, icon: INTENT_ICONS[intent] ?? ChartPie }}
      title={<strong className="lsd-title ask-answer-title">{answer.title}</strong>}
      subtitle={<span className="ask-answer-detail">{lead.label}</span>}
      amount={<span className="ask-answer-amount"><PrivateMoney>{moneyWithCurrency(lead.amountMinor, lead.currency)}</PrivateMoney></span>}
      tone={lead.tone}
      // Saved can be below zero (more went out than came in): the bar is then empty.
      progress={plan ? { valueMinor: Math.max(0, lead.amountMinor), planMinor: plan, overIsShort: lead.overIsShort !== false } : null}
      progressEnd={plan ? <span className="money-plan">{askCopy.ofPlan(moneyWithCurrency(plan, lead.currency))}</span> : null}
      chips={answer.support.map((chip, index) => (
        <MetaChip key={`${chip.label}-${index}`} className="ask-answer-chip">
          {chip.label}
          {Number.isFinite(chip.amountMinor) ? <> <PrivateMoney>{moneyWithCurrency(chip.amountMinor, chip.currency ?? "SGD")}</PrivateMoney></> : null}
          {Number.isFinite(chip.percent) ? ` ${chip.percent}%` : null}
        </MetaChip>
      ))}
    >
      {answer.outcome ? (
        // Intent against outcome, and the money jobs' answers (invested,
        // saved, spending against income): the Month and Summary lead's
        // savings bar, from the same figures through the same split (it keeps only
        // percentages when money is hidden). No period is given, so its
        // parts are plain images (no View entries / Ask menu) under the
        // always-visible legend.
        <SavingsBar
          figures={splitMoneyUse({
            incomeMinor: answer.outcome.incomeMinor,
            spentMinor: answer.outcome.spentMinor,
            plannedSpendMinor: answer.outcome.plannedSpendMinor,
            savingsTargetMinor: answer.outcome.savingsTargetMinor,
            investedMinor: answer.outcome.investedMinor ?? 0,
            savedMovedMinor: answer.outcome.savedMovedMinor ?? 0,
            movedIntoInvestmentsMinor: answer.outcome.movedIntoInvestmentsMinor ?? 0,
            takenFromInvestmentsMinor: answer.outcome.takenFromInvestmentsMinor ?? 0,
            plannedInvestMinor: answer.outcome.plannedInvestMinor ?? 0
          })}
          hidden={!areTotalsVisible}
        />
      ) : null}
      {areTotalsVisible ? (
        <>
          <p className="ask-money-wording">{wording.text}</p>
          {answer.lines.length ? (
            <ul className="ask-money-lines">
              {answer.lines.map((line, index) => (
                <li key={`${line.label}-${index}`}>
                  <span className="ask-money-line-text">
                    <span className="ask-money-line-label">{line.label}</span>
                    {line.detail ? <small>{line.detail}</small> : null}
                  </span>
                  <span className="ask-money-line-figures">
                    <strong className={moneyToneClass(line.tone)}>{moneyWithCurrency(line.amountMinor, line.currency)}</strong>
                    {line.secondary ? (
                      <small className={line.secondary.kind === "plan" ? "money-plan" : undefined}>
                        {line.secondary.kind === "plan"
                          ? askCopy.ofPlan(moneyWithCurrency(line.secondary.amountMinor, line.currency))
                          : `${line.secondary.label} ${moneyWithCurrency(line.secondary.amountMinor, line.currency)}`}
                      </small>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="ask-brief-hidden">{askCopy.briefHidden}</p>
      )}
    </LeadCard>
  );
}

// The check before an answer: one skew candidate (DOMAIN.md "Skew
// Candidate") that would change the figures, in plain words. Its chips
// (Mark as settlement or Link as transfer, and It's real spending) live in
// the chip row while it is the newest thing in the conversation.
export function AskSkewCheckCard({ id = undefined, candidate, status = "open", today, settled = false }) {
  const side = candidate.outflowEntry ?? candidate.inflowEntry;
  const date = formatCardDate(side?.date ?? "", today);
  const settlement = candidate.kind === "settlement";
  const title = settlement
    ? `${candidate.fromPerson?.name ?? ""} → ${candidate.toPerson?.name ?? ""}`
    : `${candidate.outflowEntry?.accountName ?? ""} → ${candidate.inflowEntry?.accountName ?? ""}`;
  const sentence = settlement
    ? askCopy.money.check.settlement(candidate.fromPerson?.name ?? "", candidate.toPerson?.name ?? "", date)
    : askCopy.money.check.ownTransfer(candidate.fromPerson?.name ?? "", date);
  return (
    <LeadCard
      id={id}
      className={`ask-answer ask-skew-check${settled ? " is-settled" : ""}`}
      aria-label={askCopy.money.check.title}
      data-skew-check={status}
      tag={<MetaChip tone="butter" className="ask-skew-tag">{askCopy.money.check.title}</MetaChip>}
      category={{ colorHex: NEUTRAL_BUBBLE_COLOUR, icon: ArrowRight }}
      title={<strong className="lsd-title ask-answer-title">{title}</strong>}
      subtitle={<span className="ask-answer-detail">{side?.description ?? ""}</span>}
      amount={<span className="ask-answer-amount"><PrivateMoney>{moneyWithCurrency(candidate.amountMinor, candidate.currency)}</PrivateMoney></span>}
      tone="neutral"
    >
      <p className="ask-money-wording">
        {sentence} {askCopy.money.check.counted[skewCountedKind(candidate)]} {status === "open" ? askCopy.money.check.why : null}
      </p>
    </LeadCard>
  );
}
