// The preview side of an investment statement import: which bank entry each
// contribution or withdrawal pairs with. It uses the one transfer-candidate
// ranking (transfer-candidates.ts) with the statement's account number as the
// strong signal, so the pair becomes one transfer and not two entries
// (DOMAIN.md, "Investment Statement Value").
import { pickReferencedTransferCandidate, type ReferencedTransferCandidateRow } from "./transfer-candidates";
import type { ImportPreviewRowDto, StatementCheckpointDraftDto } from "../types/dto";

interface PairableLedgerRow {
  transaction_id: string;
  account_id: string;
  account_name: string;
  transaction_date: string;
  description: string;
  amount_minor: number;
  entry_type: "expense" | "income" | "transfer";
  transfer_direction: "in" | "out" | null;
  transfer_group_id: string | null;
}

type PairableAccount = { id: string; kind: string };

function toCandidate(row: PairableLedgerRow): ReferencedTransferCandidateRow {
  return {
    id: row.transaction_id,
    date: row.transaction_date,
    accountId: row.account_id,
    accountName: row.account_name,
    amountMinor: row.amount_minor,
    transferDirection: row.entry_type === "transfer" ? row.transfer_direction : row.entry_type === "expense" ? "out" : "in",
    description: row.description
  };
}

// Sets `transferMatch` on every row that moves money into or out of an
// investment account named by an investment statement. A row already skipped
// (it is on the ledger) or waiting on a decision is left alone, and no bank
// entry is offered to two rows.
export function attachInvestmentTransferMatches(input: {
  previewRows: ImportPreviewRowDto[];
  valueCheckpoints: StatementCheckpointDraftDto[];
  ledgerRows: PairableLedgerRow[];
  accountsById: Map<string, PairableAccount>;
}) {
  if (!input.valueCheckpoints.length) {
    return;
  }
  const referenceByStatementAccount = new Map(input.valueCheckpoints.map((checkpoint) => [
    checkpoint.detectedAccountName ?? checkpoint.accountName,
    checkpoint.investmentValue?.accountReference ?? ""
  ]));
  const candidates = input.ledgerRows
    .filter((row) => !row.transfer_group_id && input.accountsById.get(row.account_id)?.kind !== "investment")
    .map((row) => toCandidate(row));
  const claimed = new Set<string>();
  for (const row of input.previewRows) {
    const reference = referenceByStatementAccount.get(row.statementAccountName ?? "");
    const account = row.accountId ? input.accountsById.get(row.accountId) : undefined;
    if (
      !reference
      || account?.kind !== "investment"
      || row.entryType !== "transfer"
      || !row.transferDirection
      || row.commitStatus !== "included"
    ) {
      continue;
    }
    const pick = pickReferencedTransferCandidate(
      { date: row.date, accountId: row.accountId, accountName: row.accountName, amountMinor: row.amountMinor, transferDirection: row.transferDirection },
      candidates,
      reference,
      claimed
    );
    if (!pick) {
      continue;
    }
    claimed.add(pick.candidate.id);
    row.transferMatch = {
      transactionId: pick.candidate.id,
      accountId: pick.candidate.accountId ?? "",
      accountName: pick.candidate.accountName,
      date: pick.candidate.date,
      description: pick.candidate.description,
      amountMinor: pick.candidate.amountMinor,
      basis: pick.basis
    };
  }
}
