// Entry draft (DOMAIN.md "Entry Draft"): one typed sentence read into the
// fields /api/entries/create takes, for the future "Add or ask" card to show
// for confirmation. Pure and deterministic: no AI, no database, no clock
// (`today` is an input). Nothing here writes; a draft becomes a ledger entry
// only when the user confirms and the client posts its createBody.
//
// Reading order matters, because each step consumes the words it understood
// so the next one cannot misread them: a split ratio ("50/50") before dates
// (so it is not 50 September), dates before amounts (so "28 Sep" is not $28),
// type phrases ("came into") before accounts (so the account keeps its
// preposition), accounts before amounts (so "OCBC 360" is not $360), then
// people. Whatever is left is the description.

import { matchCategoryRule } from "./app-repository-category-match-rules";
import { selectShortcutAccount } from "./app-repository-shortcuts";
import type {
  AccountDto,
  CategoryMatchRuleDto,
  EntryDraftCreateBodyDto,
  EntryDraftDto,
  EntryDraftField,
  EntryDraftFieldDto,
  EntryDraftFieldSource,
  EntryDraftFlag,
  EntryDraftQuestionDto,
  EntryType,
  PersonDto
} from "../types/dto";

export const ENTRY_DRAFT_TEXT_MAX_LENGTH = 280;
const AI_DESCRIPTION_MAX_LENGTH = 120;

export interface EntryDraftContext {
  // YYYY-MM-DD in the household calendar (Asia/Singapore).
  today: string;
  accounts: AccountDto[];
  // In household order: the first person's share is what splitBasisPoints
  // means on a shared entry.
  people: PersonDto[];
  categoryNames: string[];
  // Active-first priority order, as loadCategoryMatchRules returns them.
  categoryMatchRules: CategoryMatchRuleDto[];
  // Settings -> Apple Pay shortcut: Default account priority and the card for
  // purchases in another currency, exactly as the Shortcut reads them.
  defaultAccountPriorityIds: string[];
  foreignCurrencyAccountId?: string;
  // The person whose view is open, for "mine" and "I paid".
  viewerName?: string;
}

// What the optional AI gap-filler may add, already validated. It is used only
// for a field the sentence left missing; a deterministic value always wins.
export interface EntryDraftAiSuggestion {
  amountMinor?: number;
  description?: string;
}

const FIELD_ORDER: EntryDraftField[] = ["date", "description", "accountId", "amountMinor", "ownerName", "splitBasisPoints"];

// Unicode-aware word edges: JavaScript's \b only knows ASCII letters.
const START = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";

export function normalizeEntryDraftText(value: unknown) {
  if (typeof value !== "string") {
    return { text: "", truncated: false };
  }
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length > ENTRY_DRAFT_TEXT_MAX_LENGTH
    ? { text: cleaned.slice(0, ENTRY_DRAFT_TEXT_MAX_LENGTH).trim(), truncated: true }
    : { text: cleaned, truncated: false };
}

export function parseEntrySentence(
  input: unknown,
  context: EntryDraftContext,
  ai: EntryDraftAiSuggestion = {}
): EntryDraftDto {
  const { text, truncated } = normalizeEntryDraftText(input);
  const flags: EntryDraftFlag[] = [];
  const questions: EntryDraftQuestionDto[] = [];
  if (!text) {
    flags.push("empty_text");
  }
  if (truncated) {
    flags.push("truncated");
  }

  const scanner = new SentenceScanner(text);
  const activeAccounts = context.accounts.filter((account) => account.isActive);
  const priorityAccounts = orderByPriority(activeAccounts, context.defaultAccountPriorityIds);

  const ratio = readSplitRatio(scanner);
  const dates = readDates(scanner, context.today);
  const typeWords = readTypeWords(scanner);
  const mentions = readAccountMentions(scanner, activeAccounts, context.people);
  const amounts = readAmounts(scanner);
  const people = readPeople(scanner, context.people, context.viewerName);
  const remainder = scanner.remainder();

  // Entry type. Two account mentions "from A to B" are a transfer even
  // without a transfer verb; a transfer verb beside an income word ("salary
  // transferred into UOB One") is income.
  const fromMention = mentions.find((mention) => mention.role === "from");
  const toMention = mentions.find((mention) => mention.role === "to");
  const isTransfer = (typeWords.transfer && !typeWords.income) || Boolean(fromMention && toMention);
  const entryType: EntryDraftFieldDto<EntryType> = isTransfer
    ? sentence("transfer")
    : typeWords.income || typeWords.transfer
      ? sentence("income")
      : fallback("expense");

  // Shared hints only make sense for an expense between the two people.
  const isShared = entryType.value === "expense"
    && context.people.length >= 2
    && (people.companion !== undefined || people.splitWords || ratio !== undefined);

  // Payer for a shared entry, or the explicit owner of a direct one.
  let explicitOwner: string | undefined;
  let payerUnclear = false;
  if (isShared) {
    if (people.payer === "companion") {
      explicitOwner = people.companion;
      payerUnclear = !people.companion;
    } else {
      explicitOwner = people.payer;
    }
  } else {
    explicitOwner = people.owner ?? (people.payer === "companion" ? people.companion : people.payer);
  }

  // Account.
  let account: EntryDraftFieldDto<AccountDto> | undefined;
  let transferAccount: EntryDraftFieldDto<AccountDto> | undefined;
  const amountChoice = chooseAmount(amounts);
  const namedCurrency = amountChoice.kind === "one" ? amountChoice.candidate.currency : undefined;
  if (isTransfer) {
    const source = fromMention ?? (toMention ? undefined : mentions[0]);
    const destination = toMention ?? (fromMention ? mentions.find((mention) => mention !== fromMention) : mentions[1]);
    if (destination?.accounts.length === 1) {
      transferAccount = sentence(destination.accounts[0]);
    }
    if (source?.accounts.length === 1) {
      account = sentence(source.accounts[0]);
    } else if (source && source.accounts.length > 1) {
      flags.push("ambiguous_account");
      questions.push(accountQuestion("ambiguous", source.accounts, context.accounts));
    } else {
      questions.push(accountQuestion(
        "transfer_from",
        priorityAccounts.filter((candidate) => candidate.id !== transferAccount?.value.id),
        priorityAccounts
      ));
    }
  } else {
    const named = uniqueAccounts(mentions.flatMap((mention) => mention.accounts));
    if (named.length === 1) {
      account = sentence(named[0]);
    } else if (named.length > 1) {
      flags.push("ambiguous_account");
      questions.push(accountQuestion("ambiguous", named, context.accounts));
    } else {
      const preferredOwner = isShared || entryType.value === "income" ? explicitOwner : undefined;
      const chosen = defaultAccount({
        accounts: context.accounts,
        priorityAccounts,
        context,
        entryType: entryType.value,
        amountCurrency: namedCurrency ?? undefined,
        preferredOwnerId: context.people.find((person) => person.name === preferredOwner)?.id
      });
      if (chosen) {
        account = fallback(chosen);
      } else {
        questions.push(accountQuestion("missing", [], context.accounts));
      }
    }
  }

  // Amount.
  let amountMinor: EntryDraftFieldDto<number> | undefined;
  let foreignAmount: EntryDraftDto["foreignAmount"];
  if (amountChoice.kind === "one") {
    const { candidate } = amountChoice;
    const accountCurrency = (account?.value.currency ?? priorityAccounts[0]?.currency ?? "").toUpperCase();
    if (candidate.currency === "unknown") {
      flags.push("unknown_currency");
      questions.push({ field: "amountMinor", reason: "unknown_currency", options: [] });
    } else if (candidate.currency && accountCurrency && candidate.currency !== accountCurrency) {
      foreignAmount = { amountMinor: candidate.amountMinor, currency: candidate.currency, source: "sentence" };
      flags.push("foreign_currency");
      questions.push({
        field: "amountMinor",
        reason: "foreign_currency",
        options: [{ amountMinor: candidate.amountMinor, currency: candidate.currency }]
      });
    } else {
      amountMinor = sentence(candidate.amountMinor);
    }
  } else if (amountChoice.kind === "conflict") {
    flags.push("conflicting_amounts");
    questions.push({
      field: "amountMinor",
      reason: "conflicting",
      options: amountChoice.candidates.map((candidate) => (
        candidate.currency ? { amountMinor: candidate.amountMinor, currency: candidate.currency } : { amountMinor: candidate.amountMinor }
      ))
    });
  } else if (isValidAmountMinor(ai.amountMinor)) {
    // The sentence named no number at all: only then may AI fill it.
    amountMinor = { value: ai.amountMinor, source: "ai" };
  } else {
    questions.push({ field: "amountMinor", reason: "missing", options: [] });
  }

  // Date.
  let date: EntryDraftFieldDto<string> | undefined;
  const validDates = uniqueStrings(dates.filter((mention) => mention.iso).map((mention) => mention.iso as string));
  if (dates.some((mention) => !mention.iso)) {
    flags.push("invalid_date");
    questions.push({ field: "date", reason: "invalid", options: [] });
  } else if (validDates.length > 1) {
    questions.push({ field: "date", reason: "conflicting", options: validDates.map((iso) => ({ date: iso })) });
  } else if (validDates.length === 1) {
    date = sentence(validDates[0]);
    if (validDates[0] > context.today) {
      flags.push("future_date");
      questions.push({ field: "date", reason: "future", options: [{ date: validDates[0] }] });
    }
  } else {
    date = fallback(context.today);
  }

  // Description. When AI read the amount from number words ("twelve fifty"),
  // those words were the amount, not the description.
  const sentenceDescription = buildDescription(
    amountMinor?.source === "ai" ? removeAmountWords(remainder, amountMinor.value) : remainder
  );
  let description: EntryDraftFieldDto<string> | undefined;
  if (sentenceDescription) {
    description = sentence(sentenceDescription);
  } else if (isTransfer) {
    description = fallback(transferAccount ? `Transfer to ${transferAccount.value.name}` : "Transfer");
  } else {
    const aiDescription = sanitizeDescription(ai.description);
    if (aiDescription) {
      description = { value: aiDescription, source: "ai" };
    } else {
      questions.push({ field: "description", reason: "missing", options: [] });
    }
  }

  // Category: a transfer is always Transfer; otherwise the household's rules
  // on the description, as the Shortcut does, then the uncategorised default.
  let categoryName: EntryDraftFieldDto<string>;
  const ruleCategory = description && !isTransfer
    ? matchCategoryRule(description.value, context.categoryMatchRules)
    : undefined;
  const knownCategory = (name: string) => !context.categoryNames.length || context.categoryNames.includes(name);
  if (isTransfer) {
    categoryName = { value: "Transfer", source: entryType.source };
  } else if (ruleCategory && ruleCategory !== "Transfer" && knownCategory(ruleCategory)) {
    categoryName = { value: ruleCategory, source: "rule" };
  } else if (entryType.value === "income" && context.categoryNames.includes("Other - Income")) {
    categoryName = fallback("Other - Income");
  } else {
    categoryName = fallback("Other");
  }

  // Owner: the payer of a shared entry, the named owner of a direct one, else
  // the account's owner, else the person whose view is open.
  const accountOwner = account ? personForAccount(account.value, context.people) : undefined;
  let ownerName: EntryDraftFieldDto<string> | undefined;
  if (explicitOwner) {
    ownerName = sentence(explicitOwner);
  } else if (!payerUnclear && accountOwner) {
    ownerName = fallback(accountOwner);
  } else if (!payerUnclear && context.viewerName) {
    ownerName = fallback(context.viewerName);
  }
  if (isShared && !ownerName) {
    questions.push({
      field: "ownerName",
      reason: "unclear_payer",
      options: context.people.map((person) => ({ personName: person.name }))
    });
  }

  // Split share: only an even split is assumed. Who takes the larger part of
  // an uneven one ("70/30") is asked, never guessed.
  let splitBasisPoints: EntryDraftFieldDto<number> | undefined;
  if (isShared) {
    if (ratio && ratio.first !== ratio.second) {
      const larger = Math.max(ratio.first, ratio.second) * 100;
      questions.push({
        field: "splitBasisPoints",
        reason: "uneven_split",
        options: [
          { personName: context.people[0].name, splitBasisPoints: larger },
          { personName: context.people[1].name, splitBasisPoints: 10_000 - larger }
        ]
      });
    } else if (ratio || people.evenWords) {
      splitBasisPoints = sentence(5000);
    } else {
      splitBasisPoints = fallback(5000);
    }
  }

  const fields: EntryDraftDto["fields"] = {
    ...(date ? { date } : {}),
    ...(description ? { description } : {}),
    ...(account ? {
      accountId: { value: account.value.id, source: account.source },
      accountName: { value: account.value.name, source: account.source }
    } : {}),
    categoryName,
    ...(amountMinor ? { amountMinor } : {}),
    entryType,
    ...(isTransfer ? { transferDirection: sentence<"in" | "out">("out") } : {}),
    ownershipType: isShared ? sentence<"direct" | "shared">("shared") : fallback<"direct" | "shared">("direct"),
    ...(ownerName ? { ownerName } : {}),
    ...(splitBasisPoints ? { splitBasisPoints } : {})
  };

  const missing = FIELD_ORDER.filter((field) => {
    if (field === "ownerName") {
      return isShared && !ownerName;
    }
    if (field === "splitBasisPoints") {
      return isShared && !splitBasisPoints;
    }
    return !fields[field];
  });

  const draft: EntryDraftDto = {
    fields,
    ...(foreignAmount ? { foreignAmount } : {}),
    ...(transferAccount ? {
      transferAccount: {
        value: { accountId: transferAccount.value.id, accountName: transferAccount.value.name },
        source: transferAccount.source
      }
    } : {}),
    missing,
    questions: questions.sort((left, right) => FIELD_ORDER.indexOf(left.field) - FIELD_ORDER.indexOf(right.field)),
    flags
  };
  const createBody = missing.length ? undefined : buildCreateBody(fields);
  return createBody ? { ...draft, createBody } : draft;
}

// True when the optional AI gap-filler could help: the sentence named no
// amount at all, or left nothing for a description. Never for a conflict,
// an unknown currency or a foreign amount: those are the user's call.
export function entryDraftWantsAi(draft: EntryDraftDto) {
  if (draft.flags.includes("empty_text")) {
    return false;
  }
  const amountQuestion = draft.questions.find((question) => question.field === "amountMinor");
  return amountQuestion?.reason === "missing" || draft.missing.includes("description");
}

// Validates an AI answer like any other input. An amount must be stated in
// the sentence (its digits, or number words such as "twelve fifty"); every
// word of a description must be a word of the sentence. Anything else is
// refused, and an answer with nothing usable is null.
export function parseEntryDraftAiSuggestion(value: unknown, text: string): EntryDraftAiSuggestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as { amount?: unknown; description?: unknown };
  const suggestion: EntryDraftAiSuggestion = {};

  if (typeof record.amount === "number" || typeof record.amount === "string") {
    const amountText = String(record.amount).trim();
    if (/^\d+(?:\.\d{1,2})?$/.test(amountText)) {
      const amountMinor = toMinor(Number(amountText));
      if (isValidAmountMinor(amountMinor) && sentenceStatesAmount(text, amountMinor)) {
        suggestion.amountMinor = amountMinor;
      }
    }
  }

  const description = sanitizeDescription(record.description);
  if (description) {
    const sentenceWords = new Set(wordsOf(text));
    const descriptionWords = wordsOf(description);
    if (descriptionWords.length && descriptionWords.every((word) => sentenceWords.has(word))) {
      suggestion.description = description;
    }
  }

  return Object.keys(suggestion).length ? suggestion : null;
}

// ---------------------------------------------------------------------------
// Reading the sentence

class SentenceScanner {
  readonly text: string;
  private readonly consumed: boolean[];

  constructor(text: string) {
    this.text = text;
    this.consumed = Array.from({ length: text.length }, () => false);
  }

  // Matches of `pattern` that overlap nothing already understood.
  find(pattern: string): RegExpExecArray[] {
    const regex = new RegExp(pattern, "giu");
    return [...this.text.matchAll(regex)].filter((match) => this.isFree(match.index, match.index + match[0].length));
  }

  isFree(start: number, end: number) {
    for (let index = start; index < end; index += 1) {
      if (this.consumed[index]) {
        return false;
      }
    }
    return true;
  }

  consume(start: number, end: number) {
    for (let index = start; index < end; index += 1) {
      this.consumed[index] = true;
    }
  }

  consumeMatch(match: RegExpExecArray) {
    this.consume(match.index, match.index + match[0].length);
  }

  // The text with every understood part blanked out. Indexes are UTF-16
  // code units, the same as RegExp match indexes.
  remainder() {
    return this.text.split("").map((char, index) => (this.consumed[index] ? " " : char)).join("");
  }
}

function readSplitRatio(scanner: SentenceScanner) {
  for (const match of scanner.find(`${START}(\\d{1,3})\\s*[/-]\\s*(\\d{1,3})${END}`)) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first + second === 100) {
      scanner.consumeMatch(match);
      return { first, second };
    }
  }
  return undefined;
}

const MONTH_PATTERN = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS: Array<[string, number]> = [
  ["sunday", 0], ["sun", 0], ["monday", 1], ["mon", 1], ["tuesday", 2], ["tues", 2], ["tue", 2],
  ["wednesday", 3], ["wed", 3], ["thursday", 4], ["thurs", 4], ["thur", 4], ["thu", 4],
  ["friday", 5], ["fri", 5], ["saturday", 6], ["sat", 6]
];

interface DateMention {
  index: number;
  // Undefined when the words name an impossible date ("31/2").
  iso?: string;
}

function readDates(scanner: SentenceScanner, today: string): DateMention[] {
  const mentions: DateMention[] = [];
  const todayYear = Number(today.slice(0, 4));
  // A number right after a currency mark is money: "$5 Sep 28" is $5 on
  // 28 September, not 5 September.
  const on = "(?<![\\p{Sc}.,])(?:on\\s+)?";
  const record = (match: RegExpExecArray, iso: string | undefined) => {
    scanner.consumeMatch(match);
    mentions.push({ index: match.index, iso });
  };

  for (const match of scanner.find(`${START}${on}(\\d{4})-(\\d{1,2})-(\\d{1,2})${END}`)) {
    record(match, isoDate(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  // Day first, as written in Singapore: 29/09/26, 29.09.2026, 29-9-26.
  for (const match of scanner.find(`${START}${on}(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4}|\\d{2})${END}`)) {
    record(match, isoDate(fullYear(match[3]), Number(match[2]), Number(match[1])));
  }
  // Without a year only the slash form: "12.10" is an amount, not 12 October.
  for (const match of scanner.find(`${START}${on}(\\d{1,2})/(\\d{1,2})${END}`)) {
    record(match, isoDate(todayYear, Number(match[2]), Number(match[1])));
  }
  for (const match of scanner.find(`${START}${on}(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\.?(?:,?\\s+(\\d{4}))?${END}`)) {
    record(match, isoDate(match[3] ? Number(match[3]) : todayYear, monthNumber(match[2]), Number(match[1])));
  }
  for (const match of scanner.find(`${START}${on}${MONTH_PATTERN}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${END}`)) {
    record(match, isoDate(match[3] ? Number(match[3]) : todayYear, monthNumber(match[1]), Number(match[2])));
  }
  for (const match of scanner.find(`${START}(?:the\\s+)?(day\\s+before\\s+yesterday|yesterday|ytd|yday|last\\s+night|today|tdy|tonight|this\\s+(?:morning|afternoon|evening))${END}`)) {
    const words = match[1].toLowerCase();
    const offset = words.startsWith("day") ? -2 : /^(?:yesterday|ytd|yday|last)/.test(words) ? -1 : 0;
    record(match, addDays(today, offset));
  }
  // Full weekday names count anywhere. A short form ("mon", "sun", "sat")
  // only after "on"/"last" or at the end of a clause, so "Sun Plaza lunch"
  // is a shop, not last Sunday.
  const fullNames = WEEKDAYS.filter(([name]) => name.endsWith("day")).map(([name]) => name).join("|");
  const shortNames = WEEKDAYS.filter(([name]) => !name.endsWith("day")).map(([name]) => name).join("|");
  const weekdayPattern = `${START}(?:(?:(?:last|on)\\s+)?(${fullNames})|(?:last|on)\\s+(${shortNames})|(${shortNames})(?=\\s*(?:[,;.!?]|$)))${END}`;
  for (const match of scanner.find(weekdayPattern)) {
    const named = (match[1] ?? match[2] ?? match[3]).toLowerCase();
    const target = WEEKDAYS.find(([name]) => name === named)?.[1] ?? 0;
    const todayWeekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    // The most recent past one: today's own weekday name means a week ago.
    const daysBack = ((todayWeekday - target + 7) % 7) || 7;
    record(match, addDays(today, -daysBack));
  }

  return mentions.sort((left, right) => left.index - right.index);
}

function readTypeWords(scanner: SentenceScanner) {
  let transfer = false;
  let income = false;
  for (const match of scanner.find(`${START}(?:moved|move|moving|transferred|transferring|transfer|tsf|topped\\s+up|top\\s+up|top-up)${END}`)) {
    scanner.consumeMatch(match);
    transfer = true;
  }
  // Connective income phrases carry no meaning for the description...
  for (const match of scanner.find(`${START}(?:got\\s+paid|get\\s+paid|came\\s+into|came\\s+in|comes\\s+in|received|receive)${END}`)) {
    scanner.consumeMatch(match);
    income = true;
  }
  // ...but income nouns are the description ("Salary"), so they stay.
  if (scanner.find(`${START}(?:salary|payday|bonus|dividends?|income)${END}`).length) {
    income = true;
  }
  return { transfer, income };
}

interface AccountMention {
  accounts: AccountDto[];
  role?: "from" | "to";
}

// Words that name no account on their own: "card", "account", and common
// words that some account names happen to contain ("UOB One", "Citi Cash
// Back", "POSB Joint"). They still strengthen a match next to a real name.
const GENERIC_ACCOUNT_WORDS = new Set(["card", "account", "acct", "the", "bank", "of", "and", "credit", "debit"]);
const WEAK_ACCOUNT_WORDS = new Set([
  "cash", "back", "joint", "one", "miles", "rewards", "everyday", "plus", "my", "savings", "current", "wallet",
  "visa", "mastercard", "master", "world", "elite", "premier", "signature", "platinum", "gold", "prvi"
]);

function readAccountMentions(scanner: SentenceScanner, accounts: AccountDto[], people: PersonDto[]): AccountMention[] {
  const personWords = new Set(people.flatMap((person) => wordsOf(person.name)));
  const vocab = new Map<string, { words: Set<string>; anchors: Set<string> }>();
  for (const account of accounts) {
    const nameWords = wordsOf(account.name).filter((word) => !GENERIC_ACCOUNT_WORDS.has(word));
    const institutionWords = wordsOf(account.institution).filter((word) => !GENERIC_ACCOUNT_WORDS.has(word));
    const words = new Set([...nameWords, ...institutionWords]);
    // A number ("360") is never an anchor on its own: it could be an amount.
    const anchors = new Set([...words].filter((word) => (
      !/^\d+$/.test(word) && !personWords.has(word) && (!WEAK_ACCOUNT_WORDS.has(word) || institutionWords.includes(word))
    )));
    vocab.set(account.id, { words, anchors });
  }

  const tokens = [...scanner.text.matchAll(/[\p{L}\p{N}]+/gu)]
    .filter((match) => scanner.isFree(match.index, match.index + match[0].length))
    .map((match) => ({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length }));
  const adjacent = (left: { end: number }, right: { start: number }) => (
    /^[\s-]*$/.test(scanner.text.slice(left.end, right.start)) && scanner.isFree(left.end, right.start)
  );

  const mentions: AccountMention[] = [];
  const used = new Set<number>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (used.has(index)) {
      continue;
    }
    const candidates = accounts.filter((account) => vocab.get(account.id)?.anchors.has(tokens[index].word));
    if (!candidates.length) {
      continue;
    }
    const known = (word: string) => candidates.some((account) => vocab.get(account.id)?.words.has(word));
    let first = index;
    let last = index;
    while (last + 1 < tokens.length && !used.has(last + 1) && adjacent(tokens[last], tokens[last + 1]) && known(tokens[last + 1].word)) {
      last += 1;
    }
    while (first - 1 >= 0 && !used.has(first - 1) && adjacent(tokens[first - 1], tokens[first]) && known(tokens[first - 1].word)) {
      first -= 1;
    }
    const runWords = tokens.slice(first, last + 1).map((token) => token.word);
    const scores = candidates.map((account) => runWords.filter((word) => vocab.get(account.id)?.words.has(word)).length);
    const best = Math.max(...scores);
    const winners = candidates.filter((_, candidateIndex) => scores[candidateIndex] === best);
    for (let tokenIndex = first; tokenIndex <= last; tokenIndex += 1) {
      used.add(tokenIndex);
    }

    // The preposition before the account says its role and goes with it.
    // It is read from the raw text, so "came into" (already taken as an
    // income phrase) still marks the account as where the money went.
    let start = tokens[first].start;
    const before = scanner.text.slice(0, start).match(/(?<![\p{L}\p{N}])(from|to|into|in|on|with|via|using|by)\s+$/iu);
    let role: AccountMention["role"];
    if (before?.index !== undefined) {
      const word = before[1].toLowerCase();
      role = word === "from" ? "from" : word === "to" || word === "into" ? "to" : undefined;
      if (scanner.isFree(before.index, start)) {
        start = before.index;
      }
    }
    scanner.consume(start, tokens[last].end);
    mentions.push({ accounts: winners, ...(role ? { role } : {}) });
  }
  return mentions;
}

interface AmountCandidate {
  index: number;
  start: number;
  end: number;
  amountMinor: number;
  // An ISO code; null for a plain "$" or "dollars" (the account's own
  // currency); "unknown" for a currency symbol the app does not know.
  currency: string | null;
  // A currency mark or cents make a number an amount; a bare whole number
  // ("2 pax") only counts when nothing stronger is there.
  strong: boolean;
}

const CURRENCY_CODES = ["SGD", "USD", "IDR", "MYR", "JPY", "EUR", "GBP", "AUD", "THB", "KRW", "HKD", "CNY", "TWD", "VND", "PHP", "NZD", "CHF", "CAD", "INR"];
const CURRENCY_SYMBOLS: Record<string, string | null> = {
  "$": null, "S$": "SGD", "SG$": "SGD", "US$": "USD", "A$": "AUD", "HK$": "HKD", "NZ$": "NZD",
  "€": "EUR", "£": "GBP", "¥": "JPY", "₩": "KRW", "฿": "THB", "RP": "IDR", "RP.": "IDR", "RM": "MYR"
};
const CURRENCY_WORDS: Record<string, string | null> = {
  dollar: null, dollars: null, buck: null, bucks: null,
  rupiah: "IDR", ringgit: "MYR", yen: "JPY", baht: "THB", euro: "EUR", euros: "EUR", won: "KRW"
};

function readAmounts(scanner: SentenceScanner): AmountCandidate[] {
  const codes = CURRENCY_CODES.join("|");
  const prefix = `(?<prefix>(?:S|SG|US|A|HK|NZ)\\$|Rp\\.?|RM|${codes}|\\p{Sc})`;
  const number = "(?<number>\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)";
  const suffix = `(?<suffix>${codes}|dollars?|bucks?|rupiah|ringgit|yen|baht|euros?|won|\\p{Sc})`;
  const pattern = `(?<![\\p{L}\\p{N}.,:$])(?:${prefix}\\s?)?${number}(?<thousands>k)?(?:\\s?${suffix})?(?![\\p{L}\\p{N}:%]|[.,]\\d)`;

  const candidates: AmountCandidate[] = [];
  for (const match of scanner.find(pattern)) {
    const groups = match.groups ?? {};
    const decimals = groups.number.split(".")[1];
    if (decimals && decimals.length > 2) {
      continue;
    }
    const major = Number(groups.number.replace(/,/g, "")) * (groups.thousands ? 1000 : 1);
    const amountMinor = toMinor(major);
    if (!isValidAmountMinor(amountMinor)) {
      continue;
    }
    const prefixCurrency = groups.prefix ? readCurrency(groups.prefix) : undefined;
    const suffixCurrency = groups.suffix ? readCurrency(groups.suffix) : undefined;
    const currency = [prefixCurrency, suffixCurrency].includes("unknown")
      ? "unknown"
      : prefixCurrency ?? suffixCurrency ?? null;
    candidates.push({
      index: candidates.length,
      start: match.index,
      end: match.index + match[0].length,
      amountMinor,
      currency,
      strong: Boolean(groups.prefix || groups.suffix || groups.thousands || decimals)
    });
  }

  // Consume only what will be used or offered, so a leftover "2" in
  // "2 pax lunch $24" stays in the description.
  const choice = chooseAmount(candidates);
  const usedCandidates = choice.kind === "one" ? [choice.candidate] : choice.kind === "conflict" ? choice.matches : [];
  for (const candidate of usedCandidates) {
    scanner.consume(candidate.start, candidate.end);
  }
  return candidates;
}

type AmountChoice =
  | { kind: "none" }
  | { kind: "one"; candidate: AmountCandidate }
  | { kind: "conflict"; candidates: AmountCandidate[]; matches: AmountCandidate[] };

function chooseAmount(candidates: AmountCandidate[]): AmountChoice {
  const strong = candidates.filter((candidate) => candidate.strong);
  const pool = strong.length ? strong : candidates;
  const distinct: AmountCandidate[] = [];
  for (const candidate of pool) {
    if (!distinct.some((other) => other.amountMinor === candidate.amountMinor && other.currency === candidate.currency)) {
      distinct.push(candidate);
    }
  }
  if (!distinct.length) {
    return { kind: "none" };
  }
  return distinct.length === 1
    ? { kind: "one", candidate: distinct[0] }
    : { kind: "conflict", candidates: distinct, matches: pool };
}

function readCurrency(token: string): string | null | "unknown" {
  const upper = token.toUpperCase();
  if (CURRENCY_CODES.includes(upper)) {
    return upper;
  }
  if (upper in CURRENCY_SYMBOLS) {
    return CURRENCY_SYMBOLS[upper];
  }
  const lower = token.toLowerCase();
  if (lower in CURRENCY_WORDS) {
    return CURRENCY_WORDS[lower];
  }
  return "unknown";
}

interface PeopleWords {
  // A named payer, or "companion" for "she/he/they paid".
  payer?: string | "companion";
  companion?: string;
  owner?: string;
  splitWords: boolean;
  evenWords: boolean;
}

function readPeople(scanner: SentenceScanner, people: PersonDto[], viewerName?: string): PeopleWords {
  const result: PeopleWords = { splitWords: false, evenWords: false };
  const byLowerName = new Map(people.map((person) => [person.name.toLowerCase(), person.name]));
  const names = people
    .map((person) => person.name)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  const resolveWho = (who: string): string | "companion" | undefined => {
    const lower = who.toLowerCase();
    if (byLowerName.has(lower)) {
      return byLowerName.get(lower);
    }
    if (lower === "i" || lower === "me") {
      return viewerName;
    }
    return "companion";
  };
  const nameAlternatives = names ? `${names}|` : "";

  for (const match of scanner.find(`${START}(?<who>${nameAlternatives}she|he|they|i|me)\\s+paid${END}`)) {
    scanner.consumeMatch(match);
    result.payer ??= resolveWho(match.groups?.who ?? "");
  }
  for (const match of scanner.find(`${START}paid\\s+by\\s+(?<who>${nameAlternatives}me|her|him|them)${END}`)) {
    scanner.consumeMatch(match);
    result.payer ??= resolveWho(match.groups?.who ?? "");
  }
  if (names) {
    for (const match of scanner.find(`${START}(?:with|w/)\\s+(?<who>${names})${END}`)) {
      scanner.consumeMatch(match);
      result.companion ??= byLowerName.get((match.groups?.who ?? "").toLowerCase());
    }
    for (const match of scanner.find(`${START}(?:for\\s+)?(?<who>${names})(?:'s)?${END}`)) {
      scanner.consumeMatch(match);
      result.owner ??= byLowerName.get((match.groups?.who ?? "").toLowerCase());
    }
  }
  for (const match of scanner.find(`${START}(?:mine|my)${END}`)) {
    scanner.consumeMatch(match);
    result.owner ??= viewerName;
  }
  for (const match of scanner.find(`${START}(?:split(?:ting)?|shared?|sharing|go\\s+dutch|halves|half|evenly|equally)${END}`)) {
    scanner.consumeMatch(match);
    result.splitWords = true;
    if (/^(?:halves|half|evenly|equally|go)/i.test(match[0])) {
      result.evenWords = true;
    }
  }
  return result;
}

// Leading and trailing words that only connect the parts the parser took
// out ("Paid $8 for laksa" -> "laksa"). Inside a description they stay
// ("Dinner at Burnt Ends").
const EDGE_FILLER_WORDS = new Set([
  "at", "on", "for", "from", "to", "into", "in", "via", "using", "with", "by", "paid", "pay", "spent", "spend",
  "bought", "buy", "the", "a", "an", "and", "or", "of", "i", "me", "we", "card", "was", "is"
]);

function buildDescription(remainder: string) {
  return remainder
    .split(/[,;]+/)
    .map((segment) => {
      const words = segment.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
      const isFiller = (word: string) => EDGE_FILLER_WORDS.has(word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
        || !/[\p{L}\p{N}]/u.test(word);
      while (words.length && isFiller(words[0])) {
        words.shift();
      }
      while (words.length && isFiller(words[words.length - 1])) {
        words.pop();
      }
      return words.join(" ").replace(/[.!?:\-–—]+$/u, "").trim();
    })
    .filter(Boolean)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Defaults and assembly

function defaultAccount(input: {
  accounts: AccountDto[];
  priorityAccounts: AccountDto[];
  context: EntryDraftContext;
  entryType: EntryType;
  amountCurrency?: string;
  preferredOwnerId?: string;
}) {
  // A purchase in another currency goes to the card chosen for it, exactly
  // as the Shortcut decides (selectShortcutAccount).
  const shortcut = selectShortcutAccount(
    input.accounts,
    input.priorityAccounts.map((account) => account.id),
    { amountCurrency: input.amountCurrency && input.amountCurrency !== "unknown" ? input.amountCurrency : undefined },
    { foreignCurrencyAccountId: input.context.foreignCurrencyAccountId }
  );
  if (shortcut.account?.resolution === "foreign_currency") {
    return input.accounts.find((account) => account.id === shortcut.account?.id);
  }
  // Money in lands in a bank account, not on a card.
  const banks = input.priorityAccounts.filter((account) => account.kind === "bank");
  const pool = input.entryType === "income" && banks.length ? banks : input.priorityAccounts;
  // A shared expense someone else paid, or income someone else received,
  // starts on that person's first account in the priority list.
  return (input.preferredOwnerId ? pool.find((account) => account.ownerPersonId === input.preferredOwnerId) : undefined)
    ?? pool[0];
}

function orderByPriority(accounts: AccountDto[], priorityIds: string[]) {
  const ordered = priorityIds
    .map((accountId) => accounts.find((account) => account.id === accountId))
    .filter((account): account is AccountDto => Boolean(account));
  return [...ordered, ...accounts.filter((account) => !ordered.includes(account))];
}

function accountQuestion(
  reason: "ambiguous" | "transfer_from" | "missing",
  candidates: AccountDto[],
  order: AccountDto[]
): EntryDraftQuestionDto {
  return {
    field: "accountId",
    reason,
    options: order
      .filter((account) => candidates.includes(account))
      .map((account) => ({ accountId: account.id, accountName: account.name }))
  };
}

function personForAccount(account: AccountDto, people: PersonDto[]) {
  return people.find((person) => person.id === account.ownerPersonId)?.name
    ?? people.find((person) => person.name === account.ownerLabel)?.name;
}

function buildCreateBody(fields: EntryDraftDto["fields"]): EntryDraftCreateBodyDto | undefined {
  const { date, description, accountId, accountName, amountMinor } = fields;
  if (!date || !description || !accountId || !accountName || !amountMinor) {
    return undefined;
  }
  return {
    date: date.value,
    description: description.value,
    accountId: accountId.value,
    accountName: accountName.value,
    categoryName: fields.categoryName.value,
    amountMinor: amountMinor.value,
    entryType: fields.entryType.value,
    ...(fields.transferDirection ? { transferDirection: fields.transferDirection.value } : {}),
    ownershipType: fields.ownershipType.value,
    ...(fields.ownerName ? { ownerName: fields.ownerName.value } : {}),
    ...(fields.splitBasisPoints ? { splitBasisPoints: fields.splitBasisPoints.value } : {})
  };
}

// ---------------------------------------------------------------------------
// Small helpers

function sentence<T>(value: T): EntryDraftFieldDto<T> {
  return { value, source: "sentence" satisfies EntryDraftFieldSource };
}

function fallback<T>(value: T): EntryDraftFieldDto<T> {
  return { value, source: "default" satisfies EntryDraftFieldSource };
}

function toMinor(major: number) {
  if (!Number.isFinite(major)) {
    return Number.NaN;
  }
  const scaled = major * 100;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) > 1e-6 ? Number.NaN : rounded;
}

function isValidAmountMinor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

const NUMBER_WORDS = /(?<![\p{L}])(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)(?![\p{L}])/iu;

function sentenceStatesAmount(text: string, amountMinor: number) {
  const stated = (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((value) => toMinor(Number(value.replace(/,/g, ""))));
  return stated.includes(amountMinor) || NUMBER_WORDS.test(text);
}

const UNIT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
};
const TENS_WORDS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
};
// Words that may sit inside or at the end of a spoken amount without being
// a number themselves: "one hundred and twenty", "twelve point five",
// "twenty dollars", "twelve dollars fifty".
const AMOUNT_JOIN_WORDS = new Set(["and", "point"]);
const AMOUNT_CURRENCY_WORDS = new Set(["dollar", "dollars", "buck", "bucks", "cents"]);

// Blanks out the first run of number words that spells `amountMinor`, so
// "Koufu lunch twelve fifty" with an AI amount of 1250 leaves "Koufu lunch".
// Number words that spell something else ("Seven Eleven") stay.
function removeAmountWords(remainder: string, amountMinor: number) {
  const tokens = [...remainder.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    word: match[0].toLowerCase(),
    start: match.index,
    end: match.index + match[0].length
  }));
  const isNumberWord = (word: string) => word in UNIT_WORDS || word in TENS_WORDS || word === "hundred" || word === "thousand";
  const inRun = (word: string) => isNumberWord(word) || AMOUNT_JOIN_WORDS.has(word) || AMOUNT_CURRENCY_WORDS.has(word);
  for (let first = 0; first < tokens.length; first += 1) {
    if (!isNumberWord(tokens[first].word)) {
      continue;
    }
    let last = first;
    while (last + 1 < tokens.length && inRun(tokens[last + 1].word)) {
      last += 1;
    }
    // A run never ends on a joining word: "twenty and" keeps its "and".
    while (AMOUNT_JOIN_WORDS.has(tokens[last].word)) {
      last -= 1;
    }
    const run = tokens.slice(first, last + 1).map((token) => token.word);
    if (spokenAmountsMinor(run).includes(amountMinor)) {
      const start = tokens[first].start;
      const end = tokens[last].end;
      return remainder.slice(0, start) + " ".repeat(end - start) + remainder.slice(end);
    }
    first = last;
  }
  return remainder;
}

// Every amount a run of number words can mean: a whole number of dollars
// ("one hundred and twenty"), or dollars then cents ("twelve fifty",
// "twelve point five", "twelve dollars fifty"), or "one twenty" as $120.
function spokenAmountsMinor(run: string[]) {
  const amounts: number[] = [];
  const marker = run.findIndex((word) => word === "point" || (AMOUNT_CURRENCY_WORDS.has(word) && word !== "cents"));
  const numbers = (words: string[]) => words.filter((word) => !AMOUNT_JOIN_WORDS.has(word) && !AMOUNT_CURRENCY_WORDS.has(word));
  if (marker > 0 && marker < run.length - 1) {
    const dollars = spokenNumber(numbers(run.slice(0, marker)));
    const centWords = numbers(run.slice(marker + 1));
    const cents = spokenNumber(centWords);
    if (dollars !== undefined && cents !== undefined) {
      // "twelve point five" is $12.50; "twelve dollars five" is $12.05.
      amounts.push(dollars * 100 + (run[marker] === "point" && cents < 10 && centWords.length === 1 ? cents * 10 : cents));
    }
    return amounts;
  }
  const words = numbers(run);
  const whole = spokenNumber(words);
  if (whole !== undefined) {
    amounts.push(whole * 100);
  }
  for (let split = 1; split < words.length; split += 1) {
    const dollars = spokenNumber(words.slice(0, split));
    const cents = spokenNumber(words.slice(split));
    if (dollars !== undefined && cents !== undefined && cents < 100) {
      amounts.push(dollars * 100 + cents);
      if (dollars < 10 && cents >= 10) {
        amounts.push((dollars * 100 + cents) * 100);
      }
    }
  }
  return amounts;
}

// A cardinal in words ("one hundred twenty three", "two thousand"), or
// undefined when the words are not exactly one number.
function spokenNumber(words: string[]): number | undefined {
  let index = 0;
  const belowHundred = () => {
    const word = words[index];
    if (word in UNIT_WORDS) {
      index += 1;
      return UNIT_WORDS[word];
    }
    if (word in TENS_WORDS) {
      index += 1;
      const next = words[index];
      if (next in UNIT_WORDS && UNIT_WORDS[next] < 10) {
        index += 1;
        return TENS_WORDS[word] + UNIT_WORDS[next];
      }
      return TENS_WORDS[word];
    }
    return undefined;
  };
  const belowThousand = () => {
    const leading = belowHundred();
    if (words[index] === "hundred") {
      index += 1;
      return (leading ?? 1) * 100 + (belowHundred() ?? 0);
    }
    return leading;
  };
  if (!words.length) {
    return undefined;
  }
  let value = belowThousand();
  if (words[index] === "thousand") {
    index += 1;
    value = (value ?? 1) * 1000 + (belowThousand() ?? 0);
  }
  return value !== undefined && index === words.length ? value : undefined;
}

function sanitizeDescription(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned && cleaned.length <= AI_DESCRIPTION_MAX_LENGTH && /[\p{L}]/u.test(cleaned) ? cleaned : undefined;
}

function wordsOf(value: string) {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function uniqueAccounts(accounts: AccountDto[]) {
  return accounts.filter((account, index) => accounts.findIndex((other) => other.id === account.id) === index);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function isoDate(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    return undefined;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fullYear(value: string) {
  return value.length === 2 ? 2000 + Number(value) : Number(value);
}

function monthNumber(name: string) {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
