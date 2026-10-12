// A plan draft (DOMAIN.md "Plan Draft"; docs/flows/ask-flow.md "Planning
// by chat"): a plan request (plan-draft-reader.ts, or the optional AI's
// reading of the same shape) resolved against a month's month plan rows.
// Pure: rows in, a draft, a question or a note out. Nothing is written;
// the draft's `apply` list is what Save posts to the plan-change command.
//
// - Which lines the view can change: the rows the Month page shows for
//   the view (a person's own and shared rows; every row on the household
//   view), the same filter buildPlanRowsForView uses.
// - A name resolves to a line by its label, then its category, then its
//   words. A name that fits more than one line asks which (one chip each);
//   a name that fits none starts a new line only when it names a category
//   (else a note), owned by the view's person, or on the household view by
//   whoever the person picks.
// - Copying a month copies the view's lines: a line already in the target
//   month (same section, label, category and owner) takes the source's
//   amount; any other is added. Lines only the target month has stay.
// - No month named, or one more than a year ahead or two back: asks which.
// - A line never goes below zero: a move or a cut that would is a note.
// - The totals are the view's, added up the way the Month cards add them
//   (Planned income, Planned spend, Remaining budget), before and after.
// - The warning is the Money insights plan-balance check
//   (planShortfallSignal) on the plan after the change, in its own words.

import { planShortfallSignal } from "./money-signals/month-signals";
import { addMonthKeys } from "./plan-draft-reader";
import type { PlanLineOp, PlanRequest } from "./plan-draft-reader";
import { formatCurrencyMinor } from "./split-currency";
import type {
  MonthPlanChangeDto,
  PlanDraftAnswersDto,
  PlanDraftChangeDto,
  PlanDraftDto,
  PlanDraftKind,
  PlanDraftNoteDto,
  PlanDraftQuestionDto,
  PlanSectionWithIncome,
  PlanTotalsDto
} from "../types/dto";

export interface PlanRowInput {
  id: string;
  section: PlanSectionWithIncome;
  categoryName: string;
  label: string;
  plannedMinor: number;
  ownershipType: "direct" | "shared";
  personId: string | null;
  ownerName: string | null;
  splits: Array<{ personId: string; ratioBasisPoints: number }>;
  planDate: string | null;
  accountName: string | null;
  note: string | null;
}

export interface PlanDraftContext {
  today: string;
  // "household" or a person id.
  viewId: string;
  // The month Ask is looking at: offered first when no month was named.
  monthInView: string;
  // In household order (the first is the shared split's first person).
  people: Array<{ id: string; name: string }>;
  categoryNames: string[];
  // Every month plan row of the target month and, for a copy, the source
  // month, household-wide (income rows included).
  rowsByMonth: Record<string, PlanRowInput[]>;
  answers?: PlanDraftAnswersDto;
}

export type PlanDraftBuild =
  | { kind: "draft"; draft: PlanDraftDto }
  | { kind: "question"; question: PlanDraftQuestionDto }
  | { kind: "note"; note: PlanDraftNoteDto };

const MONTHS_AHEAD = 12;
const MONTHS_BACK = 24;
export const SHARED_OWNER_KEY = "shared";
const SHARED_LABEL = "Shared";
const NEW_LINE_SECTION: PlanSectionWithIncome = "budget_buckets";
const FALLBACK_CATEGORY = "Other";

/**
 * The months a request needs read: the target month (once known) and the
 * month it copies. Null when the month must be asked first.
 */
export function planDraftMonths(request: PlanRequest, context: Pick<PlanDraftContext, "today" | "answers">) {
  const month = targetMonth(request, context);
  if (!month) {
    return null;
  }
  return [...new Set([month, ...(request.copyFrom ? [request.copyFrom] : [])])];
}

function targetMonth(request: PlanRequest, context: Pick<PlanDraftContext, "today" | "answers">) {
  const month = context.answers?.month ?? request.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return null;
  }
  const thisMonth = context.today.slice(0, 7);
  return month > addMonthKeys(thisMonth, MONTHS_AHEAD) || month < addMonthKeys(thisMonth, -MONTHS_BACK) ? null : month;
}

// The months offered when none was named: this month, the next, and the
// month Ask is looking at.
function monthOptions(context: PlanDraftContext) {
  const thisMonth = context.today.slice(0, 7);
  return [...new Set([thisMonth, addMonthKeys(thisMonth, 1), context.monthInView])]
    .filter((month) => /^\d{4}-\d{2}$/.test(month))
    .sort();
}

interface WorkingLine {
  row: PlanRowInput;
  beforeMinor: number;
  afterMinor: number;
  created: boolean;
}

class DraftStop extends Error {
  constructor(readonly result: PlanDraftBuild) {
    super("plan draft stopped");
  }
}

export function buildPlanDraft(request: PlanRequest, context: PlanDraftContext): PlanDraftBuild {
  const month = targetMonth(request, context);
  if (!month) {
    return { kind: "question", question: { field: "month", options: monthOptions(context) } };
  }
  if (request.copyFrom && request.copyFrom === month) {
    return { kind: "note", note: { reason: "same_month", month } };
  }
  try {
    return { kind: "draft", draft: draftFor(month, request, context) };
  } catch (error) {
    if (error instanceof DraftStop) {
      return error.result;
    }
    throw error;
  }
}

function draftFor(month: string, request: PlanRequest, context: PlanDraftContext): PlanDraftDto {
  const targetRows = context.rowsByMonth[month] ?? [];
  const lines = new Map<string, WorkingLine>(targetRows.map((row) => [row.id, { row, beforeMinor: row.plannedMinor, afterMinor: row.plannedMinor, created: false }]));
  const takenIds = new Set(targetRows.map((row) => row.id));
  const visible = () => [...lines.values()].filter((line) => isVisible(line.row, context.viewId));

  if (request.copyFrom) {
    const sourceRows = (context.rowsByMonth[request.copyFrom] ?? []).filter((row) => isVisible(row, context.viewId));
    if (!sourceRows.length) {
      throw new DraftStop({ kind: "note", note: { reason: "no_plan_to_copy", month: request.copyFrom } });
    }
    for (const source of sourceRows) {
      const match = visible().find((line) => sameLine(line.row, source));
      if (match) {
        match.afterMinor = source.plannedMinor;
        continue;
      }
      const id = uniqueId(`${source.id}-copy-${month}`, takenIds);
      lines.set(id, {
        row: { ...source, id, planDate: shiftPlanDate(source.planDate, month) },
        beforeMinor: 0,
        afterMinor: source.plannedMinor,
        created: true
      });
    }
  }

  const ops = request.ops;
  let firstTouched: Touched | null = null;
  for (const op of ops) {
    const touched = applyOp(op, { month, context, lines, takenIds, visible });
    firstTouched ??= touched;
  }

  const changed = [...lines.values()].filter((line) => line.created || line.afterMinor !== line.beforeMinor);
  if (!changed.length) {
    throw new DraftStop({ kind: "note", note: { reason: "nothing_changes", month } });
  }

  const beforeRows = targetRows;
  const afterRows = [...lines.values()].map((line) => ({ ...line.row, plannedMinor: line.afterMinor }));
  const before = planTotals(beforeRows, context.viewId);
  const after = planTotals(afterRows, context.viewId);
  const kind: PlanDraftKind = request.copyFrom ? "copy" : ops[0]?.kind ?? "set";

  return {
    month,
    viewId: context.viewId,
    kind,
    copyFrom: request.copyFrom,
    lead: buildLead(kind, ops[0], firstTouched, changed, before, after),
    changes: changed.map((line) => toChange(line)),
    totals: { before, after },
    warning: planWarning(afterRows, month, context),
    apply: changed.map((line) => toApply(line, context))
  };
}

interface OpState {
  month: string;
  context: PlanDraftContext;
  lines: Map<string, WorkingLine>;
  takenIds: Set<string>;
  visible: () => WorkingLine[];
}

// The lines an op changed: the lead names the first op's.
interface Touched {
  line: WorkingLine;
  from?: WorkingLine;
}

function applyOp(op: PlanLineOp, state: OpState): Touched {
  if (op.kind === "move") {
    const from = resolveLine(op.from, state, { create: false });
    const to = resolveLine(op.to, state, { create: true });
    if ((from.row.section === "income") !== (to.row.section === "income")) {
      throw new DraftStop({ kind: "note", note: { reason: "move_mixed" } });
    }
    if (from.afterMinor < op.amountMinor) {
      throw new DraftStop({ kind: "note", note: { reason: "not_enough", label: from.row.label, plannedMinor: from.afterMinor } });
    }
    from.afterMinor -= op.amountMinor;
    to.afterMinor += op.amountMinor;
    return { line: to, from };
  }
  if (op.kind === "change") {
    const line = resolveLine(op.line, state, { create: op.deltaMinor > 0 });
    if (line.afterMinor + op.deltaMinor < 0) {
      throw new DraftStop({ kind: "note", note: { reason: "not_enough", label: line.row.label, plannedMinor: line.afterMinor } });
    }
    line.afterMinor += op.deltaMinor;
    return { line };
  }
  if (op.kind === "add") {
    // A line that is already there gets the amount on top: the draft shows
    // the before and after, so nothing is a surprise.
    const line = resolveLine(op.line, state, { create: true, anyName: true });
    line.afterMinor += op.amountMinor;
    return { line };
  }
  const line = resolveLine(op.line, state, { create: true });
  line.afterMinor = op.amountMinor;
  return { line };
}

function resolveLine(name: string, state: OpState, { create, anyName = false }: { create: boolean; anyName?: boolean }): WorkingLine {
  const visible = state.visible();
  const chosen = state.context.answers?.lines?.[name];
  if (chosen) {
    const line = visible.find((item) => item.row.id === chosen);
    if (line) {
      return line;
    }
  }
  const found = findLines(name, visible);
  if (found.length === 1) {
    return found[0];
  }
  if (found.length > 1) {
    throw new DraftStop({
      kind: "question",
      question: {
        field: "line",
        name,
        options: found.map((line) => ({ rowId: line.row.id, label: line.row.label, ownerLabel: ownerLabel(line.row), plannedMinor: line.afterMinor }))
      }
    });
  }
  const categoryName = findCategory(name, state.context.categoryNames);
  if (!create || (!categoryName && !anyName)) {
    throw new DraftStop({ kind: "note", note: { reason: "unknown_line", name, month: state.month } });
  }
  return createLine(categoryName ? categoryName : titleCase(name), categoryName ?? FALLBACK_CATEGORY, state);
}

function createLine(label: string, categoryName: string, state: OpState): WorkingLine {
  const { context } = state;
  const owner = newLineOwner(label, context);
  const id = uniqueId(`plan-ask-${state.month}-${slug(label)}`, state.takenIds);
  const row: PlanRowInput = {
    id,
    section: NEW_LINE_SECTION,
    categoryName,
    label,
    plannedMinor: 0,
    ownershipType: owner.ownershipType,
    personId: owner.personId,
    ownerName: owner.ownerName,
    splits: owner.splits,
    planDate: null,
    accountName: null,
    note: null
  };
  const line = { row, beforeMinor: 0, afterMinor: 0, created: true };
  state.lines.set(id, line);
  return line;
}

// A new line is the view's person's; on the household view the person
// picks whose (or Shared, split evenly).
function newLineOwner(label: string, context: PlanDraftContext) {
  const viewPerson = context.people.find((person) => person.id === context.viewId);
  const key = viewPerson?.id ?? context.answers?.owner;
  if (!key) {
    throw new DraftStop({
      kind: "question",
      question: {
        field: "owner",
        line: label,
        options: [...context.people.map((person) => ({ key: person.id, label: person.name })), ...(context.people.length > 1 ? [{ key: SHARED_OWNER_KEY, label: SHARED_LABEL }] : [])]
      }
    });
  }
  if (key === SHARED_OWNER_KEY && context.people.length > 1) {
    const [first, second] = context.people;
    return {
      ownershipType: "shared" as const,
      personId: null,
      ownerName: null,
      splits: [{ personId: first.id, ratioBasisPoints: 5_000 }, { personId: second.id, ratioBasisPoints: 5_000 }]
    };
  }
  const person = context.people.find((item) => item.id === key) ?? context.people[0];
  if (!person) {
    throw new DraftStop({ kind: "note", note: { reason: "unknown_line", name: label, month: "" } });
  }
  return { ownershipType: "direct" as const, personId: person.id, ownerName: person.name, splits: [{ personId: person.id, ratioBasisPoints: 10_000 }] };
}

function normalName(value: string) {
  return String(value ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function stem(word: string) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function stems(value: string) {
  return normalName(value).split(" ").filter((word) => word && word !== "and").map(stem);
}

// The lines a name could mean: by label, then category, then every word of
// the name among the line's words, then a label that starts with it.
function findLines(name: string, lines: WorkingLine[]): WorkingLine[] {
  const wanted = normalName(name);
  const wantedStems = stems(name);
  if (!wanted || !wantedStems.length) {
    return [];
  }
  const passes: Array<(line: WorkingLine) => boolean> = [
    (line) => normalName(line.row.label) === wanted,
    (line) => normalName(line.row.categoryName) === wanted,
    (line) => {
      const words = new Set([...stems(line.row.label), ...stems(line.row.categoryName)]);
      return wantedStems.every((word) => words.has(word));
    },
    (line) => wanted.length >= 3 && normalName(line.row.label).startsWith(wanted)
  ];
  for (const pass of passes) {
    const found = lines.filter(pass);
    if (found.length) {
      return found;
    }
  }
  return [];
}

function findCategory(name: string, categoryNames: string[]) {
  const wanted = normalName(name);
  const wantedStems = stems(name).join(" ");
  return categoryNames.find((category) => normalName(category) === wanted)
    ?? categoryNames.find((category) => stems(category).join(" ") === wantedStems)
    ?? null;
}

function titleCase(value: string) {
  return value.replace(/\s+/g, " ").trim().replace(/(^|\s)([a-z])/g, (_, space, letter) => `${space}${letter.toUpperCase()}`);
}

function slug(value: string) {
  return normalName(value).replace(/\s+/g, "-") || "line";
}

function uniqueId(base: string, taken: Set<string>) {
  let id = base;
  for (let index = 2; taken.has(id); index += 1) {
    id = `${base}-${index}`;
  }
  taken.add(id);
  return id;
}

function sameLine(left: PlanRowInput, right: PlanRowInput) {
  return left.section === right.section
    && normalName(left.label) === normalName(right.label)
    && normalName(left.categoryName) === normalName(right.categoryName)
    && left.ownershipType === right.ownershipType
    && (left.personId ?? null) === (right.personId ?? null);
}

// The same day in the target month (a planned item keeps its day); a day
// past the month's end becomes its last day.
function shiftPlanDate(planDate: string | null, month: string) {
  if (!planDate) {
    return null;
  }
  const day = Number(planDate.slice(8, 10));
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/** Whether the Month page shows this row for the view (buildPlanRowsForView, loadMonthIncomeRows). */
export function isVisible(row: PlanRowInput, viewId: string) {
  if (viewId === "household") {
    return true;
  }
  if (row.section === "income") {
    return row.personId === viewId;
  }
  return row.personId === viewId || row.splits.some((split) => split.personId === viewId);
}

/** The view's plan totals, added up as the Month cards add them. */
export function planTotals(rows: PlanRowInput[], viewId: string): PlanTotalsDto {
  const shown = rows.filter((row) => isVisible(row, viewId));
  const plannedSpendMinor = shown.filter((row) => row.section !== "income").reduce((sum, row) => sum + row.plannedMinor, 0);
  const plannedIncomeMinor = shown.filter((row) => row.section === "income").reduce((sum, row) => sum + row.plannedMinor, 0);
  return { plannedIncomeMinor, plannedSpendMinor, remainingMinor: plannedIncomeMinor - plannedSpendMinor };
}

function planWarning(rows: PlanRowInput[], month: string, context: PlanDraftContext): PlanDraftDto["warning"] {
  const shown = rows.filter((row) => isVisible(row, context.viewId));
  const viewPerson = context.people.find((person) => person.id === context.viewId);
  const signal = planShortfallSignal({
    audience: viewPerson ? "person" : "household",
    viewLabel: viewPerson?.name ?? "",
    month,
    today: context.today,
    entries: [],
    planSections: [{ key: "plan", rows: shown.filter((row) => row.section !== "income").map((row) => ({ id: row.id, label: row.label, categoryName: row.categoryName, plannedMinor: row.plannedMinor, actualMinor: 0 })) }],
    incomeRows: shown.filter((row) => row.section === "income").map((row) => ({ plannedMinor: row.plannedMinor, actualMinor: 0 })),
    summary: null,
    accountPills: null,
    formatMoney: (amountMinor) => formatCurrencyMinor(amountMinor, "SGD")
  });
  if (!signal) {
    return null;
  }
  // The plain "Your <month> plan spends … more than it expects to earn" line.
  const phrasing = signal.phrasings.find((item) => item.fact.startsWith("Your")) ?? signal.phrasings[0];
  return { text: phrasing.fact, shortMinor: signal.numbers?.primaryMinor ?? 0 };
}

function ownerLabel(row: PlanRowInput) {
  return row.ownershipType === "shared" ? SHARED_LABEL : row.ownerName ?? "";
}

function toChange(line: WorkingLine): PlanDraftChangeDto {
  return {
    rowId: line.row.id,
    action: line.created ? "create" : "update",
    section: line.row.section,
    label: line.row.label,
    categoryName: line.row.categoryName,
    ownerLabel: ownerLabel(line.row),
    beforeMinor: line.beforeMinor,
    afterMinor: line.afterMinor
  };
}

function toApply(line: WorkingLine, context: PlanDraftContext): MonthPlanChangeDto {
  if (!line.created) {
    return { action: "update", rowId: line.row.id, expectedMinor: line.beforeMinor, plannedMinor: line.afterMinor };
  }
  const { row } = line;
  const firstPersonId = context.people[0]?.id;
  return {
    action: "create",
    rowId: row.id,
    sectionKey: row.section,
    categoryName: row.categoryName,
    label: row.label,
    plannedMinor: line.afterMinor,
    ownershipType: row.ownershipType,
    ...(row.ownershipType === "direct" && row.ownerName ? { ownerName: row.ownerName } : {}),
    ...(row.ownershipType === "shared" ? { splitBasisPoints: row.splits.find((split) => split.personId === firstPersonId)?.ratioBasisPoints ?? 5_000 } : {}),
    planDate: row.section === "planned_items" ? row.planDate : null,
    accountName: row.section === "planned_items" ? row.accountName : null,
    note: row.note
  };
}

function buildLead(
  kind: PlanDraftKind,
  op: PlanLineOp | undefined,
  touched: Touched | null,
  changed: WorkingLine[],
  before: PlanTotalsDto,
  after: PlanTotalsDto
): PlanDraftDto["lead"] {
  if (kind === "copy" || !touched) {
    return { label: "", categoryName: null, amountMinor: after.plannedSpendMinor, beforeMinor: before.plannedSpendMinor };
  }
  if (op?.kind === "move" && touched.from) {
    return { label: "", categoryName: null, amountMinor: op.amountMinor, beforeMinor: null, fromLabel: touched.from.row.label, toLabel: touched.line.row.label };
  }
  // The first line the request named, even when a later change put it back.
  const line = touched.line ?? changed[0];
  return {
    label: line.row.label,
    categoryName: line.row.categoryName,
    amountMinor: line.afterMinor,
    beforeMinor: line.created ? null : line.beforeMinor
  };
}
