// GET /api/transfers/draft-candidates: the other-side candidates for a
// transfer that is not saved yet (an Ask draft card). The same search the
// Entries transfer dialog runs for a saved entry (loadTransferMatchCandidates),
// started from the draft's date, wallet, amount and direction. Read only.

import { loadTakenTransferEntryIds, loadTransferCandidatesForDraft } from "../app-repository-entries";
import type { TransferOptionDto } from "../../types/dto";

export interface TransferDraftQuery {
  date: string;
  accountId: string;
  amountMinor: number;
  transferDirection: "in" | "out";
}

const MAX_AMOUNT_MINOR = 100_000_000_000;

export function readTransferDraftQuery(params: URLSearchParams): TransferDraftQuery | null {
  const date = params.get("date") ?? "";
  const accountId = params.get("accountId") ?? "";
  const amountMinor = Number(params.get("amountMinor"));
  const direction = params.get("transferDirection");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) return null;
  if (!accountId || accountId.length > 80) return null;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > MAX_AMOUNT_MINOR) return null;
  return { date, accountId, amountMinor, transferDirection: direction === "in" ? "in" : "out" };
}

export async function buildTransferDraftCandidatesDto(db: D1Database, query: TransferDraftQuery): Promise<TransferOptionDto[]> {
  const candidates = await loadTransferCandidatesForDraft(db, query);
  const taken = await loadTakenTransferEntryIds(db, candidates);
  return candidates
    .filter((candidate) => !taken.has(candidate.id) && candidate.accountId)
    .slice(0, 4)
    .map((candidate) => ({
      entryId: candidate.id,
      date: candidate.date,
      description: candidate.description,
      accountId: candidate.accountId ?? "",
      accountName: candidate.accountName,
      ...(candidate.accountOwnerLabel ? { accountOwnerLabel: candidate.accountOwnerLabel } : {}),
      amountMinor: candidate.totalAmountMinor ?? candidate.amountMinor,
      categoryName: candidate.categoryName
    }));
}
