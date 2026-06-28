import type { SummaryAccountPillDto } from "../../types/dto";
import { loadAccounts } from "../app-repository";
import { accountsForSummary } from "../app-shell";
import { loadRoutePageContext } from "../route-context";

// Summary account pills are a separate slice query so note edits and range
// changes do not force the wallet metadata to reload with the main page DTO.
export async function buildSummaryAccountPillsDto(
  db: D1Database,
  selectedViewId = "household"
): Promise<{ viewId: string; label: string; accountPills: SummaryAccountPillDto[] }> {
  const { viewId, label } = await loadRoutePageContext(db, selectedViewId);
  const accounts = await loadAccounts(db);

  return {
    viewId,
    label,
    accountPills: accountsForSummary(viewId, accounts)
  };
}
