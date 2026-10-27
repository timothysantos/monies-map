// The clear transfer pairs behind "Link these N clear pairs" on Check my books
// (GET /api/ledger-checkup/clear-pairs): the check-up's own transfer read, the
// stored dismissals and the pure rule in ledger-checkup/clear-transfer-pairs.ts,
// put together. Read-only. The same function answers the command at confirm
// time, so the pairs the person confirms are judged on the ledger as it is then.
import { loadCheckupDismissals } from "../app-repository-ledger-checkup";
import { CLEAR_PAIR_REQUEST_CAP, findClearTransferPairs, type ClearTransferPair } from "../ledger-checkup/clear-transfer-pairs";
import { loadTransferPairFacts } from "../ledger-checkup/loader";
import type { CheckupContext } from "../ledger-checkup/types";
import { todayInAppTimeZone } from "../../lib/app-calendar";

// How many pairs the dialog lists by name; the rest are counted.
export const CLEAR_PAIR_PREVIEW_ROWS = 10;

export interface ClearPairsPreviewDto {
  ok: true;
  // Every clear pair, and the cap one request may link.
  total: number;
  cap: number;
  // The first `cap` of them (oldest first): what one press of the button links.
  linkCount: number;
  remaining: number;
  firstMonth: string | null;
  lastMonth: string | null;
  pairs: Array<{ fromEntryId: string; toEntryId: string }>;
  rows: Array<{
    fromEntryId: string;
    toEntryId: string;
    date: string;
    amountMinor: number;
    currency: string;
    fromAccountName: string;
    toAccountName: string;
  }>;
}

export async function loadClearTransferPairs(db: D1Database, today = todayInAppTimeZone()): Promise<{ pairs: ClearTransferPair[]; context: CheckupContext }> {
  const [{ facts, context }, dismissals] = await Promise.all([loadTransferPairFacts(db, today), loadCheckupDismissals(db)]);
  return { pairs: findClearTransferPairs(facts, context, { dismissals }), context };
}

export async function buildClearPairsPreviewDto(db: D1Database, options: { view?: string | null; today?: string } = {}): Promise<ClearPairsPreviewDto> {
  const { pairs: all, context } = await loadClearTransferPairs(db, options.today);
  const view = options.view && options.view !== "household" ? options.view : null;
  const pairs = all.filter((pair) => !view || pair.personIds.length === 0 || pair.personIds.includes(view));
  const linkable = pairs.slice(0, CLEAR_PAIR_REQUEST_CAP);
  const name = (accountId: string) => context.accounts.get(accountId)?.name ?? "an account";
  return {
    ok: true,
    total: pairs.length,
    cap: CLEAR_PAIR_REQUEST_CAP,
    linkCount: linkable.length,
    remaining: pairs.length - linkable.length,
    firstMonth: linkable.length ? linkable[0].date.slice(0, 7) : null,
    lastMonth: linkable.length ? linkable[linkable.length - 1].date.slice(0, 7) : null,
    pairs: linkable.map((pair) => ({ fromEntryId: pair.fromEntryId, toEntryId: pair.toEntryId })),
    rows: linkable.slice(0, CLEAR_PAIR_PREVIEW_ROWS).map((pair) => ({
      fromEntryId: pair.fromEntryId,
      toEntryId: pair.toEntryId,
      date: pair.date,
      amountMinor: pair.amountMinor,
      currency: pair.currency,
      fromAccountName: name(pair.fromAccountId),
      toAccountName: name(pair.toAccountId)
    }))
  };
}
