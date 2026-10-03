// Statement mismatch diagnosis: explains each statement card's difference
// with the actual rows behind it and proposes fixes the user can approve.
//
// A statement gives the complete row list, so a card's difference is fully
// accounted for by four parts (see "Statement Mismatch Diagnosis" in
// DOMAIN.md):
//
//   difference = opening gap
//              + ledger entries in the period that no statement row matched
//              - statement rows in the period left out of the import
//
// Every finding below explains one of those parts. Its `effectMinor` is the
// change to the card's difference once it is resolved, so a card whose
// findings sum to minus its difference is fully explained.
//
// The diagnosis is pure and deterministic. It never writes, never uses AI,
// and never certifies anything: fixes are proposals the user approves, and
// the import commit applies them.
import {
  compareDescriptionSimilarity,
  countSharedTokens,
  daysBetween,
  getSignedLedgerAmountMinor,
  hasCompactMerchantContainment,
  normalizeDescriptionForMatch
} from "./app-repository-helpers";
import { getDuplicateCandidateMaxDayDistance, isRowBeforeLateUnpostedEntry } from "./import-preview-match-policy";
import {
  createRepetitionIndex,
  getDuplicateCandidateDayDistance,
  getDuplicateMatchKind,
  getExistingTransactionDateContext,
  getTokenSimilarity
} from "./statement-row-matching";
import type {
  AccountDto,
  StatementCardDiagnosisDto,
  StatementCardOutcome,
  StatementDiagnosisDto,
  StatementFindingDto,
  StatementFindingEntryDto,
  StatementFindingFact,
  StatementFindingStatementRowDto,
  StatementFixDto
} from "../types/dto";

type EntryType = "expense" | "income" | "transfer";

export interface DiagnosisAccount {
  id: string;
  name: string;
  ownerPersonId?: string;
  institutionId?: string;
  // Saved statement checkpoints. An entry dated on or before one of these
  // belongs to a closed statement and is never moved off its account.
  savedCheckpoints: { month: string; endDate: string }[];
}

export interface DiagnosisLedgerEntry {
  id: string;
  accountId: string;
  transactionDate: string;
  postDate: string | null;
  note: string | null;
  description: string;
  amountMinor: number;
  entryType: EntryType;
  transferDirection: "in" | "out" | null;
  bankCertificationStatus: "provisional" | "statement_certified";
  sourceType: "csv" | "pdf" | "manual";
  transferGroupId: string | null;
}

export interface DiagnosisStatementRow {
  rowIndex: number;
  accountId?: string;
  postedDate: string;
  eventDate?: string;
  description: string;
  amountMinor: number;
  entryType: EntryType;
  transferDirection?: "in" | "out";
  commitStatus: "included" | "skipped" | "needs_review";
  commitStatusExplicit: boolean;
  // The entry this row certifies, or (for a skipped row) the entry that
  // already covers it.
  targetEntryId?: string;
  coveredByEntryId?: string;
  // Entries a needs-review row may be the same purchase as.
  reviewCandidateEntryIds: string[];
}

export interface DiagnosisCard {
  accountId: string;
  accountName: string;
  checkpointMonth: string;
  startDate?: string;
  endDate: string;
  deltaMinor: number;
  priorLedgerBalanceMinor?: number;
  // Internal sign (owed card balances are negative), like the ledger.
  previousStatementBalanceMinor?: number;
  supersededEntryIds: string[];
}

export interface DiagnosisInput {
  // Only an official statement can move or defer entries. Other sources get
  // findings without fixes.
  sourceType: "csv" | "pdf" | "manual";
  // "preview": an import preview, where a statement row with no entry will be
  // added by the commit. "committed": a saved statement compared with the
  // ledger, where a row with no entry is missing from it, so a move also
  // fixes the destination card and a second copy can be removed.
  mode?: "preview" | "committed";
  accounts: DiagnosisAccount[];
  cards: DiagnosisCard[];
  statementRows: DiagnosisStatementRow[];
  // The ledger as this preview sees it: fixes already approved are applied.
  ledgerEntries: DiagnosisLedgerEntry[];
  appliedFixes: StatementFixDto[];
  rejectedFixes: StatementDiagnosisDto["rejectedFixes"];
}

// How close to the statement's closing date an entry with no posted date
// must be dated to be read as posting in the next statement.
const NEXT_STATEMENT_WINDOW_DAYS = 7;
// How far apart a same-merchant entry and statement row may be to be read
// as one purchase whose amount changed (for example a final FX amount).
const AMOUNT_DIFFERS_MAX_DAY_DISTANCE = 3;
const LATER_STATEMENT_ENTRY_LIMIT = 5;

type Evidence = "strong" | "medium" | "weak";

interface WrongAccountCandidate {
  entry: DiagnosisLedgerEntry;
  evidence: Evidence;
  dayDistance: number;
  facts: StatementFindingFact[];
}

export function diagnoseStatementMismatches(input: DiagnosisInput): StatementDiagnosisDto {
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]));
  const cardsByAccountId = new Map(input.cards.map((card) => [card.accountId, card]));
  const claimedEntryIds = new Set(input.statementRows.flatMap((row) => [row.targetEntryId, row.coveredByEntryId].filter((id): id is string => Boolean(id))));
  const supersededEntryIds = new Set(input.cards.flatMap((card) => card.supersededEntryIds));
  const appliedFixKeys = new Set(input.appliedFixes.map(getFixKey));
  const findings: StatementFindingDto[] = [];

  // 1. Statement rows that would be added as new entries while the same
  // purchase already sits, provisional, on another account.
  const wrongAccountFindings = findWrongAccountEntries({
    input,
    accountsById,
    cardsByAccountId,
    claimedEntryIds
  });
  findings.push(...wrongAccountFindings);
  const explainedEntryIds = new Set(wrongAccountFindings.map((finding) => finding.entry?.id).filter((id): id is string => Boolean(id)));

  // Approved moves are applied: the moved entry is now a certification
  // target on its statement card. Report them so the user sees what will be
  // written, without counting them against any difference.
  for (const fix of input.appliedFixes) {
    if (fix.kind === "defer_to_next_statement") {
      const deferred = input.ledgerEntries.find((candidate) => candidate.id === fix.entryId);
      if (deferred) {
        findings.push({
          id: `next_statement:${deferred.id}`,
          kind: "next_statement",
          confidence: "high",
          accountId: fix.accountId,
          effectMinor: 0,
          entry: mapEntry(deferred, accountsById),
          facts: [],
          fix,
          applied: true
        });
        explainedEntryIds.add(deferred.id);
      }
      continue;
    }
    if (fix.kind !== "move_to_statement_account") {
      continue;
    }
    const entry = input.ledgerEntries.find((candidate) => candidate.id === fix.entryId);
    const row = input.statementRows.find((candidate) => candidate.rowIndex === fix.statementRowIndex);
    if (!entry) {
      continue;
    }
    findings.push({
      id: `wrong_account:${entry.id}`,
      kind: "wrong_account",
      confidence: "high",
      accountId: cardsByAccountId.has(fix.fromAccountId) ? fix.fromAccountId : fix.toAccountId,
      relatedAccountId: cardsByAccountId.has(fix.fromAccountId) ? fix.toAccountId : fix.fromAccountId,
      effectMinor: 0,
      entry: mapEntry(entry, accountsById, fix.fromAccountId),
      ...(row ? { statementRow: mapStatementRow(row) } : {}),
      facts: [],
      fix,
      applied: true
    });
    explainedEntryIds.add(entry.id);
  }

  // 2. Each card's remaining parts: unmatched ledger entries in the period,
  // statement rows left out, and the opening gap.
  for (const card of input.cards) {
    const reviewPairedEntryIds = new Set<string>();
    const cardRows = input.statementRows.filter((row) => row.accountId === card.accountId && isWithinPeriod(row.postedDate, card));
    for (const row of cardRows) {
      if (row.commitStatus !== "needs_review") {
        continue;
      }
      // A needs-review row and the entry it may be are one purchase either
      // way: the entry is counted in the ledger and the row is not, so
      // together they leave the difference unchanged.
      const pairedEntryId = row.reviewCandidateEntryIds.find((id) => {
        const entry = input.ledgerEntries.find((candidate) => candidate.id === id);
        return entry
          && entry.accountId === card.accountId
          && getEntrySignedAmountMinor(entry) === getRowSignedAmountMinor(row)
          && !reviewPairedEntryIds.has(id);
      });
      if (pairedEntryId) {
        reviewPairedEntryIds.add(pairedEntryId);
      }
    }

    const periodEntries = input.ledgerEntries.filter((entry) => (
      entry.accountId === card.accountId
      && !claimedEntryIds.has(entry.id)
      && !supersededEntryIds.has(entry.id)
      && !reviewPairedEntryIds.has(entry.id)
      && isWithinPeriod(getEntryClearedDate(entry), card)
    ));
    for (const entry of periodEntries) {
      if (explainedEntryIds.has(entry.id)) {
        continue;
      }
      findings.push(explainPeriodEntry({ entry, card, cardRows, input, accountsById, appliedFixKeys }));
    }

    for (const row of cardRows) {
      if (!isLeftOutStatementRow(row, reviewPairedEntryIds)) {
        continue;
      }
      findings.push({
        id: `excluded_statement_row:${row.rowIndex}`,
        kind: "excluded_statement_row",
        confidence: "high",
        accountId: card.accountId,
        effectMinor: getRowSignedAmountMinor(row),
        statementRow: mapStatementRow(row),
        facts: row.commitStatusExplicit ? [{ code: "excluded_by_you" }] : [],
        applied: false
      });
    }

    if (card.previousStatementBalanceMinor != null && card.priorLedgerBalanceMinor != null) {
      const openingGapMinor = card.priorLedgerBalanceMinor - card.previousStatementBalanceMinor;
      if (openingGapMinor !== 0) {
        findings.push({
          id: `opening_balance_gap:${card.accountId}`,
          kind: "opening_balance_gap",
          confidence: "medium",
          accountId: card.accountId,
          effectMinor: -openingGapMinor,
          facts: [],
          applied: false
        });
      }
    }
  }

  assignPlanConfidence(findings, input.cards);

  return {
    cards: input.cards.map((card) => buildCardDiagnosis(card, findings, input)),
    findings,
    appliedFixes: input.appliedFixes,
    rejectedFixes: input.rejectedFixes
  };
}

function findWrongAccountEntries(context: {
  input: DiagnosisInput;
  accountsById: Map<string, DiagnosisAccount>;
  cardsByAccountId: Map<string, DiagnosisCard>;
  claimedEntryIds: Set<string>;
}): StatementFindingDto[] {
  const { input, accountsById, cardsByAccountId, claimedEntryIds } = context;
  const newRows = input.statementRows.filter((row) => (
    row.accountId
    && cardsByAccountId.has(row.accountId)
    && row.commitStatus === "included"
    && !row.targetEntryId
  ));
  const candidatesByRow = new Map<number, WrongAccountCandidate[]>();
  const rowsByEntryId = new Map<string, number[]>();
  for (const row of newRows) {
    const card = cardsByAccountId.get(row.accountId!)!;
    const destinationAccount = accountsById.get(row.accountId!);
    const searchAccountIds = getRelatedAccountIds(destinationAccount, input.accounts, cardsByAccountId);
    const candidates = input.ledgerEntries
      .filter((entry) => searchAccountIds.has(entry.accountId) && !claimedEntryIds.has(entry.id))
      .map((entry) => scoreWrongAccountCandidate({ row, entry, card, accountsById, destinationAccount, repeats: repeatsFor(input)(row, entry) }))
      .filter((candidate): candidate is WrongAccountCandidate => Boolean(candidate))
      .sort((left, right) => getEvidenceRank(left.evidence) - getEvidenceRank(right.evidence) || left.dayDistance - right.dayDistance);
    if (!candidates.length) {
      continue;
    }
    candidatesByRow.set(row.rowIndex, candidates);
    for (const candidate of candidates) {
      rowsByEntryId.set(candidate.entry.id, [...(rowsByEntryId.get(candidate.entry.id) ?? []), row.rowIndex]);
    }
  }

  const findings: StatementFindingDto[] = [];
  const usedEntryIds = new Set<string>();
  for (const row of newRows) {
    const candidates = candidatesByRow.get(row.rowIndex);
    if (!candidates?.length) {
      continue;
    }
    const best = candidates[0];
    if (usedEntryIds.has(best.entry.id)) {
      continue;
    }
    usedEntryIds.add(best.entry.id);
    const rivalsAtBest = candidates.filter((candidate) => candidate.evidence === best.evidence).length;
    const rowsWantingEntry = rowsByEntryId.get(best.entry.id)?.length ?? 1;
    const candidateCount = Math.max(rivalsAtBest, rowsWantingEntry);
    const facts = [...best.facts, candidateCount > 1 ? { code: "several_candidates" as const, count: candidateCount } : { code: "only_candidate" as const }];
    const isProtected = facts.some((fact) => fact.code === "closed_statement_protects_entry" || fact.code === "transfer_link_protects_entry")
      || best.entry.bankCertificationStatus === "statement_certified";
    const evidence: Evidence = isProtected ? "weak" : candidateCount > 1 && best.evidence === "strong" ? "medium" : best.evidence;
    const sourceCard = cardsByAccountId.get(best.entry.accountId);
    const sourceCountsEntry = Boolean(sourceCard && getEntryClearedDate(best.entry) <= sourceCard.endDate);
    const canFix = input.sourceType === "pdf" && evidence !== "weak";
    // After commit the destination card is missing the entry, so the move
    // closes its difference too; in a preview the commit adds the row anyway.
    const destinationEffectMinor = input.mode === "committed" && sourceCard ? getEntrySignedAmountMinor(best.entry) : 0;
    findings.push({
      id: `wrong_account:${best.entry.id}`,
      kind: "wrong_account",
      confidence: evidence === "strong" ? "high" : evidence === "medium" ? "medium" : "low",
      // The finding explains the source card's difference when the source is
      // on this statement; otherwise it stops a duplicate on the destination.
      accountId: sourceCard ? sourceCard.accountId : row.accountId!,
      relatedAccountId: sourceCard ? row.accountId! : best.entry.accountId,
      effectMinor: sourceCard
        ? sourceCountsEntry ? -getEntrySignedAmountMinor(best.entry) : 0
        : input.mode === "committed" ? getEntrySignedAmountMinor(best.entry) : 0,
      ...(destinationEffectMinor ? { relatedEffectMinor: destinationEffectMinor } : {}),
      entry: mapEntry(best.entry, accountsById),
      statementRow: mapStatementRow(row),
      facts,
      ...(canFix ? {
        fix: {
          kind: "move_to_statement_account" as const,
          entryId: best.entry.id,
          fromAccountId: best.entry.accountId,
          toAccountId: row.accountId!,
          statementRowIndex: row.rowIndex
        }
      } : {}),
      applied: false
    });
  }
  return findings;
}

// Accounts a statement card's purchases may wrongly sit on: the other cards
// on the same statement, and the same owner's accounts at the same bank.
function getRelatedAccountIds(
  destinationAccount: DiagnosisAccount | undefined,
  accounts: DiagnosisAccount[],
  cardsByAccountId: Map<string, DiagnosisCard>
) {
  const related = new Set<string>();
  for (const account of accounts) {
    if (!destinationAccount || account.id === destinationAccount.id) {
      continue;
    }
    const isStatementSibling = cardsByAccountId.has(account.id);
    const isSameOwnerAtSameBank = Boolean(
      destinationAccount.ownerPersonId
      && account.ownerPersonId === destinationAccount.ownerPersonId
      && destinationAccount.institutionId
      && account.institutionId === destinationAccount.institutionId
    );
    if (isStatementSibling || isSameOwnerAtSameBank) {
      related.add(account.id);
    }
  }
  return related;
}

function scoreWrongAccountCandidate(input: {
  row: DiagnosisStatementRow;
  entry: DiagnosisLedgerEntry;
  card: DiagnosisCard;
  accountsById: Map<string, DiagnosisAccount>;
  destinationAccount?: DiagnosisAccount;
  // The velocity rule: the row or the entry repeats on its own side.
  repeats: boolean;
}): WrongAccountCandidate | undefined {
  const { row, entry } = input;
  if (getEntrySignedAmountMinor(entry) !== getRowSignedAmountMinor(row)) {
    return undefined;
  }
  const dayDistance = getRowEntryDayDistance(row, entry);
  // The velocity rule: repeated charges (daily fares, coffees, top-ups at
  // one price) far apart in time are separate purchases, never one purchase
  // on the wrong card.
  if (dayDistance > getDuplicateCandidateMaxDayDistance({ repeats: input.repeats })) {
    return undefined;
  }
  if (isNextStatementEntryForRow(row, entry, input.card.endDate, input.repeats)) {
    return undefined;
  }

  const merchant = compareMerchants(row.description, entry.description, entry, dayDistance);
  const matchKind = getDuplicateMatchKind({
    dayDistance,
    descriptionSimilarity: merchant.similarity,
    tokenSimilarity: merchant.tokenSimilarity
  });
  const evidence: Evidence = matchKind === "exact" || matchKind === "probable"
    ? "strong"
    : matchKind === "near" ? "medium" : "weak";

  const facts: StatementFindingFact[] = [{ code: "same_amount" }];
  if (merchant.isSameMerchant) {
    facts.push({ code: "same_merchant" });
  } else if (merchant.similarity >= 0.5 || merchant.tokenSimilarity >= 0.5) {
    facts.push({ code: "similar_merchant" });
  }
  facts.push(...getDateFacts(row, entry));

  const sourceAccount = input.accountsById.get(entry.accountId);
  const destinationOwner = input.destinationAccount?.ownerPersonId;
  const isSameOwner = Boolean(destinationOwner && sourceAccount?.ownerPersonId === destinationOwner);
  facts.push({ code: isSameOwner ? "same_owner" : "different_owner" });

  if (entry.transferGroupId) {
    facts.push({ code: "transfer_link_protects_entry" });
  }
  if (sourceAccount && isCoveredBySavedCheckpoint(entry, sourceAccount, input.card.checkpointMonth)) {
    facts.push({ code: "closed_statement_protects_entry" });
  }

  return {
    entry,
    // Moving an entry between owners is never decided on text alone.
    evidence: !isSameOwner && evidence === "strong" ? "medium" : evidence,
    dayDistance,
    facts
  };
}

function explainPeriodEntry(context: {
  entry: DiagnosisLedgerEntry;
  card: DiagnosisCard;
  cardRows: DiagnosisStatementRow[];
  input: DiagnosisInput;
  accountsById: Map<string, DiagnosisAccount>;
  appliedFixKeys: Set<string>;
}): StatementFindingDto {
  const { entry, card, cardRows, input, accountsById } = context;
  const effectMinor = -getEntrySignedAmountMinor(entry);
  const base = {
    accountId: card.accountId,
    effectMinor,
    entry: mapEntry(entry, accountsById),
    applied: false
  };

  // A second copy of a purchase the statement already matched to another
  // entry, on this card or on another card of the same statement.
  const coveredRow = [...cardRows, ...input.statementRows.filter((row) => row.accountId !== card.accountId)].find((row) => {
    const coveringEntryId = row.targetEntryId ?? row.coveredByEntryId;
    if (!coveringEntryId || coveringEntryId === entry.id || getRowSignedAmountMinor(row) !== getEntrySignedAmountMinor(entry)) {
      return false;
    }
    const rowCard = input.cards.find((item) => item.accountId === row.accountId) ?? card;
    if (isNextStatementEntryForRow(row, entry, rowCard.endDate, repeatsFor(input)(row, entry))) {
      return false;
    }
    const dayDistance = getRowEntryDayDistance(row, entry);
    const merchant = compareMerchants(row.description, entry.description, entry, dayDistance);
    const matchKind = getDuplicateMatchKind({ dayDistance, descriptionSimilarity: merchant.similarity, tokenSimilarity: merchant.tokenSimilarity });
    return matchKind === "exact" || matchKind === "probable";
  });
  if (coveredRow) {
    const coveringEntryId = (coveredRow.targetEntryId ?? coveredRow.coveredByEntryId)!;
    const canRemove = input.mode === "committed"
      && input.sourceType === "pdf"
      && entry.bankCertificationStatus === "provisional"
      && !entry.transferGroupId;
    return {
      ...base,
      id: `duplicate_entry:${entry.id}`,
      kind: "duplicate_entry",
      confidence: canRemove ? "high" : "medium",
      ...(canRemove ? { fix: { kind: "remove_duplicate_entry" as const, entryId: entry.id, accountId: card.accountId, coveredByEntryId: coveringEntryId } } : {}),
      ...(coveredRow.accountId && coveredRow.accountId !== card.accountId ? { relatedAccountId: coveredRow.accountId } : {}),
      statementRow: mapStatementRow(coveredRow),
      facts: [{ code: "same_amount" }, { code: "same_merchant" }, ...getDateFacts(coveredRow, entry)]
    };
  }

  // The same purchase at a different amount, for example a provisional
  // amount that settled differently.
  const differentAmountRow = cardRows.find((row) => {
    if (row.commitStatus !== "included" || row.targetEntryId || row.entryType !== entry.entryType) {
      return false;
    }
    if (row.amountMinor === entry.amountMinor) {
      return false;
    }
    const dayDistance = getRowEntryDayDistance(row, entry);
    return dayDistance <= AMOUNT_DIFFERS_MAX_DAY_DISTANCE && compareMerchants(row.description, entry.description, entry, dayDistance).isSameMerchant;
  });
  if (differentAmountRow) {
    return {
      ...base,
      id: `amount_differs:${entry.id}`,
      kind: "amount_differs",
      confidence: "medium",
      statementRow: mapStatementRow(differentAmountRow),
      facts: [{ code: "same_merchant" }, ...getDateFacts(differentAmountRow, entry)]
    };
  }

  // Dated just before the statement closed, with no posted date yet: most
  // likely posts in the next statement.
  const daysBeforeEnd = daysBetween(entry.transactionDate, card.endDate);
  if (
    entry.bankCertificationStatus === "provisional"
    && entry.postDate == null
    && !entry.transferGroupId
    && daysBeforeEnd >= 0
    && daysBeforeEnd <= NEXT_STATEMENT_WINDOW_DAYS
  ) {
    const fix: StatementFixDto = {
      kind: "defer_to_next_statement",
      entryId: entry.id,
      accountId: card.accountId,
      postDate: addDays(card.endDate, 1)
    };
    return {
      ...base,
      id: `next_statement:${entry.id}`,
      kind: "next_statement",
      confidence: "medium",
      facts: [{ code: "no_posted_date" }, { code: "near_statement_end", days: daysBeforeEnd }],
      ...(input.sourceType === "pdf" && !context.appliedFixKeys.has(getFixKey(fix)) ? { fix } : {})
    };
  }

  return {
    ...base,
    id: `not_on_statement:${entry.id}`,
    kind: "not_on_statement",
    confidence: "low",
    facts: []
  };
}

// A fix is high confidence only when its own evidence is strong and the
// fixes together close every card they change. A fix that would widen a
// card's difference is withdrawn: the diagnosis can explain, but it does not
// recommend making things worse.
function assignPlanConfidence(findings: StatementFindingDto[], cards: DiagnosisCard[]) {
  const projectedByCard = new Map(cards.map((card) => [card.accountId, card.deltaMinor]));
  for (const finding of findings) {
    if (finding.fix && !finding.applied && finding.confidence !== "low") {
      projectedByCard.set(finding.accountId, (projectedByCard.get(finding.accountId) ?? 0) + finding.effectMinor);
      if (finding.relatedAccountId && finding.relatedEffectMinor) {
        projectedByCard.set(finding.relatedAccountId, (projectedByCard.get(finding.relatedAccountId) ?? 0) + finding.relatedEffectMinor);
      }
    }
  }
  for (const finding of findings) {
    if (!finding.fix || finding.applied) {
      continue;
    }
    const card = cards.find((item) => item.accountId === finding.accountId);
    const before = Math.abs(card?.deltaMinor ?? 0);
    const relatedCard = finding.relatedEffectMinor ? cards.find((item) => item.accountId === finding.relatedAccountId) : undefined;
    // Every card the fix changes must end no further from its statement.
    const after = Math.abs(projectedByCard.get(finding.accountId) ?? 0)
      + (relatedCard ? Math.abs(projectedByCard.get(relatedCard.accountId) ?? 0) : 0);
    const beforeAll = before + (relatedCard ? Math.abs(relatedCard.deltaMinor) : 0);
    const singleAfter = Math.abs((card?.deltaMinor ?? 0) + finding.effectMinor)
      + (relatedCard ? Math.abs(relatedCard.deltaMinor + (finding.relatedEffectMinor ?? 0)) : 0);
    if ((finding.effectMinor !== 0 || finding.relatedEffectMinor) && singleAfter > beforeAll && after > beforeAll) {
      finding.facts.push({ code: "worsens_statement" });
      finding.confidence = "low";
      delete finding.fix;
      continue;
    }
    if (after === 0) {
      finding.facts.push({ code: "closes_statement" });
      // A deferral is a guess about the next statement, so it only becomes
      // high confidence when it closes the card exactly.
      if (finding.kind === "next_statement") {
        finding.confidence = "high";
      }
    } else {
      if (after < beforeAll) {
        finding.facts.push({ code: "improves_statement" });
      }
      if (finding.confidence === "high") {
        finding.confidence = "medium";
      }
    }
  }
}

function buildCardDiagnosis(card: DiagnosisCard, findings: StatementFindingDto[], input: DiagnosisInput): StatementCardDiagnosisDto {
  const cardFindings = findings.filter((finding) => finding.accountId === card.accountId && !finding.applied);
  const relatedFindings = findings.filter((finding) => finding.relatedAccountId === card.accountId && finding.relatedEffectMinor && !finding.applied);
  const suggestedEffectMinor = cardFindings
    .filter((finding) => finding.fix)
    .reduce((total, finding) => total + finding.effectMinor, 0)
    + relatedFindings.filter((finding) => finding.fix).reduce((total, finding) => total + (finding.relatedEffectMinor ?? 0), 0);
  const allEffectMinor = cardFindings.reduce((total, finding) => total + finding.effectMinor, 0)
    + relatedFindings.reduce((total, finding) => total + (finding.relatedEffectMinor ?? 0), 0);
  const projectedDeltaMinor = card.deltaMinor + suggestedEffectMinor;
  const unexplainedMinor = card.deltaMinor + allEffectMinor;
  const needsReview = cardFindings.some((finding) => !finding.fix && finding.effectMinor !== 0);
  const deferredEntryIds = new Set(input.appliedFixes.filter((fix) => fix.kind === "defer_to_next_statement").map((fix) => fix.entryId));
  const laterEntries = input.ledgerEntries
    .filter((entry) => (
      entry.accountId === card.accountId
      && !deferredEntryIds.has(entry.id)
      && entry.bankCertificationStatus === "provisional"
      && getEntryClearedDate(entry) > card.endDate
    ))
    .sort((left, right) => left.transactionDate.localeCompare(right.transactionDate));

  return {
    accountId: card.accountId,
    accountName: card.accountName,
    checkpointMonth: card.checkpointMonth,
    deltaMinor: card.deltaMinor,
    projectedDeltaMinor,
    unexplainedMinor,
    outcome: getCardOutcome({ deltaMinor: card.deltaMinor, projectedDeltaMinor, needsReview }),
    laterStatementEntries: laterEntries.slice(0, LATER_STATEMENT_ENTRY_LIMIT).map((entry) => mapEntry(entry)),
    laterStatementEntryCount: laterEntries.length
  };
}

function getCardOutcome(input: { deltaMinor: number; projectedDeltaMinor: number; needsReview: boolean }): StatementCardOutcome {
  if (input.projectedDeltaMinor === 0) {
    return "resolved";
  }
  if (Math.abs(input.projectedDeltaMinor) < Math.abs(input.deltaMinor)) {
    return "partially_resolved";
  }
  return input.needsReview ? "needs_manual_review" : "still_mismatched";
}

function isLeftOutStatementRow(row: DiagnosisStatementRow, reviewPairedEntryIds: Set<string>) {
  if (row.commitStatus === "included") {
    return false;
  }
  // A row skipped because an entry already covers it is not missing: that
  // entry is counted instead.
  if (row.coveredByEntryId && !row.commitStatusExplicit) {
    return false;
  }
  if (row.commitStatus === "needs_review" && row.reviewCandidateEntryIds.some((id) => reviewPairedEntryIds.has(id))) {
    return false;
  }
  return true;
}

function compareMerchants(statementDescription: string, entryDescription: string, entry: DiagnosisLedgerEntry, dayDistance: number) {
  const baseSimilarity = compareDescriptionSimilarity(statementDescription, entryDescription);
  const tokenSimilarity = getTokenSimilarity(statementDescription, entryDescription);
  const hasContainment = hasCompactMerchantContainment(statementDescription, entryDescription);
  // Same boost as the preview's reconciliation lane: a manual entry is
  // typed by hand, so on the same day one shared word is enough.
  const similarity = entry.sourceType === "manual"
    && entry.bankCertificationStatus === "provisional"
    && dayDistance === 0
    && (countSharedTokens(statementDescription, entryDescription) >= 1 || hasContainment)
    ? Math.max(baseSimilarity, 0.7)
    : baseSimilarity;
  return {
    similarity,
    tokenSimilarity,
    isSameMerchant: normalizeDescriptionForMatch(statementDescription) === normalizeDescriptionForMatch(entryDescription)
      || baseSimilarity >= 0.8
      || hasContainment
  };
}

function getDateFacts(row: DiagnosisStatementRow, entry: DiagnosisLedgerEntry): StatementFindingFact[] {
  const facts: StatementFindingFact[] = [];
  const statementEventDate = row.eventDate ?? row.postedDate;
  const eventDistance = Math.abs(daysBetween(statementEventDate, entry.transactionDate));
  facts.push(eventDistance === 0 ? { code: "same_transaction_date" } : { code: "date_offset", days: eventDistance });
  if (row.postedDate !== statementEventDate) {
    facts.push({ code: "posted_date_offset", days: Math.abs(daysBetween(statementEventDate, row.postedDate)) });
  }
  return facts;
}

// A repeating entry from the statement's last days that has not posted yet
// may be the next statement's, never an earlier row's (the shared rule in
// import-preview-match-policy.js).
function isNextStatementEntryForRow(row: DiagnosisStatementRow, entry: DiagnosisLedgerEntry, statementEndDate: string, repeats: boolean) {
  return isRowBeforeLateUnpostedEntry({
    repeats,
    entryDate: entry.transactionDate,
    entryPostDate: entry.postDate,
    statementEndDate,
    rowPurchaseDate: row.eventDate ?? row.postedDate
  });
}

// The velocity rule's repetition test for one diagnosis: a statement row
// repeats among the statement's rows, an entry among the ledger's.
const repetitionByInput = new WeakMap<DiagnosisInput, (row: DiagnosisStatementRow, entry: DiagnosisLedgerEntry) => boolean>();

function repeatsFor(input: DiagnosisInput) {
  const known = repetitionByInput.get(input);
  if (known) {
    return known;
  }
  const rowRepeats = createRepetitionIndex(input.statementRows, (row) => ({
    accountId: row.accountId,
    signedAmountMinor: getRowSignedAmountMinor(row),
    description: row.description,
    postedDate: row.postedDate,
    eventDate: row.eventDate ?? row.postedDate,
    hasEventDateHint: Boolean(row.eventDate && row.eventDate !== row.postedDate)
  }));
  const entryRepeats = createRepetitionIndex(input.ledgerEntries, (entry) => ({
    accountId: entry.accountId,
    signedAmountMinor: getEntrySignedAmountMinor(entry),
    description: entry.description,
    ...getExistingTransactionDateContext({ transaction_date: entry.transactionDate, post_date: entry.postDate, note: entry.note })
  }));
  const repeats = (row: DiagnosisStatementRow, entry: DiagnosisLedgerEntry) => rowRepeats(row) || entryRepeats(entry);
  repetitionByInput.set(input, repeats);
  return repeats;
}

function getRowEntryDayDistance(row: DiagnosisStatementRow, entry: DiagnosisLedgerEntry) {
  return getDuplicateCandidateDayDistance({
    previewRow: {
      postedDate: row.postedDate,
      eventDate: row.eventDate ?? row.postedDate,
      hasEventDateHint: Boolean(row.eventDate && row.eventDate !== row.postedDate)
    },
    candidate: getExistingTransactionDateContext({
      transaction_date: entry.transactionDate,
      post_date: entry.postDate,
      note: entry.note
    })
  });
}

function isCoveredBySavedCheckpoint(entry: DiagnosisLedgerEntry, account: DiagnosisAccount, currentCheckpointMonth: string) {
  const clearedDate = getEntryClearedDate(entry);
  return account.savedCheckpoints.some((checkpoint) => (
    checkpoint.month !== currentCheckpointMonth
    && clearedDate <= checkpoint.endDate
  ));
}

function isWithinPeriod(date: string, card: DiagnosisCard) {
  return (!card.startDate || date >= card.startDate) && date <= card.endDate;
}

function getEntryClearedDate(entry: DiagnosisLedgerEntry) {
  return entry.postDate ?? entry.transactionDate;
}

function getEntrySignedAmountMinor(entry: DiagnosisLedgerEntry) {
  return getSignedLedgerAmountMinor({
    entry_type: entry.entryType,
    transfer_direction: entry.transferDirection,
    amount_minor: entry.amountMinor
  });
}

function getRowSignedAmountMinor(row: DiagnosisStatementRow) {
  return getSignedLedgerAmountMinor({
    entry_type: row.entryType,
    transfer_direction: row.transferDirection ?? null,
    amount_minor: row.amountMinor
  });
}

function getEvidenceRank(evidence: Evidence) {
  return evidence === "strong" ? 0 : evidence === "medium" ? 1 : 2;
}

function mapEntry(entry: DiagnosisLedgerEntry, accountsById?: Map<string, DiagnosisAccount>, accountId = entry.accountId): StatementFindingEntryDto {
  return {
    id: entry.id,
    accountId,
    accountName: accountsById?.get(accountId)?.name ?? "",
    description: entry.description,
    transactionDate: entry.transactionDate,
    ...(entry.postDate ? { postedDate: entry.postDate } : {}),
    signedAmountMinor: getEntrySignedAmountMinor(entry),
    bankCertificationStatus: entry.bankCertificationStatus
  };
}

function mapStatementRow(row: DiagnosisStatementRow): StatementFindingStatementRowDto {
  return {
    rowIndex: row.rowIndex,
    ...(row.accountId ? { accountId: row.accountId } : {}),
    description: row.description,
    ...(row.eventDate && row.eventDate !== row.postedDate ? { transactionDate: row.eventDate } : {}),
    postedDate: row.postedDate,
    signedAmountMinor: getRowSignedAmountMinor(row)
  };
}

export function getFixKey(fix: StatementFixDto) {
  if (fix.kind === "move_to_statement_account") {
    return `${fix.kind}:${fix.entryId}:${fix.toAccountId}`;
  }
  return fix.kind === "defer_to_next_statement"
    ? `${fix.kind}:${fix.entryId}:${fix.postDate}`
    : `${fix.kind}:${fix.entryId}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// Why an approved fix can no longer be applied, or undefined when it can.
// The preview and the commit both check every fix with this, the commit on
// freshly read rows, so a fix approved on stale data is refused, not forced.
export function getStatementFixRejection(input: {
  fix: StatementFixDto;
  sourceType: "csv" | "pdf" | "manual";
  entry?: Pick<DiagnosisLedgerEntry, "accountId" | "bankCertificationStatus" | "postDate" | "transactionDate" | "transferGroupId">;
  statementCards: Pick<DiagnosisCard, "accountId" | "checkpointMonth" | "endDate">[];
  sourceAccount?: DiagnosisAccount;
}) {
  const { fix, entry } = input;
  if (input.sourceType !== "pdf") {
    return "Only an official statement can move or defer entries.";
  }
  if (fix.kind === "remove_duplicate_entry") {
    return "A second copy is removed from Settings after the statement is saved, not in an import.";
  }
  if (!entry) {
    return "The entry is no longer in the ledger.";
  }
  if (entry.bankCertificationStatus !== "provisional") {
    return "The entry is already certified by a statement.";
  }
  if (entry.transferGroupId) {
    return "The entry is linked as a transfer.";
  }

  if (fix.kind === "move_to_statement_account") {
    if (entry.accountId !== fix.fromAccountId) {
      return "The entry is no longer on the account it was found on.";
    }
    const destinationCard = input.statementCards.find((card) => card.accountId === fix.toAccountId);
    if (!destinationCard) {
      return "The destination account is not on this statement.";
    }
    if (input.sourceAccount && isCoveredBySavedCheckpoint(
      { ...entry, id: "", note: null, description: "", amountMinor: 0, entryType: "expense", transferDirection: null, sourceType: "manual" },
      input.sourceAccount,
      destinationCard.checkpointMonth
    )) {
      return "The entry belongs to a saved statement on its current account.";
    }
    return undefined;
  }

  const card = input.statementCards.find((item) => item.accountId === fix.accountId);
  if (!card || entry.accountId !== fix.accountId) {
    return "The entry is not on a card of this statement.";
  }
  if (entry.postDate != null) {
    return "The entry already has a posted date.";
  }
  if (fix.postDate !== addDays(card.endDate, 1)) {
    return "The deferral date does not follow this statement.";
  }
  return undefined;
}

export interface SavedCheckpointBalance {
  accountId: string;
  accountName: string;
  month: string;
  endDate: string;
  deltaMinor: number;
}

export interface LedgerBalanceChange {
  accountId: string;
  // Signed change to the account's balance from `clearedDate` on.
  signedAmountMinor: number;
  clearedDate: string;
}

// A correction after commit changes an account's balance from the entry's
// date on, so every saved statement that closes on or after it moves too.
// Returns the saved statements that match now and would not afterwards: a
// correction that unbalances a statement that agrees is never applied.
export function findCheckpointsBrokenByCorrections(input: {
  checkpoints: SavedCheckpointBalance[];
  changes: LedgerBalanceChange[];
}) {
  return input.checkpoints.filter((checkpoint) => {
    if (checkpoint.deltaMinor !== 0) {
      return false;
    }
    const shiftMinor = input.changes
      .filter((change) => change.accountId === checkpoint.accountId && change.clearedDate <= checkpoint.endDate)
      .reduce((total, change) => total + change.signedAmountMinor, 0);
    return shiftMinor !== 0;
  });
}

// The balance changes a correction makes: a move takes the entry off one
// account and onto another; removing a copy takes it off its account.
export function getCorrectionBalanceChanges(fix: StatementFixDto, entry: { accountId: string; signedAmountMinor: number; clearedDate: string }): LedgerBalanceChange[] {
  if (fix.kind === "move_to_statement_account") {
    return [
      { accountId: fix.fromAccountId, signedAmountMinor: -entry.signedAmountMinor, clearedDate: entry.clearedDate },
      { accountId: fix.toAccountId, signedAmountMinor: entry.signedAmountMinor, clearedDate: entry.clearedDate }
    ];
  }
  if (fix.kind === "remove_duplicate_entry") {
    return [{ accountId: fix.accountId, signedAmountMinor: -entry.signedAmountMinor, clearedDate: entry.clearedDate }];
  }
  return [];
}

// An account as the diagnosis reads it: a joint account has no single owner.
export function toDiagnosisAccount(account?: AccountDto): DiagnosisAccount | undefined {
  if (!account) {
    return undefined;
  }
  return {
    id: account.id,
    name: account.name,
    ...(account.ownerPersonId && !account.isJoint ? { ownerPersonId: account.ownerPersonId } : {}),
    ...(account.institutionId ? { institutionId: account.institutionId } : {}),
    savedCheckpoints: (account.checkpointHistory ?? []).map((checkpoint) => ({
      month: checkpoint.month,
      endDate: checkpoint.statementEndDate ?? getMonthEndDateForDiagnosis(checkpoint.month)
    }))
  };
}

function getMonthEndDateForDiagnosis(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}
