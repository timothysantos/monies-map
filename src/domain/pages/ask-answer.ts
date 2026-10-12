import { addMonths, readAnswerIntent, type AskAnswerIntent } from "../ask-answer-intent";
import {
  buildMonthFacts,
  buildSplitsBalanceFacts,
  combineMonthFacts,
  compareCategories,
  type AskAnswerFacts,
  type MonthFacts
} from "../ask-answer-facts";
import { loadAccountReferences } from "../app-repository-settings";
import { effectiveScopeForView } from "../person-view-scope";
import { buildMonthPageDto } from "./month-page";
import { buildSkewCandidatesDto } from "./skew-candidates";
import { buildSplitsPageDto } from "./splits-page";
import { loadRoutePageContext } from "../route-context";
import type { AskAnswerIntentKind, PersonScope, SkewCandidateDto } from "../../types/dto";

// The read side of an Ask answer (POST /api/ai-assist/answer; DOMAIN.md
// "Money Question"). It reads the question with the shared intent reader,
// checks the skew candidates first (the owner's rule: stop and ask before
// explaining figures a likely settle-up or own-account move would change),
// then reads the facts from the same page DTOs the screens show. It writes
// nothing; wording and the optional AI live in the route.

export const MAX_CONFIRMATION_CANDIDATES = 3;
const MAX_KEPT_CANDIDATE_IDS = 50;

export interface AskAnswerRequest {
  text: string;
  viewId: string;
  scope?: string | null;
  month: string;
  // Skew candidates the person said are real spending or income: not asked
  // about again in this question (kept by the page, never stored).
  keepCandidateIds?: string[];
}

interface AnsweredBase {
  supported: true;
  intent: AskAnswerIntentKind;
  viewId: string;
  scope: PersonScope;
  months: string[];
}

export type AskAnswerBuild =
  | { supported: false }
  | (AnsweredBase & { needsConfirmation: true; candidates: SkewCandidateDto[] })
  | (AnsweredBase & { needsConfirmation: false; facts: AskAnswerFacts; knownNames: string[] });

export async function buildAskAnswer(db: D1Database, request: AskAnswerRequest, today: string): Promise<AskAnswerBuild> {
  const { household, categories, trackedMonths, viewId } = await loadRoutePageContext(db, request.viewId);
  const scope = effectiveScopeForView(viewId, request.scope);
  const accounts = await loadAccountReferences(db);
  const people = household.people.map((person) => ({ id: person.id, name: person.name }));
  const intent = readAnswerIntent(request.text, {
    today,
    month: /^\d{4}-\d{2}$/.test(request.month) ? request.month : today.slice(0, 7),
    people,
    vocabulary: [...categories.map((category) => category.name), ...accounts.map((account) => account.name)]
  });
  if (!intent || (intent.kind === "owed" && people.length < 2)) {
    return { supported: false };
  }
  const months = intentMonths(intent, request.month, today);
  const base: AnsweredBase = { supported: true, intent: intent.kind, viewId, scope, months };

  const monthFacts = async (month: string): Promise<MonthFacts> => {
    if (!trackedMonths.includes(month)) {
      return emptyMonthFacts(month, viewId, scope);
    }
    return buildMonthFacts(await buildMonthPageDto(db, viewId, month, scope), scope);
  };
  const previousIfTracked = async (month: string) => {
    const previous = addMonths(month, -1);
    return trackedMonths.includes(previous) ? monthFacts(previous) : null;
  };
  const readFacts = async (): Promise<AskAnswerFacts> => {
    if (intent.kind === "spending") {
      const [current, previous] = await Promise.all([monthFacts(intent.month), previousIfTracked(intent.month)]);
      return { kind: "spending", focus: intent.focus, current, previous };
    }
    if (intent.kind === "plan" && intent.months && intent.months.length > 1) {
      // A quarter: each month as Month shows it, and their sum.
      const months = await Promise.all(intent.months.map((month) => monthFacts(month)));
      return { kind: "plan", current: combineMonthFacts(months), isCurrentMonth: false, months };
    }
    if (intent.kind === "plan") {
      return { kind: "plan", current: await monthFacts(intent.month), isCurrentMonth: intent.month === today.slice(0, 7) };
    }
    if (intent.kind === "compare") {
      const [current, other] = await Promise.all([monthFacts(intent.month), monthFacts(intent.otherMonth)]);
      return { kind: "compare", current, other, categoryChanges: compareCategories(current, other) };
    }
    if (intent.kind === "biggest") {
      return { kind: "biggest", current: await monthFacts(intent.month) };
    }
    if (intent.kind === "income") {
      const [current, previous] = await Promise.all([monthFacts(intent.month), previousIfTracked(intent.month)]);
      return { kind: "income", current, previous };
    }
    return owedFacts(db, intent, { viewId, people, month: months[0] });
  };

  // Skew first: a high-confidence candidate that would change these facts
  // is asked about before any figure is explained. The facts are read
  // alongside (both only read) so an answer does not wait for one after the
  // other; they are dropped when there is something to ask first.
  const kept = new Set((request.keepCandidateIds ?? []).slice(0, MAX_KEPT_CANDIDATE_IDS));
  const factsRead = readFacts();
  // A rejected read that is never awaited must not surface as unhandled.
  factsRead.catch(() => undefined);
  const skews = await Promise.all(months.filter((item) => trackedMonths.includes(item)).map((month) => buildSkewCandidatesDto(db, viewId, month, scope)));
  const candidates: SkewCandidateDto[] = [];
  for (const candidate of skews.flatMap((skew) => skew.candidates)) {
    if (candidate.confidence === "high" && !kept.has(candidate.id) && changesFacts(candidate, intent.kind) && !candidates.some((item) => item.id === candidate.id)) {
      candidates.push(candidate);
    }
  }
  if (candidates.length) {
    return { ...base, needsConfirmation: true, candidates: candidates.slice(0, MAX_CONFIRMATION_CANDIDATES) };
  }
  const facts = await factsRead;

  const groupNames = facts.kind === "owed" ? facts.balances.map((balance) => balance.groupName) : [];
  return {
    ...base,
    needsConfirmation: false,
    facts,
    knownNames: [...categories.map((category) => category.name), ...accounts.map((account) => account.name), ...people.map((person) => person.name), ...groupNames]
  };
}

function intentMonths(intent: AskAnswerIntent, requestMonth: string, today: string) {
  if (intent.kind === "compare") return [intent.month, intent.otherMonth];
  if (intent.kind === "plan" && intent.months?.length) return intent.months;
  if (intent.kind === "owed") return [/^\d{4}-\d{2}$/.test(requestMonth) ? requestMonth : today.slice(0, 7)];
  return [intent.month];
}

// Which candidates would change the answer: a settle-up changes who owes
// whom; spending answers change with any spending skew, income answers
// with any income skew.
function changesFacts(candidate: SkewCandidateDto, kind: AskAnswerIntentKind) {
  if (kind === "owed") return candidate.kind === "settlement";
  if (kind === "income") return candidate.skew.incomeMinor !== 0;
  return candidate.skew.spendingMinor !== 0;
}

// Splits seen by one person: the view's person; on the household view the
// other person when the question named someone ("what do I owe Serene?"),
// else the first person, worded with both names.
async function owedFacts(
  db: D1Database,
  intent: Extract<AskAnswerIntent, { kind: "owed" }>,
  context: { viewId: string; people: Array<{ id: string; name: string }>; month: string }
): Promise<AskAnswerFacts> {
  const { viewId, people, month } = context;
  const personView = people.some((person) => person.id === viewId);
  let viewerPersonId: string;
  let speaksToViewer = true;
  if (personView) {
    viewerPersonId = viewId;
  } else if (intent.personId) {
    viewerPersonId = people.find((person) => person.id !== intent.personId)?.id ?? people[0].id;
  } else {
    viewerPersonId = people[0].id;
    speaksToViewer = false;
  }
  const otherPersonId = people.find((person) => person.id !== viewerPersonId)?.id ?? people[1].id;
  const { splitsPage } = await buildSplitsPageDto(db, viewerPersonId, month);
  const { balances, openSettlements } = buildSplitsBalanceFacts({ groups: splitsPage.groups, settlementCheckpoints: splitsPage.settlementCheckpoints ?? [] });
  return {
    kind: "owed",
    month,
    viewId,
    viewerPersonId,
    otherPersonId,
    personNameById: Object.fromEntries(people.map((person) => [person.id, person.name])),
    speaksToViewer,
    balances,
    openSettlements
  };
}

function emptyMonthFacts(month: string, viewId: string, scope: PersonScope): MonthFacts {
  return {
    month,
    viewId,
    scope,
    spentMinor: 0,
    plannedMinor: 0,
    incomeMinor: 0,
    plannedIncomeMinor: 0,
    savingsTargetMinor: 0,
    entryCount: 0,
    expenseCount: 0,
    categories: [],
    allCategories: [],
    biggest: [],
    planRows: [],
    incomeSources: []
  };
}
