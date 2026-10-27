// Detector 7: problems in this month's and next month's plan.
//
// - plan_overspent (`check`): the plan spends more than the income it expects
//   by more than the Money insights To do's own limit (PLAN_SHORTFALL_MINOR or
//   2% of income). The plan is the person's own input, so it is never `high`.
// - plan_line_unpaid: a dated bill whose day has passed with nothing linked
//   and exactly one unlinked expense of the same amount near its date (the
//   strict core of the Month link dialog's own reasons: same amount, near the
//   planned date, same category when the line has one) is a `check`; when
//   that expense could pay another due line too, or several fit, only a
//   `note`. No fitting expense is silent (the payment may not have happened;
//   Money insights says so already).
// - plan_line_no_category (`note`): a plan line with money in it and no
//   category.
import { PLAN_SHORTFALL_MINOR, PLAN_SHORTFALL_RATIO } from "../money-signals/month-signals";
import { clip, daysBetween, finding, money, monthLink, monthName, nextMonthKey, shortDate, shortId } from "./helpers";
import type { CheckupContext, CheckupEvidence, DetectedFinding } from "./types";

// A payment this near the planned day can be the planned bill.
export const PLAN_CANDIDATE_WINDOW_DAYS = 10;

export interface PlanRowFact {
  id: string;
  month: string;
  section: "income" | "planned_items" | "budget_buckets";
  personId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  label: string;
  planDate: string | null;
  plannedMinor: number;
  actualMinor: number;
  linkCount: number;
}

// An expense no plan line has claimed.
export interface PlanCandidateFact {
  id: string;
  date: string;
  description: string;
  amountMinor: number;
  categoryName: string | null;
  accountName: string;
}

export interface PlanFacts {
  rows: PlanRowFact[];
  candidates: PlanCandidateFact[];
}

export function planMonths(today: string) {
  const current = today.slice(0, 7);
  return [current, nextMonthKey(current)];
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function lineName(row: PlanRowFact) {
  return clip(row.label || row.categoryName || "A planned bill", 40);
}

function lineEvidence(row: PlanRowFact, note: string): CheckupEvidence {
  return { role: "plan line", label: lineName(row), shortId: shortId(row.id), date: row.planDate ?? undefined, amountMinor: row.plannedMinor, note };
}

export function detectPlanProblems(facts: PlanFacts, context: CheckupContext): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  const [currentMonth] = planMonths(context.today);

  for (const month of planMonths(context.today)) {
    const rows = facts.rows.filter((row) => row.month === month);
    const income = sum(rows.filter((row) => row.section === "income").map((row) => row.plannedMinor));
    const spending = rows.filter((row) => row.section !== "income");
    const planned = sum(spending.map((row) => row.plannedMinor));
    const short = planned - income;
    if (planned > 0 && income > 0 && short > Math.max(PLAN_SHORTFALL_MINOR, Math.round(income * PLAN_SHORTFALL_RATIO))) {
      const savings = sum(spending.filter((row) => row.label === "Savings").map((row) => row.plannedMinor));
      findings.push(finding({
        kind: "plan_overspent",
        subject: month,
        tier: "check",
        title: "The plan spends more than comes in",
        summary: `${monthName(month, context.today)}'s plan spends ${money(planned)} but only expects ${money(income)} of income, ${money(short)} more than comes in. Raising the income you expect or trimming a budget line fixes that.`,
        evidence: [
          { role: "fact", label: `Planned spending, savings included: ${money(planned)}` },
          { role: "fact", label: `Income you expect: ${money(income)}` },
          ...(savings > 0 ? [{ role: "fact" as const, label: `Savings in the plan: ${money(savings)}` }] : [])
        ],
        amountMinor: short,
        occurredOn: `${month}-01`,
        personIds: [],
        fix: monthLink(month),
        facts: [month, planned, income]
      }));
    }

    for (const row of spending) {
      if (row.categoryId === null && row.plannedMinor > 0) {
        findings.push(finding({
          kind: "plan_line_no_category",
          subject: row.id,
          tier: "note",
          title: "A plan line has no category",
          summary: `${lineName(row)} in ${monthName(month, context.today)}'s plan has ${money(row.plannedMinor)} set aside but no category, so it cannot be compared with what you spend.`,
          evidence: [lineEvidence(row, "no category")],
          amountMinor: row.plannedMinor,
          occurredOn: row.planDate ?? `${month}-01`,
          personIds: row.personId ? [row.personId] : [],
          fix: monthLink(month, "Choose a category in the plan"),
          facts: [row.id, row.plannedMinor]
        }));
      }
    }
  }

  // Due bills with nothing linked.
  const due = facts.rows.filter((row) => (
    row.month === currentMonth
    && row.section === "planned_items"
    && row.planDate !== null
    && row.planDate < context.today
    && row.plannedMinor > 0
    && row.linkCount === 0
    && row.actualMinor === 0
  ));
  const fits = (row: PlanRowFact) => facts.candidates.filter((candidate) => (
    candidate.amountMinor === row.plannedMinor
    && Math.abs(daysBetween(row.planDate!, candidate.date)) <= PLAN_CANDIDATE_WINDOW_DAYS
    && (!row.categoryName || !candidate.categoryName || row.categoryName === candidate.categoryName)
  ));
  for (const row of due) {
    const candidates = fits(row);
    if (!candidates.length) {
      continue;
    }
    const [candidate] = candidates;
    const contested = candidates.length > 1 || due.some((other) => other.id !== row.id && fits(other).some((item) => item.id === candidate.id));
    findings.push(finding({
      kind: "plan_line_unpaid",
      subject: row.id,
      tier: contested ? "note" : "check",
      title: contested ? "A planned bill may have been paid" : "A planned bill looks paid but is not matched",
      summary: contested
        ? `${lineName(row)} (${money(row.plannedMinor)}, due ${shortDate(row.planDate!, context.today)}) has nothing matched to it, and ${candidates.length === 1 ? "an entry" : `${candidates.length} entries`} of the same amount could be it.`
        : `${lineName(row)} (${money(row.plannedMinor)}, due ${shortDate(row.planDate!, context.today)}) has nothing matched to it, but ${clip(candidate.description, 40)} for the same amount on ${shortDate(candidate.date, context.today)} looks like the payment.`,
      evidence: [
        lineEvidence(row, "due, nothing matched"),
        ...candidates.slice(0, 3).map((item): CheckupEvidence => ({ role: "entry", label: clip(item.description), shortId: shortId(item.id), date: item.date, amountMinor: item.amountMinor, accountName: item.accountName, note: "could be the payment" }))
      ],
      amountMinor: row.plannedMinor,
      occurredOn: row.planDate,
      personIds: row.personId ? [row.personId] : [],
      fix: monthLink(row.month, "Open the plan and match the payment"),
      facts: [row.id, row.plannedMinor, ...candidates.slice(0, 3).map((item) => item.id)]
    }));
  }
  return findings;
}
