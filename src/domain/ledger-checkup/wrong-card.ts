// Detector 1: wrong-card Apple Pay duplicates over the whole ledger.
//
// The rules are the import review's own (`assessWrongCardDuplicates`,
// wrong-card-apple-pay-duplicate.ts), unchanged. Outside an import there is no
// file being imported, so the evidence that the card's own file should have
// listed the entry is an earlier completed import of that card whose rows span
// the entry's day and which was loaded at least the card's posting lag after
// it. HIGH is "Needs fixing"; the rule's MEDIUM (a soft gate failed) is only a
// note; LOW is silent. The fix lives in the Imports review today, so this
// finding links there and offers no removal.
import { assessWrongCardDuplicates, type ApplePayEntryFact, type WrongCardInput } from "../wrong-card-apple-pay-duplicate";
import { IMPORTS_PATH, accountLabel, accountPeople, clip, finding, money, shortDate, shortId } from "./helpers";
import type { CheckupContext, DetectedFinding } from "./types";

export interface WrongCardFacts {
  input: WrongCardInput | null;
}

export function detectWrongCardDuplicates(facts: WrongCardFacts, context: CheckupContext): DetectedFinding[] {
  if (!facts.input || !facts.input.entries.length) {
    return [];
  }
  const entries = new Map<string, ApplePayEntryFact>(facts.input.entries.map((entry) => [entry.id, entry]));
  const findings: DetectedFinding[] = [];
  for (const assessment of assessWrongCardDuplicates(facts.input)) {
    const entry = entries.get(assessment.entryId);
    const twin = assessment.twin;
    // Without a file to import, "earlier import" is the only proof the card's
    // own file should have listed the entry; anything else is silent.
    if (!entry || !twin || assessment.confidence === "low" || assessment.coverage?.kind !== "earlier_import") {
      continue;
    }
    const tier = assessment.confidence === "high" ? "high" : "note";
    const cardA = accountLabel(context, entry.accountId);
    const cardB = accountLabel(context, twin.accountId);
    const amount = money(entry.amountMinor, entry.currency);
    const loadedOn = assessment.coverage.importedAt ? shortDate(assessment.coverage.importedAt.slice(0, 10), context.today) : "an earlier day";
    findings.push(finding({
      kind: "wrong_card_duplicate",
      subject: entry.id,
      tier,
      title: tier === "high" ? "Counted twice on two cards" : "Might be counted twice on two cards",
      summary: tier === "high"
        ? `The ${amount} ${clip(entry.description, 40)} on ${cardA} is the same purchase as ${clip(twin.description, 40)} on ${cardB}, so ${cardA} shows ${amount} too much. ${cardA}'s own bank file, loaded on ${loadedOn}, does not list it.`
        : `The ${amount} ${clip(entry.description, 40)} on ${cardA} looks like the purchase ${clip(twin.description, 40)} on ${cardB}, but one detail is not certain, so it may be counted twice.`,
      evidence: [
        { role: "entry", label: clip(entry.description), shortId: shortId(entry.id), date: entry.date, amountMinor: entry.amountMinor, currency: entry.currency, accountName: cardA, note: `saved from Apple Pay, still waiting for ${cardA}'s own bank record` },
        { role: "entry", label: clip(twin.description), shortId: shortId(twin.id), date: twin.date, amountMinor: twin.amountMinor, currency: entry.currency, accountName: cardB, note: `the bank's record of the same purchase on ${cardB}` },
        { role: "fact", label: `${cardA}'s bank file loaded on ${loadedOn} covers ${shortDate(entry.date, context.today)} and does not list it` }
      ],
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      occurredOn: entry.date,
      personIds: [...accountPeople(context.accounts.get(entry.accountId)), ...accountPeople(context.accounts.get(twin.accountId)), ...(entry.ownerPersonId ? [entry.ownerPersonId] : [])],
      fix: { label: `Load ${cardA}'s bank file again in Imports`, path: IMPORTS_PATH },
      facts: [entry.id, twin.id, entry.amountMinor, entry.date, twin.date, assessment.confidence]
    }));
  }
  return findings;
}
