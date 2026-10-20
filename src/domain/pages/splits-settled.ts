// The settled rows the Splits page does not send (pages/splits-page.ts),
// read on demand and built exactly as the page builds its own rows
// (buildSplitActivityForView), so a settled row reads, locks and undoes the
// same way it did when it came with the page.
//
// - GET /api/splits/settled-rows?view&checkpoint&group: one settlement's
//   records in one group, when its collapsed section is opened.
// - GET /api/splits/settled-rows?view&record: the section that holds a split
//   expense (the `editing_split_expense` deep link), with its rows.
// - GET /api/splits/settled-search?view&group&q: the group's settled records
//   that match a Splits search, with the page's own search rule
//   (search-text.ts), so a search still finds a settled record.
//
// Every read is household-scoped, filtered to the view and bounded
// (SPLIT_SETTLED_LOAD_LIMIT rows; `truncated` says when a section is
// larger).
import {
  loadSplitExpenses,
  loadSplitSettlements,
  SPLIT_SETTLED_LOAD_LIMIT,
  type SplitRecordScope
} from "../app-repository-splits";
import { buildSplitActivityForView } from "../splits-projection";
import { findSettledSectionOfExpense, loadActiveCheckpointMembership } from "../split-settled-history";
import { splitActivityMatchesSearch, searchTokens } from "../search-text";
import { loadRoutePageContext } from "../route-context";
import type { SplitActivityDto, SplitSettlementCheckpointDto } from "../../types/dto";

// A search shows at most this many settled matches (a search is narrowed by
// typing more).
export const SPLIT_SETTLED_SEARCH_LIMIT = 500;

async function loadScopedActivity(db: D1Database, selectedViewId: string, scope: SplitRecordScope) {
  const { viewId, personNameById } = await loadRoutePageContext(db, selectedViewId);
  const [expenses, settlements, checkpoints] = await Promise.all([
    loadSplitExpenses(db, undefined, scope),
    loadSplitSettlements(db, undefined, scope),
    loadActiveCheckpointMembership(db)
  ]);
  const items = buildSplitActivityForView(viewId, expenses, settlements, checkpoints as SplitSettlementCheckpointDto[], personNameById)
    // A closed batch's records belong to the archive, never to a section.
    .filter((item) => !item.isArchived && item.settlementCheckpointId);
  return {
    viewId,
    items,
    truncated: expenses.length >= SPLIT_SETTLED_LOAD_LIMIT || settlements.length >= SPLIT_SETTLED_LOAD_LIMIT
  };
}

export interface SettledRowsDto {
  viewId: string;
  checkpointId: string;
  groupId: string;
  items: SplitActivityDto[];
  truncated: boolean;
}

export async function buildSettledRowsDto(
  db: D1Database,
  input: { viewId: string; checkpointId?: string; groupId?: string; recordId?: string }
): Promise<SettledRowsDto | null> {
  let checkpointId = input.checkpointId ?? "";
  let groupId = input.groupId ?? "";
  if (input.recordId) {
    const section = await findSettledSectionOfExpense(db, input.recordId);
    if (!section) {
      return null;
    }
    checkpointId = section.checkpoint_id;
    groupId = section.group_id;
  }
  if (!checkpointId || !groupId) {
    return null;
  }
  const { viewId, items, truncated } = await loadScopedActivity(db, input.viewId, { kind: "settled-section", checkpointId, groupId });
  return { viewId, checkpointId, groupId, items: items.filter((item) => item.settlementCheckpointId === checkpointId), truncated };
}

export interface SettledSearchDto {
  viewId: string;
  groupId: string;
  query: string;
  items: SplitActivityDto[];
  truncated: boolean;
}

export async function buildSettledSearchDto(
  db: D1Database,
  input: { viewId: string; groupId: string; query: string }
): Promise<SettledSearchDto> {
  if (!searchTokens(input.query).length) {
    return { viewId: input.viewId, groupId: input.groupId, query: input.query, items: [], truncated: false };
  }
  const { viewId, items, truncated } = await loadScopedActivity(db, input.viewId, { kind: "settled-in-group", groupId: input.groupId });
  const matches = items.filter((item) => splitActivityMatchesSearch(item, input.query));
  return {
    viewId,
    groupId: input.groupId,
    query: input.query,
    items: matches.slice(0, SPLIT_SETTLED_SEARCH_LIMIT),
    truncated: truncated || matches.length > SPLIT_SETTLED_SEARCH_LIMIT
  };
}
