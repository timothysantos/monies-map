// The Ledger check-up report (GET /api/ledger-checkup): the shared loader, the
// stored dismissals and the runner, put together. Read-only; it runs only when
// the person opens the check-up (no schedule, no cache, no AI).
import { loadCheckupDismissals } from "../app-repository-ledger-checkup";
import { findClearTransferPairs } from "../ledger-checkup/clear-transfer-pairs";
import { loadCheckupFacts } from "../ledger-checkup/loader";
import { runLedgerCheckup, type CheckupReport } from "../ledger-checkup/runner";
import { todayInAppTimeZone } from "../../lib/app-calendar";

export interface LedgerCheckupDto extends CheckupReport {
  ok: true;
  generatedAt: string;
  // How many unlinked transfer pairs are clear (ledger-checkup/clear-transfer-
  // pairs.ts), in the person's view: the count "Link these N clear pairs" shows.
  clearTransferPairCount: number;
}

export function readLedgerCheckupView(value: string | null): string | null {
  if (value === null || value === "") {
    return "household";
  }
  return /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null;
}

export async function buildLedgerCheckupDto(
  db: D1Database,
  options: { view?: string; includeDismissed?: boolean; today?: string } = {}
): Promise<LedgerCheckupDto> {
  const [facts, dismissals] = await Promise.all([
    loadCheckupFacts(db, options.today ?? todayInAppTimeZone()),
    loadCheckupDismissals(db)
  ]);
  const report = runLedgerCheckup(facts, dismissals, { view: options.view, includeDismissed: options.includeDismissed });
  // Read from the facts already loaded: no further statement.
  const view = options.view && options.view !== "household" ? options.view : null;
  const clearTransferPairCount = findClearTransferPairs(facts.transfers, facts.context, { dismissals })
    .filter((pair) => !view || pair.personIds.length === 0 || pair.personIds.includes(view)).length;
  return { ok: true, generatedAt: new Date().toISOString(), ...report, clearTransferPairCount };
}
