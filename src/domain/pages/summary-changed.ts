import { todayInAppTimeZone } from "../../lib/app-calendar";
import { loadRoutePageContext } from "../route-context";
import { effectiveScopeForView } from "../person-view-scope";
import { buildSummaryChanged, type SummaryChangedDto } from "../summary-changed";
import { loadUsualEntries } from "./ask-usual";
import type { PersonScope } from "../../types/dto";

// GET /api/summary-changed (DOMAIN.md "What Changed Card"): Summary's "What
// changed this month" card for one view and scope. Read-only, no AI, not
// part of any first-screen payload: the card asks for it once the top
// summary is usable. It reads the view's entries of this month and the 6
// before in the one date-window read Ask's "What changed?" uses
// (loadUsualEntries: two parallel statements, never a page build per
// month), so the card and Ask can never disagree.
export async function buildSummaryChangedDto(
  db: D1Database,
  selectedViewId = "household",
  selectedScope: PersonScope = "direct_plus_shared",
  today = todayInAppTimeZone()
): Promise<{ viewId: string; scope: PersonScope; changed: SummaryChangedDto | null }> {
  const { viewId } = await loadRoutePageContext(db, selectedViewId);
  const scope = effectiveScopeForView(viewId, selectedScope);
  const entries = await loadUsualEntries(db, viewId, scope, today.slice(0, 7));
  return { viewId, scope, changed: buildSummaryChanged({ viewId, scope, today, entries }) };
}
