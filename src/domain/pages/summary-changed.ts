import { todayInAppTimeZone } from "../../lib/app-calendar";
import { loadRoutePageContext } from "../route-context";
import { effectiveScopeForView } from "../person-view-scope";
import { buildSummaryChanged, type SummaryChangedDto } from "../summary-changed";
import { lastDayOfMonth } from "../month-wrap-up";
import { loadUsualEntries } from "./ask-usual";
import type { PersonScope } from "../../types/dto";

// GET /api/summary-changed (DOMAIN.md "What Changed Card"): Summary's "What
// changed this month" card for one view and scope. Read-only, no AI, not
// part of any first-screen payload: the card asks for it once the top
// summary is usable. It reads the view's entries of this month and the 6
// before in the one date-window read Ask's "What changed?" uses
// (loadUsualEntries: two parallel statements, never a page build per
// month), so the card and Ask can never disagree.
//
// `month` (the Month page's wrap-up "See all", DOMAIN.md "Month Wrap-up")
// asks for a month that has ended: the same card read up to its last day,
// so the whole month against the month before. A month after this one has
// nothing to compare.
export async function buildSummaryChangedDto(
  db: D1Database,
  selectedViewId = "household",
  selectedScope: PersonScope = "direct_plus_shared",
  today = todayInAppTimeZone(),
  month = ""
): Promise<{ viewId: string; scope: PersonScope; changed: SummaryChangedDto | null }> {
  const { viewId } = await loadRoutePageContext(db, selectedViewId);
  const scope = effectiveScopeForView(viewId, selectedScope);
  const asked = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7);
  if (asked > today.slice(0, 7)) {
    return { viewId, scope, changed: null };
  }
  const readTo = asked < today.slice(0, 7) ? lastDayOfMonth(asked) : today;
  const entries = await loadUsualEntries(db, viewId, scope, asked);
  return { viewId, scope, changed: buildSummaryChanged({ viewId, scope, today: readTo, entries }) };
}
