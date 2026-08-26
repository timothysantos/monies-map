export interface SplitGroupBalance {
  groupId: string;
  amountMinor: number;
}

export interface NetSettlement {
  fromPersonName: string | null;
  toPersonName: string | null;
  amountMinor: number;
  requiresLedgerMatch: boolean;
}

export interface SettlementCheckpointItem {
  id: string;
  batchId: string;
  activityDate: string;
}

/**
 * Positive balances mean the counterparty owes the viewer. Group balances are
 * reduced to one person-level settlement before any bank row is considered.
 */
export function calculateNetSettlement(
  balances: SplitGroupBalance[],
  viewerName: string,
  counterpartyName: string
): NetSettlement {
  const netAmountMinor = balances.reduce((total, balance) => total + balance.amountMinor, 0);
  if (netAmountMinor === 0) {
    return {
      fromPersonName: null,
      toPersonName: null,
      amountMinor: 0,
      requiresLedgerMatch: false
    };
  }

  const counterpartyOwesViewer = netAmountMinor > 0;
  return {
    fromPersonName: counterpartyOwesViewer ? counterpartyName : viewerName,
    toPersonName: counterpartyOwesViewer ? viewerName : counterpartyName,
    amountMinor: Math.abs(netAmountMinor),
    requiresLedgerMatch: true
  };
}

export function classifyCheckpointItem(
  item: SettlementCheckpointItem,
  checkpoint: { batchId: string; closedOn: string }
) {
  if (item.batchId === checkpoint.batchId) {
    return "settled" as const;
  }

  return item.activityDate <= checkpoint.closedOn
    ? "open_after_settlement" as const
    : "open" as const;
}

export function applyExternalSettlement(
  checkpointAmountMinor: number,
  ledgerAmountMinor: number
) {
  const remainingMinor = Math.max(checkpointAmountMinor - ledgerAmountMinor, 0);
  return {
    matched: ledgerAmountMinor === checkpointAmountMinor,
    overpaid: ledgerAmountMinor > checkpointAmountMinor,
    remainingMinor
  };
}
