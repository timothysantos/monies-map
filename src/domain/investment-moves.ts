// Money moved into and out of investment accounts (DOMAIN.md "Money job",
// owner decision d34): a transfer into an account of kind `investment` is
// invested, not kept, and a transfer out of one back to a cash account is
// taken out of investments. The money jobs' split (splitMoneyUse,
// money-jobs.ts) nets these against the money filed under the Investments
// category. The Month and Summary projections send the two
// totals (`investmentMoves`), Ask reads the same entries for its lines, and
// the Entries filter entry_invest_moves lists them (entry-filtering.js).
//
// The investment account's own entry decides, so a linked pair counts once:
// - a transfer in on an investment account is money moved in, and a
//   transfer out on one is money taken out;
// - a pair between two investment accounts moves nothing (both sides are
//   skipped, linked or not, when the other side is known);
// - a transfer in whose linked other side is an expense filed under
//   Investments is already counted as that expense, so it adds nothing;
// - the cash side of a pair, and transfers between cash accounts, stay
//   neutral.
// An entry's other side is known only when the pair is linked and both
// entries are in the loaded range (`linkedTransfer`, loadEntriesForDateRange).

import { isInvestmentsCategoryName } from "./money-jobs";
import type { EntryDto, InvestmentMovesDto } from "../types/dto";

type MoveEntry = Pick<EntryDto, "id" | "accountId" | "entryType" | "transferDirection" | "amountMinor" | "categoryName" | "linkedTransfer">;

export interface InvestmentMoveEntries<T extends MoveEntry> {
  into: T[];
  outOf: T[];
}

/**
 * The entries of `visibleEntries` (the view's own, at the view's amounts)
 * that move money into or out of investments. `allEntries` is every loaded
 * entry, where a linked entry's other side is looked up (a person view may
 * not show it).
 */
export function findInvestmentMoves<T extends MoveEntry>(
  visibleEntries: T[],
  allEntries: MoveEntry[],
  investmentAccountIds: ReadonlySet<string>
): InvestmentMoveEntries<T> {
  const moves: InvestmentMoveEntries<T> = { into: [], outOf: [] };
  if (!investmentAccountIds.size) {
    return moves;
  }
  const byId = new Map(allEntries.map((entry) => [entry.id, entry]));
  const isInvestmentAccount = (accountId?: string) => Boolean(accountId) && investmentAccountIds.has(accountId as string);
  for (const entry of visibleEntries) {
    if (entry.entryType !== "transfer" || !isInvestmentAccount(entry.accountId) || !(entry.amountMinor > 0)) {
      continue;
    }
    const otherSide = entry.linkedTransfer ? byId.get(entry.linkedTransfer.transactionId) : undefined;
    if (otherSide && isInvestmentAccount(otherSide.accountId)) {
      continue;
    }
    if (entry.transferDirection === "in") {
      if (otherSide?.entryType === "expense" && isInvestmentsCategoryName(otherSide.categoryName)) {
        continue;
      }
      moves.into.push(entry);
    } else if (entry.transferDirection === "out") {
      moves.outOf.push(entry);
    }
  }
  return moves;
}

const total = (entries: MoveEntry[]) => entries.reduce((sum, entry) => sum + entry.amountMinor, 0);

/** The two totals, or undefined when nothing moved (the page DTO leaves the field out). */
export function sumInvestmentMoves(
  visibleEntries: MoveEntry[],
  allEntries: MoveEntry[],
  investmentAccountIds: ReadonlySet<string>
): InvestmentMovesDto | undefined {
  const moves = findInvestmentMoves(visibleEntries, allEntries, investmentAccountIds);
  const intoMinor = total(moves.into);
  const outOfMinor = total(moves.outOf);
  return intoMinor || outOfMinor ? { intoMinor, outOfMinor } : undefined;
}
