// Detector 5: a foreign-currency estimate the card never confirmed.
//
// An Apple Pay purchase in another currency is saved as an estimate in the
// card's own currency (DOMAIN.md "Foreign Currency Estimate") and stays
// provisional until a bank row of that card pairs with it. The loader reads
// estimates no bank row ever touched (no import, not certified, no split or
// plan link) older than the card's posting lag plus 14 days. Here:
//
// - `high`: a completed file or statement of the same card covers the day (the
//   bank listed that day and nothing paired with the estimate), so the card
//   either never charged it or charged a different amount that came in as its
//   own row, counting the purchase twice;
// - `check`: no file of that card covers the day yet (the file may simply not
//   have been loaded).
import { IMPORTS_PATH, accountLabel, accountPeople, clip, daysBetween, entryLink, finding, money, shortDate, shortId } from "./helpers";
import type { CheckupContext, DetectedFinding } from "./types";

export const STALE_ESTIMATE_EXTRA_DAYS = 14;

export interface EstimateFact {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amountMinor: number;
  currency: string;
  originalAmountMinor: number;
  originalCurrency: string;
  ownerPersonId: string | null;
}

// The days a completed file or statement of a card covers, and the day it was
// loaded (or, for a statement, closed).
export interface EstimateCoverageFact {
  accountId: string;
  first: string;
  last: string;
  referenceDate: string;
}

export interface StaleEstimateFacts {
  estimates: EstimateFact[];
  // The card's usual days from purchase to bank record (3 to 7).
  postingLagDays: Record<string, number>;
  coverages: EstimateCoverageFact[];
}

export function detectStaleEstimates(facts: StaleEstimateFacts, context: CheckupContext): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  for (const estimate of facts.estimates) {
    const lag = facts.postingLagDays[estimate.accountId] ?? 3;
    const age = daysBetween(estimate.date, context.today);
    if (age < lag + STALE_ESTIMATE_EXTRA_DAYS) {
      continue;
    }
    const covering = facts.coverages.find((coverage) => (
      coverage.accountId === estimate.accountId
      && coverage.first <= estimate.date
      && estimate.date <= coverage.last
      && daysBetween(estimate.date, coverage.referenceDate) >= lag
    ));
    const card = accountLabel(context, estimate.accountId);
    const original = money(estimate.originalAmountMinor, estimate.originalCurrency);
    const estimated = money(estimate.amountMinor, estimate.currency);
    const tier = covering ? "high" : "check";
    findings.push(finding({
      kind: "stale_estimate",
      subject: estimate.id,
      tier,
      title: tier === "high" ? "A guessed amount was never confirmed" : "A guessed amount is still waiting",
      summary: tier === "high"
        ? `${original} at ${clip(estimate.description, 40)} on ${shortDate(estimate.date, context.today)} is still only an estimate of ${estimated}. ${card}'s own bank record covers that day and nothing matches it, so it may never have been charged, or it was charged a different amount that is counted as a second purchase.`
        : `${original} at ${clip(estimate.description, 40)} on ${shortDate(estimate.date, context.today)} is still only an estimate of ${estimated}, ${age} days later. ${card}'s bank file for that day has not been added yet.`,
      evidence: [
        { role: "entry", label: clip(estimate.description), shortId: shortId(estimate.id), date: estimate.date, amountMinor: estimate.amountMinor, currency: estimate.currency, accountName: card, note: `paid ${original}; the ${estimated} is only an estimate` },
        covering
          ? { role: "fact", label: `${card}'s bank record loaded on ${shortDate(covering.referenceDate, context.today)} covers ${shortDate(estimate.date, context.today)} and does not match it` }
          : { role: "fact", label: `No bank record of ${card} covers ${shortDate(estimate.date, context.today)} yet` }
      ],
      amountMinor: estimate.amountMinor,
      currency: estimate.currency,
      occurredOn: estimate.date,
      personIds: [...accountPeople(context.accounts.get(estimate.accountId)), ...(estimate.ownerPersonId ? [estimate.ownerPersonId] : [])],
      fix: tier === "high" ? entryLink(estimate.id, estimate.date, "Open the entry") : { label: `Add ${card}'s bank file in Imports`, path: IMPORTS_PATH },
      facts: [estimate.id, estimate.amountMinor, estimate.date, covering ? covering.referenceDate : null]
    }));
  }
  return findings;
}
