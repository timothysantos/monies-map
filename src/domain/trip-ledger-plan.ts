// Trip ledger import, part 2: the proposed changes for each ledger line,
// written only as steps of the app's existing commands, plus the totals the
// owner checks them against (docs/audits/trip-ledger-import.md). Pure: the
// household's facts come in as a snapshot, nothing is read or written here.
//
// Write boundaries the plan keeps:
// - a statement-certified entry keeps its bank facts (amount, date,
//   wallet): only its category, note, trip and split are proposed;
// - a line whose amount, payer or sharing is not settled, whose category
//   has no place in the household's list, or whose wallet is unknown is
//   held with a question, never imported as a guess;
// - no category, person or wallet is invented.
import {
  addDays,
  matchTripLedger,
  readLineHold,
  type TripLedgerCandidateEntry,
  type TripLedgerConfidence,
  type TripLedgerLine,
  type TripLedgerMatchOptions
} from "./trip-ledger-match";

export interface TripLedgerSnapshot {
  householdId: string;
  people: { id: string; name: string; role: string }[];
  accounts: { id: string; name: string; ownerPersonId: string | null; isJoint: boolean; kind: string; currency: string; active: boolean }[];
  categories: { id: string; name: string }[];
  tripEvents: { id: string; name: string; startDate: string | null; endDate: string | null; currency: string | null; splitGroupId: string | null; putAway: boolean }[];
  splitGroups: { id: string; name: string; currency: string }[];
  entries: (TripLedgerCandidateEntry & {
    categoryName: string | null;
    note: string | null;
    tripEventId: string | null;
    splitExpenseId: string | null;
    externalReference: string | null;
  })[];
}

// The owner's answers, read from a file next to the export. Every field is
// optional; a missing answer leaves its question open.
export interface TripLedgerAnswers {
  // Ledger category -> household category name.
  categories?: Record<string, string>;
  // Ledger funding card text -> account id.
  wallets?: Record<string, string>;
  // Lines to leave out entirely.
  skip?: string[];
  // Lines the ledger itself marks provisional that the owner accepts as is.
  acceptProvisional?: string[];
  // The Splits group: an existing group's id, a new group's name, or none.
  splitGroup?: { existingId: string } | { newName: string } | { none: true };
  trip?: { name?: string; startDate?: string | null; endDate?: string | null; currency?: string | null };
}

export interface TripLedgerConfig {
  // The ledger's own word for the household's owner ("You").
  youWord: string;
  tripName: string;
  tripIconKey: string;
  tripCurrency: string;
  // The trip's dates; start defaults to the first purchase on day 1 or later.
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  // Bounded note length (characters) for the item lines.
  noteMaxLength: number;
  match?: Partial<TripLedgerMatchOptions>;
}

export const DEFAULT_TRIP_LEDGER_CONFIG: Omit<TripLedgerConfig, "tripName"> = {
  youWord: "You",
  tripIconKey: "plane",
  tripCurrency: "JPY",
  noteMaxLength: 280
};

// A trip or split group that exists (id) or that an earlier step makes (name).
export type TripLedgerRef = { id: string } | { newName: string };
// An entry that exists (id) or that a create step in this plan makes (its
// external reference).
export type TripLedgerEntryRef = { id: string } | { externalReference: string };

export type TripLedgerStep =
  | { stepId: string; kind: "create_split_group"; name: string; currency: string }
  | { stepId: string; kind: "create_trip"; name: string; iconKey: string; startDate: string | null; endDate: string | null; currency: string | null; splitGroup: TripLedgerRef | null }
  | {
    stepId: string;
    kind: "create_entry";
    lineId: string;
    externalReference: string;
    accountId: string;
    date: string;
    description: string;
    categoryName: string;
    amountMinor: number;
    originalAmountMinor: number | null;
    originalCurrency: string | null;
    note: string;
    // Shared: created with its split in the entry's own batch.
    shared: boolean;
    // The household's first person's share (as splitAmountMinor means in
    // every split command).
    firstPersonShareMinor: number | null;
    splitGroup: TripLedgerRef | null;
  }
  | { stepId: string; kind: "set_category"; lineId: string; entryId: string; before: string | null; categoryName: string }
  | { stepId: string; kind: "set_note"; lineId: string; entryId: string; before: string | null; note: string }
  | { stepId: string; kind: "add_entry_to_splits"; lineId: string; entryId: string; payerPersonId: string; splitGroup: TripLedgerRef | null; firstPersonShareMinor: number; entryAmountMinor: number }
  | {
    stepId: string;
    kind: "create_split_expense";
    lineId: string;
    date: string;
    description: string;
    categoryName: string;
    payerPersonName: string;
    amountMinor: number;
    firstPersonShareMinor: number;
    note: string;
    splitGroup: TripLedgerRef | null;
  }
  | { stepId: string; kind: "put_on_trip"; trip: TripLedgerRef; entries: { lineId: string; entry: TripLedgerEntryRef }[] };

export type TripLedgerOutcome = "matched" | "new" | "splits-only" | "nothing" | "held" | "skipped";

export interface TripLedgerLinePlan {
  lineId: string;
  day: number | null;
  date: string | null;
  time: string | null;
  merchant: string;
  payerName: string;
  homeMinor: number | null;
  foreignMinor: number | null;
  owedHomeMinor: number | null;
  ledgerCategory: string;
  categoryName: string | null;
  confidence: TripLedgerConfidence;
  entryId: string | null;
  candidates: { entryId: string; score: number; reasons: string[] }[];
  matchReasons: string[];
  outcome: TripLedgerOutcome;
  statementCertified: boolean;
  // Plain words, one per change.
  changes: string[];
  holdReasons: string[];
  stepIds: string[];
}

export interface TripLedgerQuestion {
  id: string;
  lineIds: string[];
  text: string;
  options: string[];
  // Blocking: the lines wait. Otherwise the plan uses `chosen` until answered.
  blocking: boolean;
  chosen?: string;
}

export interface TripLedgerTotals {
  currency: string;
  firstPersonName: string;
  secondPersonName: string;
  // Positive: the first person (the owner) owes the second.
  owed: { ledger: number; afterImport: number; differences: { lineId: string; merchant: string; ledger: number; afterImport: number; why: string }[] };
  spending: {
    personName: string;
    ledgerPaid: number;
    ledgerShare: number;
    importPaidInEntries: number;
    importPaidSplitsOnly: number;
    importShare: number;
  }[];
  spendingDifferences: { lineId: string; merchant: string; payerName: string; ledgerPaid: number; importPaid: number; why: string }[];
}

export interface TripLedgerPlan {
  kind: "trip-ledger-import";
  version: 1;
  importKey: string;
  householdId: string;
  source: { exportSha256: string; lineCount: number };
  dayZero: string | null;
  foreignCurrency: string | null;
  trip: TripLedgerRef & { name: string };
  splitGroup: (TripLedgerRef & { name: string }) | null;
  steps: TripLedgerStep[];
  lines: TripLedgerLinePlan[];
  questions: TripLedgerQuestion[];
  entriesWithoutLine: { entryId: string; date: string; description: string; amountMinor: number }[];
  possibleBookings: { entryId: string; date: string; description: string; amountMinor: number }[];
  totals: TripLedgerTotals;
}

const CATEGORY_SYNONYMS: Record<string, string[]> = {
  food: ["Food & Drinks", "Food", "Dining"],
  drinks: ["Food & Drinks"],
  transport: ["Public Transport", "Transport"],
  transit: ["Public Transport", "Transport"],
  fashion: ["Shopping"],
  clothing: ["Shopping"],
  hobbies: ["Sports & Hobbies", "Hobbies"],
  travel: ["Travel"],
  groceries: ["Groceries"]
};
const CATEGORY_SUGGESTIONS = ["Shopping", "Sports & Hobbies", "Education", "Gifts", "Other"];
// Words that name a booking made before the trip (a hotel, a flight).
const BOOKING_WORDS = /trip\.com|agoda|booking\.com|airbnb|klook|expedia|airline|airways|scoot|jetstar|zipair|\bana\b|\bjal\b|\bhotel/i;

export function buildTripLedgerPlan(input: {
  lines: TripLedgerLine[];
  snapshot: TripLedgerSnapshot;
  config: TripLedgerConfig;
  answers?: TripLedgerAnswers;
  dayZero: string | null;
  exportSha256: string;
}): TripLedgerPlan {
  const { snapshot, config } = input;
  const answers = input.answers ?? {};
  const questions: TripLedgerQuestion[] = [];
  const steps: TripLedgerStep[] = [];
  const currency = (answers.trip?.currency ?? config.tripCurrency) || null;
  const tripName = answers.trip?.name ?? config.tripName;

  // The two people splits are between, in the order every split command
  // uses: the owner first.
  const people = [...snapshot.people].sort((left, right) => rank(left.role) - rank(right.role));
  const [first, second] = people;
  if (!first || !second) throw new Error("A trip ledger import needs the household's two people.");
  const personForPayer = (payerName: string) => {
    if (payerName.trim().toLowerCase() === config.youWord.trim().toLowerCase()) return first;
    return people.find((person) => person.name.trim().toLowerCase() === payerName.trim().toLowerCase()) ?? null;
  };
  const otherOf = (personId: string) => (personId === first.id ? second : first);

  // Splits group and trip.
  let splitGroup: TripLedgerPlan["splitGroup"] = null;
  const groupAnswer = answers.splitGroup;
  if (groupAnswer && "none" in groupAnswer) {
    splitGroup = null;
  } else if (groupAnswer && "existingId" in groupAnswer) {
    const group = snapshot.splitGroups.find((item) => item.id === groupAnswer.existingId);
    if (!group) throw new Error(`Unknown split group: ${groupAnswer.existingId}`);
    splitGroup = { id: group.id, name: group.name };
  } else {
    const name = groupAnswer && "newName" in groupAnswer ? groupAnswer.newName : tripName;
    const existing = snapshot.splitGroups.find((item) => sameName(item.name, name));
    splitGroup = existing ? { id: existing.id, name: existing.name } : { newName: name, name };
    if (!groupAnswer) {
      questions.push({
        id: "split-group",
        lineIds: [],
        text: `Shared purchases go on Splits in ${existing ? `the "${name}" group` : `a new SGD group "${name}"`}, linked to the trip. Or use an existing group, or no group?`,
        options: [existing ? `"${name}"` : `New group "${name}"`, ...snapshot.splitGroups.filter((group) => !sameName(group.name, name)).map((group) => `"${group.name}"`), "No group"],
        blocking: false,
        chosen: existing ? `"${name}"` : `New group "${name}"`
      });
    }
  }
  const splitGroupRef: TripLedgerRef | null = splitGroup ? ("id" in splitGroup ? { id: splitGroup.id } : { newName: splitGroup.newName }) : null;
  if (splitGroup && "newName" in splitGroup) {
    steps.push({ stepId: "split-group", kind: "create_split_group", name: splitGroup.newName, currency: "SGD" });
  }

  const datedLines = input.lines.filter((line) => line.date);
  const inCountry = datedLines.filter((line) => (line.day ?? 0) >= 1).map((line) => line.date!).sort();
  const startDate = answers.trip?.startDate !== undefined ? answers.trip.startDate : config.tripStartDate ?? inCountry[0] ?? datedLines.map((line) => line.date!).sort()[0] ?? null;
  const endDate = answers.trip?.endDate !== undefined ? answers.trip.endDate : config.tripEndDate ?? null;
  const existingTrip = snapshot.tripEvents.find((trip) => sameName(trip.name, tripName));
  const tripRef: TripLedgerRef = existingTrip ? { id: existingTrip.id } : { newName: tripName };
  if (!existingTrip) {
    steps.push({ stepId: "trip", kind: "create_trip", name: tripName, iconKey: config.tripIconKey, startDate, endDate, currency, splitGroup: splitGroupRef });
  }

  // Categories.
  const categoryByName = new Map(snapshot.categories.map((category) => [category.name.toLowerCase(), category.name]));
  const unmapped = new Map<string, string[]>();
  const categoryFor = (ledgerCategory: string): string | null => {
    const answered = answers.categories?.[ledgerCategory];
    if (answered) {
      const name = categoryByName.get(answered.toLowerCase());
      if (!name) throw new Error(`The answer for "${ledgerCategory}" names "${answered}", which is not in the household's category list.`);
      return name;
    }
    const exact = categoryByName.get(ledgerCategory.toLowerCase());
    if (exact) return exact;
    const synonyms = CATEGORY_SYNONYMS[ledgerCategory.toLowerCase()] ?? [];
    return synonyms.map((name) => categoryByName.get(name.toLowerCase())).find(Boolean) ?? null;
  };

  // Wallets: the card the ledger names, among the payer's own wallets.
  const unknownWallets = new Map<string, string[]>();
  const walletFor = (line: TripLedgerLine, payerId: string): string | null => {
    const card = line.fundingCard ?? "";
    const answered = answers.wallets?.[card];
    if (answered) {
      if (!snapshot.accounts.some((account) => account.id === answered)) throw new Error(`The answer for "${card}" names an unknown wallet.`);
      return answered;
    }
    const cardWords = walletWords(card);
    if (!cardWords.length) return null;
    const fits = snapshot.accounts
      .filter((account) => account.active && account.ownerPersonId === payerId && account.currency === "SGD")
      .filter((account) => {
        const accountWords = walletWords(account.name);
        return accountWords.length > 0 && accountWords.every((word) => cardWords.includes(word));
      });
    return fits.length === 1 ? fits[0].id : null;
  };

  const skip = new Set(answers.skip ?? []);
  const acceptProvisional = new Set(answers.acceptProvisional ?? []);
  const matchable = input.lines.filter((line) => !skip.has(line.id));
  // Entries an earlier run of this import made carry its reference: they
  // are that line's, never another's candidate.
  const referencePrefix = `trip-ledger:${slug(tripName)}:`;
  const importedByLine = new Map<string, string[]>();
  for (const entry of snapshot.entries) {
    if (!entry.externalReference?.startsWith(referencePrefix)) continue;
    const lineId = entry.externalReference.slice(referencePrefix.length).replace(/:\d+$/, "");
    importedByLine.set(lineId, [...(importedByLine.get(lineId) ?? []), entry.id]);
  }
  const match = matchTripLedger({
    lines: matchable.filter((line) => !importedByLine.has(line.id)),
    entries: snapshot.entries.filter((entry) => !entry.externalReference?.startsWith(referencePrefix)),
    payerPersonIdFor: (line) => personForPayer(line.payerName)?.id ?? null,
    options: { foreignCurrency: currency ?? "JPY", ...config.match }
  });
  const matchByLine = new Map(match.matches.map((item) => [item.lineId, item]));
  const entryById = new Map(snapshot.entries.map((entry) => [entry.id, entry]));

  const tripEntries: { lineId: string; entry: TripLedgerEntryRef }[] = [];
  const lines: TripLedgerLinePlan[] = [];
  for (const line of input.lines) {
    const plan: TripLedgerLinePlan = {
      lineId: line.id,
      day: line.day,
      date: line.date,
      time: line.time,
      merchant: line.merchant,
      payerName: line.payerName,
      homeMinor: line.homeMinor,
      foreignMinor: line.foreignMinor,
      owedHomeMinor: line.owedHomeMinor,
      ledgerCategory: line.category,
      categoryName: null,
      confidence: "none",
      entryId: null,
      candidates: [],
      matchReasons: [],
      outcome: "held",
      statementCertified: false,
      changes: [],
      holdReasons: [],
      stepIds: []
    };
    lines.push(plan);
    if (skip.has(line.id)) {
      plan.outcome = "skipped";
      plan.changes.push("Left out, as you asked.");
      continue;
    }
    const imported = importedByLine.get(line.id);
    if (imported) {
      plan.outcome = "matched";
      plan.confidence = "certain";
      plan.entryId = imported[0];
      plan.categoryName = categoryFor(line.category);
      plan.changes.push(`Already imported by an earlier run (${imported.length} entr${imported.length === 1 ? "y" : "ies"}).`);
      continue;
    }
    const matched = matchByLine.get(line.id)!;
    plan.confidence = matched.confidence;
    plan.entryId = matched.entryId;
    plan.candidates = matched.candidates;
    plan.matchReasons = matched.reasons;

    const hold = readLineHold(line);
    if (hold) {
      const holdPayer = personForPayer(line.payerName);
      if (holdPayer && holdPayer.id !== first.id && line.owedHomeMinor === 0) {
        // The other person paid for themselves: nothing to record, whatever
        // the amount, so no question.
        plan.outcome = "nothing";
        plan.changes.push(`Paid by ${holdPayer.name} for ${holdPayer.name}, nothing owed (the ledger has no amount): nothing to record.`);
        continue;
      }
      plan.holdReasons.push(hold);
      const amount = line.homeMinor !== null ? ` ${money(line.homeMinor)}` : "";
      const where = line.fundingCard ? ` on ${line.fundingCard}` : "";
      const ask = line.allocationPending || line.owedHomeMinor === null
        ? `What was it, and who is it for (all ${first.name}'s, all ${second.name}'s, or shared how)?`
        : line.payerPending
          ? "Who paid?"
          : "What was the amount?";
      questions.push({
        id: `hold-${line.id}`,
        lineIds: [line.id],
        text: `${line.merchant}${amount}${where} (${line.date ?? "no date"}): ${hold} ${ask} It stays out until you answer${line.fundingCard ? "; the card's statement brings the charge in by itself either way" : ""}.`,
        options: [],
        blocking: true
      });
      continue;
    }
    if (/provisional (sharing|share|allocation)/i.test(line.notes) && !acceptProvisional.has(line.id)) {
      // The ledger itself calls its sharing provisional: the owner decides.
      questions.push({
        id: `provisional-${line.id}`,
        lineIds: [line.id],
        text: `${line.merchant}: the ledger calls ${otherOf(personForPayer(line.payerName)?.id ?? first.id).name}'s share of ${money(line.owedHomeMinor!)} provisional. Import it as it is?`,
        options: ["Yes, as it is", "Leave it out for now"],
        blocking: false,
        chosen: "Yes, as it is"
      });
    }
    const payer = personForPayer(line.payerName);
    if (!payer) {
      plan.holdReasons.push(`"${line.payerName}" is not one of the household's people.`);
      questions.push({ id: `payer-${line.id}`, lineIds: [line.id], text: `${line.merchant}: who is "${line.payerName}"?`, options: people.map((person) => person.name), blocking: true });
      continue;
    }
    const mappedCategory = categoryFor(line.category);
    plan.categoryName = mappedCategory;
    if (!mappedCategory) {
      unmapped.set(line.category, [...(unmapped.get(line.category) ?? []), line.id]);
      plan.holdReasons.push(`The ledger's category "${line.category}" has no place in the household's list yet.`);
    }
    if (matched.confidence === "ambiguous") {
      plan.holdReasons.push("More than one entry could be it.");
      questions.push({
        id: `ambiguous-${line.id}`,
        lineIds: [line.id],
        text: `${line.merchant} on ${line.date} for ${money(line.homeMinor!)}: which entry is it?`,
        options: matched.candidates.map((candidate) => describeEntry(entryById.get(candidate.entryId))),
        blocking: true
      });
    }
    const other = otherOf(payer.id);
    const owed = line.owedHomeMinor!;
    const note = buildLineNote(line, config.noteMaxLength);

    if (plan.holdReasons.length || !mappedCategory) continue;
    const categoryName: string = mappedCategory;

    if (matched.entryId) {
      // An entry already records it: annotate, never rewrite bank facts.
      const entry = entryById.get(matched.entryId)!;
      plan.outcome = "matched";
      plan.statementCertified = entry.statementCertified;
      if (entry.statementCertified) plan.changes.push("Statement certified: its amount, date and wallet stay as the bank has them.");
      if (entry.categoryName !== categoryName) {
        const step = { stepId: `category-${line.id}`, kind: "set_category" as const, lineId: line.id, entryId: entry.id, before: entry.categoryName, categoryName };
        steps.push(step);
        plan.stepIds.push(step.stepId);
        plan.changes.push(`Category ${entry.categoryName ?? "none"} → ${categoryName}.`);
      }
      const nextNote = mergeNote(entry.note, note);
      if (nextNote !== (entry.note ?? "")) {
        const step = { stepId: `note-${line.id}`, kind: "set_note" as const, lineId: line.id, entryId: entry.id, before: entry.note, note: nextNote };
        steps.push(step);
        plan.stepIds.push(step.stepId);
        plan.changes.push(entry.note ? "Item lines added under its note." : "Note: the item lines.");
      }
      if (owed > 0) {
        if (entry.splitExpenseId) {
          plan.changes.push("Already on Splits: its split stays as it is.");
        } else {
          const otherShare = scaleShare(owed, line.homeMinor!, entry.amountMinor);
          const firstShare = payer.id === first.id ? entry.amountMinor - otherShare : otherShare;
          const step = { stepId: `split-${line.id}`, kind: "add_entry_to_splits" as const, lineId: line.id, entryId: entry.id, payerPersonId: payer.id, splitGroup: splitGroupRef, firstPersonShareMinor: firstShare, entryAmountMinor: entry.amountMinor };
          steps.push(step);
          plan.stepIds.push(step.stepId);
          plan.changes.push(`Add to Splits, paid by ${payer.name}: ${other.name} owes ${money(otherShare)}${otherShare !== owed ? ` (the ledger's ${money(owed)} scaled to the entry's ${money(entry.amountMinor)})` : ""}.`);
        }
      }
      if (entry.tripEventId === null) {
        tripEntries.push({ lineId: line.id, entry: { id: entry.id } });
        plan.changes.push(`Put on ${tripName}.`);
      } else if (!("id" in tripRef) || entry.tripEventId !== tripRef.id) {
        plan.changes.push("Already on another trip: left there.");
      }
      continue;
    }

    if (payer.id === first.id) {
      // Paid by the owner, no entry yet: a new entry the card's statement
      // pairs with later (a Foreign Currency Estimate).
      const accountId = walletFor(line, payer.id);
      if (!accountId) {
        const card = line.fundingCard ?? "(no card named)";
        unknownWallets.set(card, [...(unknownWallets.get(card) ?? []), line.id]);
        plan.holdReasons.push(`The wallet "${card}" is not one of ${payer.name}'s wallets by name.`);
        continue;
      }
      // One entry per bank charge: a purchase the card charged in parts
      // gets an entry for each, so each statement row pairs with its own.
      const parts = readChargeParts(line);
      const owedParts = allocateProportionally(owed, parts.map((part) => part.homeMinor));
      const accountName = snapshot.accounts.find((account) => account.id === accountId)?.name ?? accountId;
      parts.forEach((part, index) => {
        const suffix = parts.length > 1 ? `:${index + 1}` : "";
        const externalReference = `trip-ledger:${slug(tripName)}:${line.id}${suffix}`;
        const partOwed = owedParts[index];
        const step: TripLedgerStep = {
          stepId: `entry-${line.id}${suffix.replace(":", "-")}`,
          kind: "create_entry",
          lineId: line.id,
          externalReference,
          accountId,
          date: line.date!,
          description: line.merchant,
          categoryName,
          amountMinor: part.homeMinor,
          originalAmountMinor: part.foreignMinor,
          originalCurrency: part.foreignMinor !== null ? currency : null,
          note: buildEstimateNote(line, note, currency, config.noteMaxLength, part.foreignMinor, parts.length > 1 ? `Charge ${index + 1} of ${parts.length}.` : ""),
          shared: partOwed > 0,
          firstPersonShareMinor: partOwed > 0 ? part.homeMinor - partOwed : null,
          splitGroup: partOwed > 0 ? splitGroupRef : null
        };
        steps.push(step);
        plan.stepIds.push(step.stepId);
        plan.changes.push(`New entry on ${accountName}${line.paymentWallet ? ` (through ${line.paymentWallet})` : ""}: ${money(part.homeMinor)}${part.foreignMinor !== null ? `, kept as ${currency} ${(part.foreignMinor / 100).toLocaleString("en-SG")} for the statement to settle` : ""}; ${categoryName}.`);
        if (partOwed > 0) plan.changes.push(`On Splits, paid by ${payer.name}: ${other.name} owes ${money(partOwed)}.`);
        tripEntries.push({ lineId: line.id, entry: { externalReference } });
      });
      if (parts.length > 1) plan.changes.push(`The card charged it in ${parts.length} parts, so it is ${parts.length} entries; ${other.name}'s ${money(owed)} is shared between them by size.`);
      plan.outcome = "new";
      plan.changes.push(`Put on ${tripName}.`);
      continue;
    }

    // Paid by the other person with no entry of theirs yet: Splits only.
    if (owed === 0) {
      plan.outcome = "nothing";
      plan.changes.push(`Paid by ${payer.name} for ${payer.name}: nothing owed, no entry in your wallets. It reaches Entries when ${payer.name}'s card statement is imported.`);
      continue;
    }
    const step: TripLedgerStep = {
      stepId: `splits-${line.id}`,
      kind: "create_split_expense",
      lineId: line.id,
      date: line.date!,
      description: line.merchant,
      categoryName,
      payerPersonName: payer.name,
      amountMinor: line.homeMinor!,
      firstPersonShareMinor: payer.id === first.id ? line.homeMinor! - owed : owed,
      note,
      splitGroup: splitGroupRef
    };
    steps.push(step);
    plan.stepIds.push(step.stepId);
    plan.outcome = "splits-only";
    plan.changes.push(`Splits only, paid by ${payer.name} by card (waiting for the statement): ${other.name} owes ${money(owed)} of ${money(line.homeMinor!)}.`);
  }

  for (const [ledgerCategory, lineIds] of unmapped) {
    questions.push({
      id: `category-${slug(ledgerCategory)}`,
      lineIds,
      text: `Which category is the ledger's "${ledgerCategory}"? (${lineIds.length} purchase${lineIds.length === 1 ? "" : "s"})`,
      options: CATEGORY_SUGGESTIONS.filter((name) => categoryByName.has(name.toLowerCase())),
      blocking: true
    });
  }
  for (const [card, lineIds] of unknownWallets) {
    questions.push({
      id: `wallet-${slug(card)}`,
      lineIds,
      text: `Which of ${first.name}'s wallets is "${card}"? (${lineIds.length} purchase${lineIds.length === 1 ? "" : "s"})`,
      options: snapshot.accounts.filter((account) => account.active && account.ownerPersonId === first.id && account.kind === "credit_card").map((account) => account.name),
      blocking: true
    });
  }

  // One change puts every entry on the trip, after the entries exist.
  if (tripEntries.length) {
    steps.push({ stepId: "put-on-trip", kind: "put_on_trip", trip: tripRef, entries: tripEntries });
    for (const item of tripEntries) lines.find((line) => line.lineId === item.lineId)!.stepIds.push("put-on-trip");
  }

  const tripDates = datedLines.map((line) => line.date!).sort();
  const firstTripDate = startDate ?? tripDates[0];
  const entriesWithoutLine = match.entriesWithoutLine
    .map((id) => entryById.get(id)!)
    .map((entry) => ({ entryId: entry.id, date: entry.date, description: entry.description, amountMinor: entry.amountMinor }));
  const possibleBookings = firstTripDate
    ? snapshot.entries
      .filter((entry) => entry.entryType === "expense" && entry.date < firstTripDate && entry.date >= addDays(firstTripDate, -60))
      .filter((entry) => BOOKING_WORDS.test(entry.description) && entry.tripEventId === null)
      // Spent during another trip: that trip's, not this one's booking.
      .filter((entry) => !snapshot.tripEvents.some((trip) => trip.startDate && trip.endDate && entry.date >= trip.startDate && entry.date <= trip.endDate))
      .map((entry) => ({ entryId: entry.id, date: entry.date, description: entry.description, amountMinor: entry.amountMinor }))
    : [];

  return {
    kind: "trip-ledger-import",
    version: 1,
    importKey: `trip-ledger:${slug(tripName)}:${input.exportSha256.slice(0, 12)}`,
    householdId: snapshot.householdId,
    source: { exportSha256: input.exportSha256, lineCount: input.lines.length },
    dayZero: input.dayZero,
    foreignCurrency: currency,
    trip: { ...tripRef, name: tripName },
    splitGroup,
    steps,
    lines,
    questions,
    entriesWithoutLine,
    possibleBookings,
    totals: buildTotals({ lines: input.lines, plans: lines, steps, first, second, personForPayer, entryById })
  };
}

// The other person's share of an entry whose amount differs from the
// ledger's: none and all stay none and all, an even split stays even, any
// other share keeps its proportion, rounded to the cent.
export function scaleShare(owedMinor: number, ledgerMinor: number, entryMinor: number) {
  if (entryMinor === ledgerMinor) return owedMinor;
  if (owedMinor === 0) return 0;
  if (owedMinor === ledgerMinor) return entryMinor;
  if (Math.abs(owedMinor * 2 - ledgerMinor) <= 1) return Math.round(entryMinor / 2);
  return Math.round((owedMinor * entryMinor) / ledgerMinor);
}

function buildTotals(input: {
  lines: TripLedgerLine[];
  plans: TripLedgerLinePlan[];
  steps: TripLedgerStep[];
  first: { id: string; name: string };
  second: { id: string; name: string };
  personForPayer: (name: string) => { id: string; name: string } | null;
  entryById: Map<string, TripLedgerSnapshot["entries"][number]>;
}): TripLedgerTotals {
  const { first, second } = input;
  const planByLine = new Map(input.plans.map((plan) => [plan.lineId, plan]));
  const stepsByLine = new Map<string, TripLedgerStep[]>();
  for (const step of input.steps) {
    if ("lineId" in step) stepsByLine.set(step.lineId, [...(stepsByLine.get(step.lineId) ?? []), step]);
  }
  const people = [first, second];
  const spending = people.map((person) => ({ personName: person.name, ledgerPaid: 0, ledgerShare: 0, importPaidInEntries: 0, importPaidSplitsOnly: 0, importShare: 0 }));
  const at = (personId: string) => spending[personId === first.id ? 0 : 1];
  let ledgerOwed = 0;
  let importOwed = 0;
  const owedDifferences: TripLedgerTotals["owed"]["differences"] = [];
  const spendingDifferences: TripLedgerTotals["spendingDifferences"] = [];

  for (const line of input.lines) {
    const plan = planByLine.get(line.id)!;
    const payer = input.personForPayer(line.payerName);
    const known = line.homeMinor !== null && line.owedHomeMinor !== null && payer;
    // The ledger's own figures, for every line it has numbers for (what was
    // paid needs the amount; who owes what needs the share too).
    let ledgerLineOwed = 0;
    let ledgerPaid = 0;
    if (payer && line.homeMinor !== null) {
      ledgerPaid = line.homeMinor;
      at(payer.id).ledgerPaid += line.homeMinor;
    }
    if (known) {
      const sign = payer!.id === first.id ? -1 : 1;
      ledgerLineOwed = sign * line.owedHomeMinor!;
      ledgerOwed += ledgerLineOwed;
      at(payer!.id).ledgerShare += line.homeMinor! - line.owedHomeMinor!;
      at(payer!.id === first.id ? second.id : first.id).ledgerShare += line.owedHomeMinor!;
    }

    // What the import would record for it.
    let importLineOwed = 0;
    let importPaid = 0;
    let firstShare: number | null = null;
    let total = 0;
    let payerId: string | null = null;
    for (const step of stepsByLine.get(line.id) ?? []) {
      if (step.kind === "create_entry") {
        // A purchase charged in parts has a create step per part.
        importPaid += step.amountMinor;
        at(first.id).importPaidInEntries += step.amountMinor;
        payerId = first.id;
        total += step.amountMinor;
        firstShare = (firstShare ?? 0) + (step.shared ? step.firstPersonShareMinor! : step.amountMinor);
      } else if (step.kind === "add_entry_to_splits") {
        payerId = step.payerPersonId;
        total = step.entryAmountMinor;
        firstShare = step.firstPersonShareMinor;
      } else if (step.kind === "create_split_expense") {
        payerId = input.personForPayer(step.payerPersonName)!.id;
        importPaid = step.amountMinor;
        at(payerId).importPaidSplitsOnly += step.amountMinor;
        total = step.amountMinor;
        firstShare = step.firstPersonShareMinor;
      }
    }
    if (plan.outcome === "matched" && plan.entryId) {
      const entry = input.entryById.get(plan.entryId)!;
      importPaid = entry.amountMinor;
      const owner = entry.accountOwnerPersonId ?? payer?.id ?? first.id;
      at(owner).importPaidInEntries += entry.amountMinor;
      if (!payerId) {
        payerId = owner;
        total = entry.amountMinor;
        firstShare = owner === first.id ? entry.amountMinor : 0;
      }
    }
    if (payerId && firstShare !== null) {
      at(first.id).importShare += firstShare;
      at(second.id).importShare += total - firstShare;
      // The first person owes the second what the second paid for them.
      importLineOwed = payerId === first.id ? -(total - firstShare) : firstShare;
      importOwed += importLineOwed;
    }

    if (importLineOwed !== ledgerLineOwed) {
      owedDifferences.push({ lineId: line.id, merchant: line.merchant, ledger: ledgerLineOwed, afterImport: importLineOwed, why: differenceReason(plan, line) });
    }
    if (importPaid !== ledgerPaid) {
      spendingDifferences.push({ lineId: line.id, merchant: line.merchant, payerName: line.payerName, ledgerPaid, importPaid, why: differenceReason(plan, line) });
    }
  }
  return {
    currency: "SGD",
    firstPersonName: first.name,
    secondPersonName: second.name,
    owed: { ledger: ledgerOwed, afterImport: importOwed, differences: owedDifferences },
    spending,
    spendingDifferences
  };
}

function differenceReason(plan: TripLedgerLinePlan, line: TripLedgerLine) {
  if (plan.outcome === "held") return `Held: ${plan.holdReasons.join(" ")}`;
  if (plan.outcome === "skipped") return "Left out, as asked.";
  if (plan.outcome === "matched") return "The entry's amount differs from the ledger's figure (the bank's amount is kept).";
  if (plan.outcome === "nothing") return `Paid by ${line.payerName} for ${line.payerName}, nothing owed: not recorded now; it arrives with ${line.payerName}'s own card statement.`;
  if (line.homeMinor === null) return "The ledger has no amount.";
  return "Recorded differently from the ledger.";
}

// The item lines, bounded, with the receipt time when written.
export function buildLineNote(line: TripLedgerLine, maxLength: number) {
  const body = [line.time ? `${line.time} local time` : "", line.itemsText].filter(Boolean).join(" · ").replace(/\s+/g, " ").trim();
  return truncate(body, maxLength);
}

function buildEstimateNote(line: TripLedgerLine, itemNote: string, currency: string | null, maxLength: number, foreignMinor: number | null, partText: string) {
  const paid = foreignMinor !== null && currency ? `Paid ${currency} ${(foreignMinor / 100).toLocaleString("en-SG")}.` : "";
  const source = line.status === "paid"
    ? "SGD amount as the card's activity showed it; the statement sets the final amount."
    : line.status === "pending"
      ? "SGD amount as the card's pending charge showed it; the statement sets the final amount."
      : "SGD amount estimated; the statement sets the final amount.";
  return truncate([itemNote, [partText, paid, source].filter(Boolean).join(" ")].filter(Boolean).join("\n"), maxLength + 200);
}

// The bank charges a purchase was taken in, when the ledger's notes list
// them and they add up to it exactly ("¥20,000 / S$166.00 + ¥10,000 /
// S$83.00 = ¥30,000 / S$249.00"). Otherwise one charge: the purchase.
export function readChargeParts(line: TripLedgerLine): { foreignMinor: number | null; homeMinor: number }[] {
  const whole = [{ foreignMinor: line.foreignMinor, homeMinor: line.homeMinor ?? 0 }];
  const sum = /((?:(?:¥|JPY ?)[\d,]+ \/ S\$[\d,.]+\s*\+\s*)+(?:¥|JPY ?)[\d,]+ \/ S\$[\d,.]+)\s*=/.exec(line.notes);
  if (!sum) return whole;
  const parts = [...sum[1].matchAll(/(?:¥|JPY ?)([\d,]+) \/ S\$([\d,.]+)/g)].map((match) => ({
    foreignMinor: Number(match[1].replace(/,/g, "")) * 100,
    homeMinor: Math.round(Number(match[2].replace(/,/g, "")) * 100)
  }));
  const foreignTotal = parts.reduce((total, part) => total + part.foreignMinor, 0);
  const homeTotal = parts.reduce((total, part) => total + part.homeMinor, 0);
  if (parts.length < 2 || homeTotal !== line.homeMinor || (line.foreignMinor !== null && foreignTotal !== line.foreignMinor)) return whole;
  return parts;
}

// Shares `totalMinor` across `weights` in proportion, to the cent, adding
// up exactly (largest remainder; ties to the earlier part).
export function allocateProportionally(totalMinor: number, weights: number[]) {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weights.length === 1 || weightTotal === 0) return weights.map((_, index) => (index === 0 ? totalMinor : 0));
  const exact = weights.map((weight) => (totalMinor * weight) / weightTotal);
  const floors = exact.map(Math.floor);
  let left = totalMinor - floors.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return floors;
}

// Adds the item lines under an entry's own note once; a second run adds
// nothing.
export function mergeNote(existing: string | null, addition: string) {
  const current = (existing ?? "").trim();
  if (!addition || current.includes(addition)) return existing ?? "";
  return current ? `${current}\n${addition}` : addition;
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function walletWords(value: string) {
  return value
    .toLowerCase()
    .replace(/citibank/g, "citi")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !["card", "credit", "debit", "bank", "contactless"].includes(word));
}

function describeEntry(entry: TripLedgerSnapshot["entries"][number] | undefined) {
  return entry ? `${entry.date} ${entry.description} ${money(entry.amountMinor)} (${entry.id})` : "an entry";
}

const rank = (role: string) => (role === "owner" ? 0 : role === "partner" ? 1 : 2);
const sameName = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();
export const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trip";
export const money = (minor: number) => `${minor < 0 ? "-" : ""}S$${(Math.abs(minor) / 100).toFixed(2)}`;

// The canonical text a plan's hash covers: keys sorted, so the same plan
// always hashes the same.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export async function hashTripLedgerPlan(plan: TripLedgerPlan) {
  const bytes = new TextEncoder().encode(canonicalJson(plan));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
