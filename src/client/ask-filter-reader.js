// The Ask page's filter reader: a typed request such as "grab rides in
// september", "serene's shared groceries last month" or "food over $50 this
// month" read into an Entries filter, from the people, wallets and
// categories the page already has (no request, no AI). Pure: the same text
// and context always read the same way.
//
// It never guesses. A word that fits two wallets or categories, two months,
// two people, or a scope on the household view comes back as a question
// whose options are chips; an unknown category named as a category comes
// back as "unknown". A sentence that reads as a new entry (an amount with no
// "over" or "under", or "today"/"yesterday" outside a question) and a
// question it cannot read anything from come back as "none", so the page
// keeps its entry reader and its "not answered yet" note for them.
//
// docs/flows/ask-flow.md "Search and filter" has the contract;
// tests/ask-filter-reader.test.mjs the scenarios.

import { addDaysToIsoDate } from "./app-dates";

/**
 * @typedef {{ month: string, viewId: string, scope: string, search: string, categories: string[], wallets: string[], type: "" | "expense" | "income" | "transfer", minAmountMinor: number | null, maxAmountMinor: number | null }} EntriesFilter
 * @typedef {{ key: string, label: string, patch: Partial<EntriesFilter> }} FilterOption
 * @typedef {{ field: "month" | "wallet" | "category" | "person", reason?: string, word?: string, options: FilterOption[] }} FilterQuestion
 * @typedef {{ kind: "none" } | { kind: "filter", filter: EntriesFilter } | { kind: "question", filter: EntriesFilter, questions: FilterQuestion[] } | { kind: "view", viewId: string, scope: string } | { kind: "unknown", reason: "category", word: string }} FilterReading
 */

const MONTH_WORDS = new Map([
  ["january", 1], ["jan", 1], ["february", 2], ["feb", 2], ["march", 3], ["mar", 3], ["april", 4], ["apr", 4],
  ["may", 5], ["june", 6], ["jun", 6], ["july", 7], ["jul", 7], ["august", 8], ["aug", 8], ["september", 9],
  ["sept", 9], ["sep", 9], ["october", 10], ["oct", 10], ["november", 11], ["nov", 11], ["december", 12], ["dec", 12]
]);
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LEAD_WORDS = new Set(["in", "for", "during", "of", "since", "from"]);

// A request that starts like this is a question or a search, whatever else
// it holds.
const QUESTION_WORDS = new Set(["how", "what", "whats", "when", "where", "which", "who", "why", "did", "do", "does", "is", "are", "am", "was", "were", "can", "could", "any", "total"]);
const SEARCH_COMMANDS = new Set(["show", "find", "search", "list", "filter", "look", "see", "view", "open", "give", "display"]);

const TYPE_WORDS = new Map([
  ["income", "income"], ["incomes", "income"], ["earned", "income"], ["earnings", "income"], ["received", "income"],
  ["transfer", "transfer"], ["transfers", "transfer"], ["transferred", "transfer"], ["moved", "transfer"],
  ["spending", "expense"], ["spend", "expense"], ["spent", "expense"], ["expense", "expense"], ["expenses", "expense"],
  ["bought", "expense"], ["purchases", "expense"], ["paid", "expense"], ["payments", "expense"]
]);
const SCOPE_WORDS = new Map([
  ["shared", "shared"], ["joint", "shared"], ["direct", "direct"], ["personal", "direct"], ["own", "direct"], ["individual", "direct"]
]);
const HOUSEHOLD_WORDS = new Set(["household", "everyone", "family"]);
const DATE_WORDS = new Map([["today", 0], ["yesterday", 1]]);

const OVER_WORDS = ["more than", "greater than", "at least", "over", "above", "min", "minimum", ">=", ">"];
const UNDER_WORDS = ["less than", "at most", "up to", "under", "below", "max", "maximum", "<=", "<"];

// Words that carry no filter of their own.
const FILLERS = new Set([
  "a", "an", "the", "my", "me", "mine", "i", "we", "our", "us", "you", "your", "all", "on", "in", "at", "for", "of",
  "from", "to", "by", "with", "and", "or", "into", "onto", "about", "much", "many", "how", "what", "whats", "which",
  "where", "when", "who", "why", "did", "do", "does", "is", "are", "am", "was", "were", "has", "have", "had", "been",
  "be", "it", "its", "that", "this", "these", "those", "there", "any", "some", "only", "just", "please", "can", "could",
  "total", "totals", "sum", "entries", "entry", "transactions", "transaction", "rows", "items", "things", "stuff",
  "card", "cards", "account", "accounts", "wallet", "wallets", "money", "ride", "rides", "trip", "trips", "order",
  "orders", "cost", "costs", "month", "months", "view", "views", "scope", "show", "find", "search", "list", "filter",
  "look", "up", "see", "open", "give", "display", "switch", "change", "go", "back", "category",
  "categories", "s", "doing", "done", "so", "far", "now", "get", "got", "let", "lets", "check"
]);

// Name words too plain to pick a wallet or category by themselves.
const GENERIC_NAME_WORDS = new Set(["card", "account", "accounts", "the", "and", "other", "income", "mo", "yr", "extra", "one", "cash", "back"]);

function stem(word) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ses|xes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function nameWords(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/'s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** @returns {{ text: string, stem: string, possessive: boolean, used: boolean }[]} */
function tokenize(text) {
  const raw = String(text ?? "").toLowerCase().replace(/[’‘]/g, "'");
  const matches = raw.match(/\d{4}-\d{2}(?:-\d{2})?|\$?\d[\d,]*(?:\.\d+)?k?|[a-z][a-z0-9]*(?:'s|')?|[<>]=?/g) ?? [];
  return matches.map((match) => {
    const possessive = /'s?$/.test(match);
    const word = match.replace(/'s?$/, "");
    return { text: word, stem: stem(word), possessive, used: false };
  });
}

function addMonths(monthKey, delta) {
  const [year, month] = monthKey.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}


function formatMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return `${SHORT_MONTHS[month - 1]} ${year}`;
}

function parseAmount(token) {
  if (!token || !/^\$?\d/.test(token.text)) return null;
  const text = token.text.replace(/[$,]/g, "");
  const thousands = text.endsWith("k");
  const value = Number(thousands ? text.slice(0, -1) : text);
  return Number.isFinite(value) ? Math.round(value * (thousands ? 1000 : 1) * 100) : null;
}

function isAmountToken(token) {
  return Boolean(token) && /^\$?\d[\d,]*(?:\.\d+)?k?$/.test(token.text) && !/^(19|20)\d{2}$/.test(token.text);
}

function isYearToken(token) {
  return Boolean(token) && /^20\d{2}$/.test(token.text);
}

// Finds `phrase` (an array of words) at `index`, comparing the stems.
function phraseAt(tokens, index, words) {
  if (index + words.length > tokens.length) return false;
  return words.every((word, offset) => !tokens[index + offset].used && tokens[index + offset].stem === stem(word));
}

function markUsed(tokens, index, count) {
  for (let offset = 0; offset < count; offset += 1) tokens[index + offset].used = true;
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function isQueryForm(text) {
  const trimmed = String(text ?? "").trim();
  if (/\?\s*$/.test(trimmed)) return true;
  const first = tokenize(trimmed)[0]?.text ?? "";
  return QUESTION_WORDS.has(first) || SEARCH_COMMANDS.has(first);
}

// Full names first (longest wins), so "uob one account" is one wallet and
// "other income" one category before any single word is read.
function readFullNames(tokens, items, coreOf) {
  const found = [];
  const candidates = items
    .map((item) => ({ item, words: coreOf(item) }))
    .filter((candidate) => candidate.words.length)
    .sort((left, right) => right.words.length - left.words.length);
  for (const candidate of candidates) {
    for (let index = 0; index < tokens.length; index += 1) {
      if (phraseAt(tokens, index, candidate.words) && (candidate.words.length > 1 || !GENERIC_NAME_WORDS.has(candidate.words[0]))) {
        markUsed(tokens, index, candidate.words.length);
        found.push(candidate.item);
        break;
      }
    }
  }
  return found;
}

function accountCore(account) {
  const words = nameWords(account.name);
  const core = words.filter((word, index) => index === 0 || !["card", "account"].includes(word));
  return core.length ? core : words;
}

function categoryCore(category) {
  return nameWords(category.name).filter((word) => word !== "and");
}

/**
 * @param {string} text
 * @param {{ today: string, month: string, viewId: string, scope: string, people?: { id: string, name: string }[], accounts?: { id: string, name: string, institution?: string, isActive?: boolean }[], categories?: { name: string }[] }} context
 * @param {{ cardOpen?: boolean }} [options] cardOpen: an entry card is being
 *   filled, so a plain sentence ("groceries", "Citi", "split with Serene") is
 *   a change to it; only a question, or a request with a month, a person's
 *   name with 's or an amount limit, reads as a search.
 * @returns {FilterReading}
 */
export function readFilterRequest(text, context, { cardOpen = false } = {}) {
  const tokens = tokenize(text);
  if (!tokens.length) {
    return { kind: "none" };
  }
  const first = tokens[0].text;
  const queryForm = isQueryForm(text);
  const searchCommand = SEARCH_COMMANDS.has(first);
  const people = context.people ?? [];
  const accounts = (context.accounts ?? []).filter((account) => account.isActive !== false);
  const categories = (context.categories ?? []).filter((category) => !["income", "transfer"].includes(String(category.name).toLowerCase()));
  const signals = { strong: false, view: false, other: false };
  /** @type {FilterQuestion[]} */
  const questions = [];

  // Amounts: "over $50", "under 30", "between $20 and $50". Any other
  // amount reads as a new entry ("Koufu $12.50").
  let minAmountMinor = null;
  let maxAmountMinor = null;
  let bareAmount = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.used) continue;
    if (token.text === "between" && isAmountToken(tokens[index + 1]) && tokens[index + 2]?.text === "and" && isAmountToken(tokens[index + 3])) {
      minAmountMinor = parseAmount(tokens[index + 1]);
      maxAmountMinor = parseAmount(tokens[index + 3]);
      markUsed(tokens, index, 4);
      continue;
    }
    for (const [words, side] of [[OVER_WORDS, "min"], [UNDER_WORDS, "max"]]) {
      for (const word of words) {
        const parts = word.split(" ");
        if (parts.every((part, offset) => tokens[index + offset]?.text === part) && isAmountToken(tokens[index + parts.length])) {
          const amount = parseAmount(tokens[index + parts.length]);
          if (side === "min") minAmountMinor = amount;
          else maxAmountMinor = amount;
          markUsed(tokens, index, parts.length + 1);
        }
      }
      if (token.used) break;
    }
  }
  if (minAmountMinor !== null || maxAmountMinor !== null) {
    signals.strong = true;
  }

  // Months and days.
  const months = new Set();
  let dateSearch = "";
  let dateWord = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.used) continue;
    const next = tokens[index + 1];
    if ((token.text === "this" || token.text === "last" || token.text === "previous") && next?.text === "month" && !next.used) {
      months.add(token.text === "this" ? context.today.slice(0, 7) : addMonths(context.today.slice(0, 7), -1));
      markUsed(tokens, index, 2);
      continue;
    }
    if (/^\d{4}-\d{2}$/.test(token.text)) {
      months.add(token.text);
      token.used = true;
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(token.text)) {
      months.add(token.text.slice(0, 7));
      dateSearch = token.text;
      token.used = true;
      continue;
    }
    if (DATE_WORDS.has(token.text)) {
      const date = addDaysToIsoDate(context.today, -DATE_WORDS.get(token.text));
      months.add(date.slice(0, 7));
      dateSearch = date;
      dateWord = true;
      token.used = true;
      continue;
    }
    const monthNumber = MONTH_WORDS.get(token.text);
    if (monthNumber) {
      const previous = tokens[index - 1];
      // "may" is a month only when it reads as one ("in may", "may 2026").
      if (token.text === "may" && !isYearToken(next) && !MONTH_LEAD_WORDS.has(previous?.text ?? "")) {
        continue;
      }
      let year = Number(context.today.slice(0, 4));
      if (isYearToken(next)) {
        year = Number(next.text);
        next.used = true;
      } else if (`${year}-${String(monthNumber).padStart(2, "0")}` > context.today.slice(0, 7)) {
        year -= 1;
      }
      months.add(`${year}-${String(monthNumber).padStart(2, "0")}`);
      token.used = true;
    }
  }
  if (months.size) {
    signals.strong = true;
  }

  // Full wallet and category names.
  const fullWallets = readFullNames(tokens, accounts, accountCore);
  const fullCategories = readFullNames(tokens, categories, categoryCore);
  if (tokens.some((token) => !token.used && isAmountToken(token))) {
    bareAmount = true;
  }

  // People, the household and scope words.
  const namedPeople = [];
  let householdNamed = false;
  let scopeWord = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.used) continue;
    const person = people.find((item) => nameWords(item.name)[0] === token.text);
    if (person) {
      if (!namedPeople.includes(person)) namedPeople.push(person);
      token.used = true;
      continue;
    }
    if (HOUSEHOLD_WORDS.has(token.text)) {
      householdNamed = true;
      token.used = true;
      continue;
    }
    if (token.text === "direct" && tokens[index + 1]?.text === "and" && tokens[index + 2]?.text === "shared") {
      scopeWord = "direct_plus_shared";
      markUsed(tokens, index, 3);
      continue;
    }
    if (SCOPE_WORDS.has(token.text)) {
      scopeWord = SCOPE_WORDS.get(token.text);
      token.used = true;
    }
  }

  // Entry type words.
  /** @type {EntriesFilter["type"]} */
  let type = "";
  for (const token of tokens) {
    if (!token.used && TYPE_WORDS.has(token.text)) {
      type = /** @type {EntriesFilter["type"]} */ (TYPE_WORDS.get(token.text));
      token.used = true;
    }
  }
  if (type) {
    signals.strong = true;
  }

  // Single words: a wallet's brand (its first word or its bank), then a
  // category word, then a wallet's other distinctive words.
  const walletCandidates = [];
  for (const token of tokens) {
    if (token.used || token.text.length < 3 || FILLERS.has(token.text)) continue;
    const matches = accounts.filter((account) => {
      const words = accountCore(account);
      const institution = nameWords(account.institution ?? "");
      return words[0] === token.text
        || institution.includes(token.text)
        || (token.text.length >= 4 && institution.some((word) => word.startsWith(token.text)));
    });
    if (matches.length) {
      token.used = true;
      walletCandidates.push(matches);
    }
  }
  const categoryCandidates = [];
  for (const token of tokens) {
    if (token.used || token.text.length < 3 || FILLERS.has(token.text) || GENERIC_NAME_WORDS.has(token.text)) continue;
    const matches = categories.filter((category) => categoryCore(category).some((word) => !GENERIC_NAME_WORDS.has(word) && stem(word) === token.stem));
    if (matches.length) {
      token.used = true;
      categoryCandidates.push(matches);
    }
  }
  for (const token of tokens) {
    if (token.used || token.text.length < 5 || FILLERS.has(token.text) || GENERIC_NAME_WORDS.has(token.text)) continue;
    const matches = accounts.filter((account) => accountCore(account).slice(1).includes(token.text));
    if (matches.length) {
      token.used = true;
      walletCandidates.push(matches);
    }
  }

  // A category named as a category ("the crypto category") that is not one.
  let unknownCategory = "";
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].text !== "category" && tokens[index].text !== "categories") continue;
    tokens[index].used = true;
    const neighbour = [tokens[index - 1], tokens[index + 1]].find((token) => token && !token.used && !FILLERS.has(token.text) && /^[a-z]/.test(token.text));
    if (neighbour) {
      neighbour.used = true;
      unknownCategory = neighbour.text;
    }
  }

  const searchWords = tokens.filter((token) => !token.used && !FILLERS.has(token.text) && !isAmountToken(token) && token.text.length > 1 && /^[a-z0-9]/.test(token.text));

  if (fullCategories.length || categoryCandidates.length || unknownCategory || scopeWord || namedPeople.some((person) => tokens.some((token) => token.possessive && token.text === nameWords(person.name)[0]))) {
    signals.strong = true;
  }
  if (fullWallets.length || walletCandidates.length || searchWords.length || dateSearch) {
    signals.other = true;
  }
  signals.view = Boolean(namedPeople.length || householdNamed || scopeWord);

  // Entry sentences stay with the entry reader.
  if (!queryForm && (bareAmount || dateWord)) {
    return { kind: "none" };
  }
  // "Split with Serene" or "make it shared" change the card; "Serene's",
  // a month or an amount limit only ever describe a search.
  const searchShaped = months.size > 0 || minAmountMinor !== null || maxAmountMinor !== null
    || tokens.some((token) => token.possessive && people.some((person) => nameWords(person.name)[0] === token.text));
  if (cardOpen && !queryForm && !searchShaped) {
    return { kind: "none" };
  }
  if (queryForm && bareAmount && !signals.strong) {
    return { kind: "none" };
  }

  // The view: a named person, the household, or the page's own view.
  let viewId = context.viewId || "household";
  let scope = context.scope || "direct_plus_shared";
  if (namedPeople.length + (householdNamed ? 1 : 0) > 1) {
    questions.push({
      field: "person",
      options: [
        ...namedPeople.map((person) => ({ key: person.id, label: person.name, patch: { viewId: person.id, scope: scopeWord || "direct_plus_shared" } })),
        ...(scopeWord && scopeWord !== "direct_plus_shared" ? [] : [{ key: "household", label: "Household", patch: { viewId: "household", scope: "direct_plus_shared" } }])
      ]
    });
  } else if (namedPeople.length === 1) {
    viewId = namedPeople[0].id;
    scope = scopeWord || (viewId === context.viewId ? scope : "direct_plus_shared");
  } else if (householdNamed) {
    viewId = "household";
    scope = "direct_plus_shared";
  } else if (scopeWord) {
    scope = scopeWord;
  }
  if (viewId === "household") {
    if (scopeWord && scopeWord !== "direct_plus_shared" && !householdNamed && !questions.some((question) => question.field === "person")) {
      // The household has one scope: whose shared (or direct) entries?
      const scopeLabel = scopeWord === "shared" ? "Shared" : "Direct";
      questions.push({
        field: "person",
        options: people.map((person) => ({ key: person.id, label: `${person.name} · ${scopeLabel}`, patch: { viewId: person.id, scope: scopeWord } }))
      });
    }
    scope = "direct_plus_shared";
  }

  // A view or scope with nothing else to filter is a view change.
  if (signals.view && !months.size && !type && minAmountMinor === null && maxAmountMinor === null && !signals.other
    && !fullCategories.length && !categoryCandidates.length && !unknownCategory) {
    if (questions.length) {
      return { kind: "question", filter: baseFilter(), questions };
    }
    return { kind: "view", viewId, scope };
  }

  // Nothing to filter by. Loose words alone (a wallet, a shop name) read as
  // a filter only after a search command ("find koufu") or in a question
  // that names a wallet or a day; otherwise they may be a new entry.
  const hasFilter = signals.strong
    || (signals.other && (searchCommand || (queryForm && Boolean(fullWallets.length || walletCandidates.length || dateSearch))));
  if (!hasFilter) {
    return { kind: "none" };
  }

  // Months: one, or ask which.
  let month = context.month || context.today.slice(0, 7);
  const monthList = [...months].sort();
  if (monthList.length === 1) {
    month = monthList[0];
  } else if (monthList.length > 1) {
    questions.push({ field: "month", options: monthList.map((key) => ({ key, label: formatMonth(key), patch: { month: key } })) });
  }

  // Wallets: full names are sure; one brand word that fits several asks.
  const wallets = fullWallets.map((account) => account.id);
  for (const matches of walletCandidates) {
    if (matches.length === 1) {
      if (!wallets.includes(matches[0].id)) wallets.push(matches[0].id);
    } else {
      questions.push({ field: "wallet", options: optionsFor(matches.map((account) => ({ key: account.id, label: account.name, value: account.id })), "wallets") });
    }
  }

  const categoryNames = fullCategories.map((category) => category.name);
  for (const matches of categoryCandidates) {
    if (matches.length === 1) {
      if (!categoryNames.includes(matches[0].name)) categoryNames.push(matches[0].name);
    } else {
      questions.push({ field: "category", options: optionsFor(matches.map((category) => ({ key: category.name, label: category.name, value: category.name })), "categories") });
    }
  }
  if (unknownCategory) {
    const near = categories
      .map((category) => ({ category, distance: Math.min(...[category.name, ...categoryCore(category)].map((word) => editDistance(unknownCategory, word.toLowerCase()))) }))
      .filter((candidate) => candidate.distance <= 2)
      .sort((left, right) => left.distance - right.distance || left.category.name.localeCompare(right.category.name))
      .slice(0, 4)
      .map((candidate) => candidate.category);
    if (!near.length) {
      return { kind: "unknown", reason: "category", word: unknownCategory };
    }
    questions.push({
      field: "category",
      reason: "unknown",
      word: unknownCategory,
      options: near.map((category) => ({ key: category.name, label: category.name, patch: { categories: [category.name] } }))
    });
  }

  const search = [...(dateSearch ? [dateSearch] : []), ...searchWords.map((token) => token.text)].join(" ");
  const filter = { ...baseFilter(), month, viewId, scope, search, categories: categoryNames, wallets, type, minAmountMinor, maxAmountMinor };
  return questions.length ? { kind: "question", filter, questions } : { kind: "filter", filter };

  function baseFilter() {
    return {
      month: context.month || context.today.slice(0, 7),
      viewId,
      scope,
      search: "",
      categories: [],
      wallets: [],
      type: /** @type {EntriesFilter["type"]} */ (""),
      minAmountMinor: null,
      maxAmountMinor: null
    };
  }
}

// One chip per match, then "All of them" (the filter takes several). A
// wallet or category option adds to what the request already named.
function optionsFor(matches, field) {
  const options = matches.map((match) => ({ key: match.key, label: match.label, patch: { [field]: [match.value] } }));
  options.push({ key: "all", label: "All of them", patch: { [field]: matches.map((match) => match.value) } });
  return options;
}

// Applies a chosen option: wallets and categories are added, the month and
// the view replaced.
export function applyFilterOption(filter, option) {
  const next = { ...filter };
  for (const [key, value] of Object.entries(option.patch ?? {})) {
    next[key] = Array.isArray(value) ? [...new Set([...(filter[key] ?? []), ...value])] : value;
  }
  return next;
}
