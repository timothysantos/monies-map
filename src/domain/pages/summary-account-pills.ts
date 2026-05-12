import type { SummaryAccountPillDto } from "../../types/dto";
import { accountsForSummary } from "../app-shell";
import { loadRoutePageContext } from "../route-context";

// Summary account pills are a separate slice query so note edits and range
// changes do not force the wallet metadata to reload with the main page DTO.
export async function buildSummaryAccountPillsDto(
  db: D1Database,
  selectedViewId = "household"
): Promise<{ viewId: string; label: string; accountPills: SummaryAccountPillDto[] }> {
  const { accounts, viewId, label } = await loadRoutePageContext(db, selectedViewId);

  return {
    viewId,
    label,
    accountPills: accountsForSummary(viewId, accounts)
  };
}
