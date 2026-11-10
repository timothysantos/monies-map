// "Is that more than usual?" (DOMAIN.md "Usual Level"; Ask's `usual`
// question): a shop, a category, a person's spending or a whole month
// compared with its usual level, the middle (median) of the 6 complete
// months before, and what made the difference. Pure: the loader
// (pages/ask-usual.ts) reads the view's entries for the 7 months and
// resolves what was asked about; the model only says the subject as
// written. Every number here comes from the entries.
import { payeeKey, payeeName } from "./account-routines";
import { spendingMinor } from "./category-offset";
import { addMonths } from "./money-signals/format";
import type { AskAnswerCardDto, AskAnswerLineDto, PersonScope } from "../types/dto";
import { askTermByKey } from "./ask-terms";

const USUAL_TERM_TEXT = askTermByKey("usual")?.text ?? "";

export const USUAL_MONTHS = 6;
// Within 15% or $20 of usual is "about usual".
export const USUAL_BAND_RATIO = 0.15;
export const USUAL_BAND_MINOR = 2_000;
// A shop seen in fewer months than this is not a regular: its visits are
// compared instead.
export const USUAL_REGULAR_MONTHS = 3;

export interface UsualEntry {
  id: string;
  date: string;
  description: string;
  categoryName: string;
  entryType: string;
  // The view's amount.
  amountMinor: number;
}

export type UsualSubject =
  | { kind: "category"; name: string }
  | { kind: "person"; name: string }
  | { kind: "shop"; key: string; name: string; also?: string }
  | { kind: "spending" };

export interface UsualFacts {
  kind: "usual";
  subject: UsualSubject;
  label: string;
  month: string;
  viewId: string;
  scope: PersonScope;
  amountMinor: number;
  usualMinor: number;
  // The 6 months before, oldest first (0 when nothing: a shop's empty month
  // is left out of its middle).
  history: Array<{ month: string; amountMinor: number }>;
  // A shop seen in fewer than 3 of the 6 months: its visits are compared.
  regular: boolean;
  verdict: "about" | "more" | "less";
  diffMinor: number;
  // What made the difference: the categories or shops that rose most
  // against their own usual, or a shop's largest charges above its usual
  // charge.
  drivers: Array<{ label: string; amountMinor: number; usualMinor?: number; date?: string; isNew?: boolean }>;
  entryCount: number;
  usualEntryCount: number;
  // The terms the answer uses ("Words used"; ask-terms.ts).
  terms: string[];
}

const spend = (entry: UsualEntry) => spendingMinor({ entryType: entry.entryType, categoryName: entry.categoryName, amountMinor: entry.amountMinor });

export function medianOf(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function usualHistoryMonths(month: string) {
  return Array.from({ length: USUAL_MONTHS }, (_, index) => addMonths(month, index - USUAL_MONTHS));
}

function belongs(subject: UsualSubject, entry: UsualEntry) {
  switch (subject.kind) {
    case "category": return entry.categoryName.toLowerCase() === subject.name.toLowerCase();
    case "shop": return payeeKey(entry.description) === subject.key;
    default: return true;
  }
}

function verdictOf(amountMinor: number, usualMinor: number) {
  const diff = amountMinor - usualMinor;
  if (Math.abs(diff) <= Math.max(USUAL_BAND_MINOR, Math.round(usualMinor * USUAL_BAND_RATIO))) {
    return { verdict: "about" as const, diffMinor: diff };
  }
  return { verdict: diff > 0 ? "more" as const : "less" as const, diffMinor: diff };
}

// The groups (categories, or shops in a category) that rose most against
// their own usual month, largest rise first.
function risers(entries: UsualEntry[], month: string, months: string[], keyOf: (entry: UsualEntry) => string, labelOf: (entry: UsualEntry) => string) {
  const groups = new Map<string, { label: string; byMonth: Map<string, number> }>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const group = groups.get(key) ?? { label: labelOf(entry), byMonth: new Map() };
    const at = entry.date.slice(0, 7);
    group.byMonth.set(at, (group.byMonth.get(at) ?? 0) + spend(entry));
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const now = group.byMonth.get(month) ?? 0;
      const usual = medianOf(months.map((item) => group.byMonth.get(item) ?? 0));
      const isNew = months.every((item) => !group.byMonth.get(item));
      return { label: group.label, amountMinor: now, usualMinor: usual, rise: now - usual, isNew };
    })
    .filter((item) => item.rise > 0)
    .sort((left, right) => right.rise - left.rise || left.label.localeCompare(right.label))
    .slice(0, 3)
    .map(({ label, amountMinor, usualMinor, isNew }) => ({ label, amountMinor, usualMinor, ...(isNew ? { isNew: true } : {}) }));
}

/**
 * The facts for one subject in `month`, from the view's entries of that
 * month and the 6 before (only the months the household tracks count).
 */
export function buildUsualFacts(input: {
  subject: UsualSubject;
  label: string;
  month: string;
  viewId: string;
  scope: PersonScope;
  entries: UsualEntry[];
  trackedMonths: string[];
}): UsualFacts {
  const { subject, month } = input;
  const months = usualHistoryMonths(month).filter((item) => input.trackedMonths.includes(item));
  const mine = input.entries.filter((entry) => spend(entry) !== 0 && belongs(subject, entry));
  const inMonth = (item: string) => mine.filter((entry) => entry.date.slice(0, 7) === item);
  const total = (list: UsualEntry[]) => list.reduce((sum, entry) => sum + spend(entry), 0);
  const history = months.map((item) => ({ month: item, amountMinor: total(inMonth(item)) }));
  const current = inMonth(month);
  const amountMinor = total(current);
  const seen = history.filter((item) => item.amountMinor !== 0);
  const regular = subject.kind !== "shop" || seen.length >= USUAL_REGULAR_MONTHS;
  const historyEntries = mine.filter((entry) => months.includes(entry.date.slice(0, 7)));
  const usualEntry = medianOf(historyEntries.map(spend));

  let usualMinor: number;
  let compared: number;
  if (regular) {
    // A shop's months without it are left out; a category, a person or a
    // month counts an empty month as $0.
    usualMinor = medianOf((subject.kind === "shop" ? seen : history).map((item) => item.amountMinor));
    compared = amountMinor;
  } else {
    // Not a regular: the size of a visit, this month's against the usual one.
    usualMinor = usualEntry;
    compared = current.length ? Math.round(amountMinor / current.length) : 0;
  }
  const { verdict, diffMinor } = verdictOf(compared, usualMinor);

  let drivers: UsualFacts["drivers"] = [];
  if (subject.kind === "shop") {
    drivers = current
      .filter((entry) => spend(entry) > usualEntry)
      .sort((left, right) => spend(right) - spend(left) || left.date.localeCompare(right.date))
      .slice(0, 3)
      .map((entry) => ({ label: payeeName(entry.description) || entry.description, amountMinor: spend(entry), date: entry.date }));
  } else if (verdict === "more") {
    const scoped = [...current, ...historyEntries];
    drivers = subject.kind === "category"
      ? risers(scoped, month, months, (entry) => payeeKey(entry.description), (entry) => payeeName(entry.description) || entry.description)
      : risers(scoped, month, months, (entry) => entry.categoryName, (entry) => entry.categoryName);
  }
  return {
    kind: "usual",
    subject,
    label: input.label,
    month,
    viewId: input.viewId,
    scope: input.scope,
    amountMinor,
    usualMinor,
    history,
    regular,
    verdict,
    diffMinor,
    drivers,
    entryCount: current.length,
    usualEntryCount: medianOf(months.map((item) => inMonth(item).length)),
    terms: ["usual"]
  };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthWord = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
const shortDay = (date: string) => `${Number(date.slice(8, 10))} ${monthWord(date.slice(0, 7)).slice(0, 3)}`;

/** The answer card: the subject's month against its usual, and the drivers. */
export function buildUsualCard(facts: UsualFacts, money: (minor: number) => string): AskAnswerCardDto {
  void money;
  const previous = facts.history.at(-1);
  const lines: AskAnswerLineDto[] = facts.drivers.map((driver) => ({
    label: driver.date ? `${shortDay(driver.date)} · ${driver.label}` : driver.label,
    ...(driver.isNew ? { detail: "new this month" } : driver.usualMinor !== undefined ? { detail: "against its usual month" } : {}),
    amountMinor: driver.amountMinor,
    currency: "SGD",
    tone: "out",
    ...(driver.usualMinor !== undefined && !driver.isNew ? { secondary: { kind: "compare" as const, label: "Usual", amountMinor: driver.usualMinor } } : {})
  }));
  return {
    title: `${facts.label} in ${monthWord(facts.month)}`,
    lead: { label: `${facts.label} in ${monthWord(facts.month)}`, amountMinor: facts.amountMinor, currency: "SGD", tone: "neutral" },
    support: [
      { label: facts.regular ? "Usual" : "Usual visit", amountMinor: facts.usualMinor, currency: "SGD" },
      ...(previous ? [{ label: monthWord(previous.month), amountMinor: previous.amountMinor, currency: "SGD" }] : [])
    ],
    lines,
    links: [{
      kind: "entries",
      label: "Open in Entries",
      filter: {
        month: facts.month,
        viewId: facts.viewId,
        scope: facts.scope,
        search: facts.subject.kind === "shop" ? facts.subject.name : "",
        categories: facts.subject.kind === "category" ? [facts.subject.name] : [],
        wallets: [],
        type: "expense",
        minAmountMinor: null,
        maxAmountMinor: null
      }
    }]
  };
}

/** The computed wording: the month, the usual and the verdict, then the drivers. */
export function buildUsualWording(facts: UsualFacts, money: (minor: number) => string): string {
  const month = monthWord(facts.month);
  if (!facts.history.length) {
    return `${facts.label} came to ${money(facts.amountMinor)} in ${month}. There are no months before it to compare with yet.`;
  }
  const sentences: string[] = [];
  if (facts.regular) {
    sentences.push(`${facts.label} came to ${money(facts.amountMinor)} in ${month}.`);
    const how = facts.verdict === "about"
      ? `so ${month} was about usual`
      : `so ${month} was ${money(Math.abs(facts.diffMinor))} ${facts.verdict === "more" ? "more" : "less"} than usual`;
    sentences.push(`Your usual month is ${money(facts.usualMinor)}, the middle of the last ${facts.history.length} months, ${how}.`);
  } else {
    sentences.push(`${facts.label} isn't a regular: it shows up in fewer than ${USUAL_REGULAR_MONTHS} of the last ${facts.history.length} months.`);
    sentences.push(facts.entryCount
      ? `In ${month} it came to ${money(facts.amountMinor)} over ${facts.entryCount === 1 ? "1 charge" : `${facts.entryCount} charges`}, against a usual charge of ${money(facts.usualMinor)}.`
      : `Nothing from it shows in ${month}.`);
  }
  if (facts.regular && facts.drivers.length && facts.subject.kind === "shop" && facts.verdict === "more") {
    const together = facts.drivers.reduce((sum, driver) => sum + driver.amountMinor, 0);
    sentences.push(`The largest ${facts.drivers.length === 1 ? "charge was" : `${facts.drivers.length} charges were`} ${money(together)} together.`);
  } else if (facts.regular && facts.drivers.length && facts.verdict === "more") {
    const names = facts.drivers.map((driver) => (driver.isNew ? `${driver.label} (new this month)` : driver.label));
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    sentences.push(`Most of the rise came from ${list}.`);
  }
  // Words used (ask-terms.ts): what "usual" means, in plain words.
  sentences.push(`Words used: ${USUAL_TERM_TEXT}`);
  return sentences.join(" ");
}

/** The facts an AI phrasing may use, one per line (validateAiWording checks every sum). */
export function buildUsualPromptFacts(facts: UsualFacts, money: (minor: number) => string): string[] {
  return [
    `${facts.label} in ${monthWord(facts.month)}: ${money(facts.amountMinor)}`,
    `${facts.regular ? "Usual month" : "Usual charge"} (middle of the last ${facts.history.length} months): ${money(facts.usualMinor)}`,
    `Verdict: ${facts.verdict === "about" ? "about usual" : `${money(Math.abs(facts.diffMinor))} ${facts.verdict} than usual`}`,
    ...facts.drivers.map((driver) => `${driver.date ? `${shortDay(driver.date)} ` : ""}${driver.label}: ${money(driver.amountMinor)}`),
    ...(facts.subject.kind === "shop" && facts.drivers.length
      ? [`The largest ${facts.drivers.length} charges together: ${money(facts.drivers.reduce((sum, driver) => sum + driver.amountMinor, 0))}`]
      : []),
    `Months compared: ${facts.history.length}; charges this month: ${facts.entryCount}`,
    `Words used: ${USUAL_TERM_TEXT}`
  ];
}
