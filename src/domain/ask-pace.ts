// Ask's "If this keeps up" answer (DOMAIN.md "Pace"; owner decision,
// 2026-11-10): "How will November end if this keeps up?". The same pure
// function the Summary and Month pace line read (pace.ts), on the same
// facts (pages/pace-facts.ts), against Month's own Actual and Planned spend.
// Always a range, never a reassurance or a safe-to-spend figure (the pace
// lint, findPaceProblems), and quiet for the same reasons the line is.
import { paceTotals, type PaceBehindAccount, type PaceBill, type PaceQuiet, type PaceRange } from "./pace";
import { paceQuietAnswer } from "./pace-quiet";
import type { PaceDto } from "./pages/pace-facts";
import { compactMoney, monthName, rangeWords } from "./money-signals/format";
import type { AskAnswerCardDto, AskAnswerLineDto, PersonScope } from "../types/dto";

export interface PaceAnswerFacts {
  kind: "pace";
  month: string;
  viewId: string;
  scope: PersonScope;
  // Month's Actual spend and Planned spend for the month (0: no plan).
  spentMinor: number;
  planMinor: number;
  quiet: PaceQuiet | null;
  // The accounts behind, when that is why it is quiet.
  behind: PaceBehindAccount[];
  range: PaceRange | null;
  bills: PaceBill[];
}

type Money = (minor: number) => string;

export function buildPaceAnswerFacts(input: {
  month: string;
  today: string;
  viewId: string;
  scope: PersonScope;
  spentMinor: number;
  planMinor: number;
  pace: PaceDto | null | undefined;
}): PaceAnswerFacts {
  const base = { kind: "pace" as const, month: input.month, viewId: input.viewId, scope: input.scope, spentMinor: input.spentMinor, planMinor: input.planMinor };
  // The pace is only ever today's month.
  if (input.month !== input.today.slice(0, 7)) {
    return { ...base, quiet: "past", behind: [], range: null, bills: [] };
  }
  if (!input.pace?.range) {
    return { ...base, quiet: input.pace?.quiet ?? "history", behind: input.pace?.behind ?? [], range: null, bills: [] };
  }
  return { ...base, quiet: null, behind: [], range: input.pace.range, bills: input.pace.bills ?? [] };
}

const MONTH_END = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
};

/** Where the month ends, shown and exact, or null while it is quiet. */
export function paceAnswerTotals(facts: PaceAnswerFacts) {
  return facts.range ? paceTotals(facts.spentMinor, facts.range) : null;
}

function sideOfPlan(facts: PaceAnswerFacts) {
  const totals = paceAnswerTotals(facts);
  if (!totals || facts.planMinor <= 0) return null;
  return totals.highMinor <= facts.planMinor ? "under" : totals.lowMinor > facts.planMinor ? "over" : null;
}

function rangeLine(label: string, detail: string, lowMinor: number, highMinor: number): AskAnswerLineDto {
  return {
    label,
    ...(detail ? { detail } : {}),
    amountMinor: lowMinor,
    currency: "SGD",
    tone: "plan",
    ...(highMinor !== lowMinor ? { secondary: { kind: "compare" as const, label: "to", amountMinor: highMinor } } : {})
  };
}

export function buildPaceCard(facts: PaceAnswerFacts): AskAnswerCardDto {
  const month = monthName(facts.month);
  const range = facts.range;
  const lines: AskAnswerLineDto[] = [];
  if (range) {
    lines.push(rangeLine(`Everyday spending, ${range.daysLeft} ${range.daysLeft === 1 ? "day" : "days"} to go`, "", range.everydayLowMinor, range.everydayHighMinor));
    if (range.billsHighMinor > 0) {
      lines.push(rangeLine("Bills still to come", facts.bills.map((bill) => bill.name).slice(0, 4).join(", "), range.billsLowMinor, range.billsHighMinor));
    }
    const once = range.oneOffs.reduce((sum, item) => sum + item.amountMinor, 0);
    if (once > 0) {
      lines.push({ label: "Counted once, not repeated", amountMinor: once, currency: "SGD", tone: "neutral" });
    }
  }
  return {
    title: "If this keeps up",
    lead: {
      label: `Spent so far in ${month}`,
      amountMinor: facts.spentMinor,
      currency: "SGD",
      tone: "neutral",
      ...(facts.planMinor > 0 ? { planMinor: facts.planMinor } : {})
    },
    support: [],
    lines,
    links: [{ kind: "month", label: `Open ${month}`, month: facts.month, viewId: facts.viewId, scope: facts.scope }]
  };
}

// The quiet reasons, in plain words (pace-quiet.ts, shared with Summary's note).
const quietWords = (facts: PaceAnswerFacts) => paceQuietAnswer(facts.quiet ?? "history", { month: facts.month, behind: facts.behind });

export function buildPaceWording(facts: PaceAnswerFacts, money: Money): string {
  const month = monthName(facts.month);
  const totals = paceAnswerTotals(facts);
  if (!totals || !facts.range) {
    return quietWords(facts);
  }
  const low = compactMoney(money, totals.shown.lowMinor);
  const high = compactMoney(money, totals.shown.highMinor);
  const side = sideOfPlan(facts);
  const plan = compactMoney(money, facts.planMinor);
  const sentences = [
    `If this keeps up, ${month}'s spending ends at about ${rangeWords(low, high)} by ${MONTH_END(facts.month)} ${month.slice(0, 3)}${side ? `, ${side} the ${plan} plan` : facts.planMinor > 0 ? `, close to the ${plan} plan` : ""}.`,
    `That's ${money(facts.spentMinor)} spent so far, everyday spending for the ${facts.range.daysLeft} days to go at this month's pace and your usual pace${facts.bills.length ? `, and ${facts.bills.length} ${facts.bills.length === 1 ? "bill" : "bills"} still to come on ${facts.bills.length === 1 ? "its" : "their"} usual ${facts.bills.length === 1 ? "day" : "days"}` : ""}.`
  ];
  if (facts.range.oneOffs.length) {
    sentences.push(`${facts.range.oneOffs.length === 1 ? "One big cost is" : `${facts.range.oneOffs.length} big costs are`} counted once, not repeated.`);
  }
  return sentences.join(" ");
}

export function buildPacePromptFacts(facts: PaceAnswerFacts, money: Money): string[] {
  const totals = paceAnswerTotals(facts);
  if (!totals || !facts.range) {
    return [quietWords(facts)];
  }
  return [
    `If this keeps up, spending by month end: about ${rangeWords(compactMoney(money, totals.shown.lowMinor), compactMoney(money, totals.shown.highMinor))}`,
    `Spent so far: ${money(facts.spentMinor)}`,
    `Everyday spending, ${facts.range.daysLeft} days to go: ${rangeWords(money(facts.range.everydayLowMinor), money(facts.range.everydayHighMinor))}`,
    `Bills still to come: ${rangeWords(money(facts.range.billsLowMinor), money(facts.range.billsHighMinor))}`,
    ...(facts.planMinor > 0 ? [`Planned spend: ${money(facts.planMinor)}`] : [])
  ];
}
