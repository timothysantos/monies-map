// Money tones: the one rule for colouring money by its direction or outcome
// (design.md, "Money colour"; AGENTS.md, "Frontend guidance"). Every page asks
// these functions and renders the answer with the shared .money-<tone>
// classes, so a colour means the same thing everywhere:
// - in: money in or a good outcome (income, a refund, received, owed to you,
//   under plan, savings made, a matched statement) -> mint
// - short: a deficit, over plan, money short, a debt you owe, a statement
//   that is off -> rose
// - plan: an intention (planned income, planned spend, a savings target) -> sky
// - caution: something needs a check -> butter
// - out: an ordinary outflow (an expense in a list); spending is not bad by
//   itself, so it keeps the neutral ink and its minus sign
// - neutral: transfers, zero, counts
// Hiding money totals turns every money tone neutral in the stylesheet, so a
// hidden value never shows its sign through colour.
import type { MoneyTone, ReconciliationStatus } from "../types/dto";

/** Money that can go either way (net, realized savings, a split balance). */
export function signTone(amountMinor: number): MoneyTone {
  if (amountMinor > 0) return "in";
  if (amountMinor < 0) return "short";
  return "neutral";
}

/** A signed flow in a list (a day's net, a statement row): in, or plain out. */
export function flowTone(signedAmountMinor: number): MoneyTone {
  if (signedAmountMinor > 0) return "in";
  if (signedAmountMinor < 0) return "out";
  return "neutral";
}

/**
 * Room left against a plan (remaining budget, spend gap, variance). Exactly
 * on plan, or a fully allocated budget, is a met plan, so zero is "in".
 */
export function headroomTone(headroomMinor: number): MoneyTone {
  return headroomMinor >= 0 ? "in" : "short";
}

/** Spending is not bad for being spending: only going over the plan is. */
export function spendTone(actualMinor: number, plannedMinor: number): MoneyTone {
  return actualMinor > plannedMinor ? "short" : "neutral";
}

/** Income against its plan: received in full (or more) is "in", less is short. */
export function incomeVarianceTone(plannedMinor: number, actualMinor: number): MoneyTone {
  return headroomTone(actualMinor - plannedMinor);
}

/**
 * One entry's amount as a list shows it, signed by direction (income and
 * transfers in positive). Transfers move money between wallets, so they stay
 * neutral; a refund (a negative expense) is money in.
 */
export function entryAmountTone(entryType: string, signedAmountMinor: number): MoneyTone {
  return entryType === "transfer" ? "neutral" : flowTone(signedAmountMinor);
}

/**
 * The Entries totals strip has no plan to compare with: spend and outflow are
 * plain outflows, transfers are neutral, income and the difference carry
 * their direction (a negative difference is a deficit).
 */
export function entryTotalsTones({ incomeMinor, netMinor }: { incomeMinor: number; netMinor: number }) {
  return {
    spend: "out",
    income: flowTone(incomeMinor),
    difference: signTone(netMinor),
    transfers: "neutral",
    outflow: "out"
  } satisfies Record<string, MoneyTone>;
}

/** A difference between the ledger and a bank statement: zero matches. */
export function statementDifferenceTone(deltaMinor: number): MoneyTone {
  return deltaMinor === 0 ? "in" : "short";
}

/**
 * A split line from the viewer's side. `actingPersonId` is the expense's payer
 * or the settle-up's sender: lending is money owed to you, borrowing a debt,
 * receiving a settle-up money in, and paying one a plain outflow.
 */
export function splitViewerTone(kind: "expense" | "settlement", viewId: string, actingPersonId: string | undefined): MoneyTone {
  if (viewId === "household") return "neutral";
  const viewerActed = actingPersonId === viewId;
  if (kind === "expense") return viewerActed ? "in" : "short";
  return viewerActed ? "out" : "in";
}

/** An account's statement health. */
export function reconciliationTone(status: ReconciliationStatus | undefined): MoneyTone {
  if (status === "matched") return "in";
  if (status === "mismatch") return "short";
  if (status === "needs_checkpoint") return "caution";
  return "neutral";
}
