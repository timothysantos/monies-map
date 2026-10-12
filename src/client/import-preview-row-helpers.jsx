import { RestorePreviewRowDialog } from "./import-restore-row-dialog";
import * as Popover from "@radix-ui/react-popover";
import { Fragment } from "react";

import { messages } from "./copy/en-SG";
import { importMessages } from "./copy/en-SG-imports";
import { moniesClient } from "./monies-client-service";

const { format: formatService } = moniesClient;

// What the preview rows share between the table (wide screens) and the row
// sheet (phones): the account change, the duplicate match the ledger shows
// for a row, and the confirm before an exactly covered row is included.

// The account select changed: the row takes that account (or keeps a name
// the app does not know) and its owner follows the account's owner.
export function buildAccountChange({ row, nextValue, accounts, getPreviewAccountOwnerPatch }) {
  const nextAccountId = nextValue || undefined;
  const nextAccount = accounts.find((account) => account.id === nextAccountId);
  const nextAccountName = nextAccount?.name ?? (!nextAccountId ? undefined : row.accountName);
  return {
    accountId: nextAccount?.id,
    accountName: nextAccountName,
    ...getPreviewAccountOwnerPatch(nextAccountName, row, nextAccount?.id)
  };
}

// Including a row the ledger already covers exactly asks first.
// "Restore preview row" asks first when the skipped row exactly matches an
// entry that is already recorded; it is the shared sheet frame
// (import-restore-row-dialog.jsx).
export function RestoreRowDialog({ target, onClose, onConfirm }) {
  return <RestorePreviewRowDialog row={target} onClose={onClose} onRestore={onConfirm} />;
}

export function formatDuplicateMatch(match) {
  return messages.common.triplet(
    formatImportPreviewDate(match.date),
    match.accountName ?? messages.common.emptyValue,
    formatService.formatMinorInput(match.amountMinor)
  );
}

function formatImportPreviewDate(value) {
  const [year, month, day] = String(value ?? "").split("-");
  if (year && month && day) {
    return `${day}/${month}/${year}`;
  }
  return formatService.formatDateOnly(value);
}

export function DuplicateMatchPopover({ row, match, statementImportSourceType = "csv" }) {
  const ledgerHref = match.existingTransactionId ? buildDuplicateLedgerEntryHref(match) : "";
  const incomingCertificationLabel = getIncomingBankCertificationLabel(statementImportSourceType);
  const ledgerCertificationLabel = getExistingBankCertificationLabel(match);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="duplicate-row-link">
          {importMessages.viewLedgerMatch}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="duplicate-match-popover" sideOffset={8} align="center">
          <div className="duplicate-match-head">
            <strong>{importMessages.duplicateMatchPopoverTitle}</strong>
            <span>{importMessages.duplicateMatchPopoverDetail}</span>
          </div>
          <div className="duplicate-match-flow">
            <DuplicateMatchCard
              label={importMessages.duplicateMatchIncomingLabel}
              date={row.date}
              eventDate={getIncomingEventDate(row)}
              postedDate={row.date}
              description={row.description}
              comparisonDescription={match.description}
              accountName={row.accountName}
              amountMinor={row.amountMinor}
              bankCertificationLabel={incomingCertificationLabel}
            />
            <span className="duplicate-match-arrow" aria-hidden="true">{"->"}</span>
            <DuplicateMatchCard
              label={importMessages.duplicateMatchLedgerLabel}
              date={match.date}
              eventDate={match.date}
              postedDate={match.postedDate}
              description={match.description}
              comparisonDescription={row.description}
              accountName={match.accountName}
              amountMinor={match.amountMinor}
              bankCertificationLabel={ledgerCertificationLabel}
            />
          </div>
          {ledgerHref ? (
            <a className="duplicate-match-open-link" href={ledgerHref} target="_blank" rel="noreferrer">
              {importMessages.openLedgerEntry}
            </a>
          ) : null}
          <Popover.Arrow className="category-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DuplicateMatchCard({ label, date, eventDate, postedDate, description, comparisonDescription, accountName, amountMinor, bankCertificationLabel }) {
  return (
    <div className="duplicate-match-card">
      <span>{label}</span>
      <strong>{renderHighlightedDescription(description, comparisonDescription)}</strong>
      <p>{messages.common.triplet(date, accountName ?? messages.common.emptyValue, formatService.formatMinorInput(amountMinor))}</p>
      <dl className="duplicate-match-dates">
        <div>
          <dt>{importMessages.duplicateMatchTransactionDate}</dt>
          <dd>{formatOptionalMatchDate(eventDate)}</dd>
        </div>
        <div>
          <dt>{importMessages.duplicateMatchPostedDate}</dt>
          <dd>{formatOptionalMatchDate(postedDate)}</dd>
        </div>
      </dl>
      <small>{importMessages.bankCertificationStatusLine(bankCertificationLabel)}</small>
    </div>
  );
}

function getIncomingEventDate(row) {
  return normalizeMatchDate(
    row.rawRow?.transactionDate
      ?? row.rawRow?.["transaction date"]
      ?? extractTransactionDateHint(row.note)
      ?? extractTransactionDateHint(row.rawRow?.note)
      ?? extractTransactionDateHint(row.rawRow?.notes)
      ?? extractTransactionDateHint(row.rawRow?.remarks)
  );
}

function extractTransactionDateHint(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.match(/\b(?:txn|transaction)\s+date\s*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\b/i);
  return match?.[1];
}

function normalizeMatchDate(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
}

function formatOptionalMatchDate(value) {
  const normalized = normalizeMatchDate(value);
  return normalized ? formatImportPreviewDate(normalized) : importMessages.duplicateMatchDateUnavailable;
}

function getIncomingBankCertificationLabel(sourceType) {
  if (sourceType === "pdf") {
    return importMessages.bankCertificationStatusIncomingStatement;
  }

  if (sourceType === "manual") {
    return "Manual provisional";
  }

  return "Import provisional";
}

function getExistingBankCertificationLabel(match) {
  if (match.existingBankCertificationStatus === "statement_certified") {
    return "Statement certified";
  }

  return match.existingSourceType === "manual" ? "Manual provisional" : "Import provisional";
}

function buildDuplicateLedgerEntryHref(match) {
  const params = new URLSearchParams({
    view: "household",
    month: match.date.slice(0, 7),
    editing_entry: match.existingTransactionId
  });
  if (match.existingAccountId) {
    params.set("entry_wallet", match.existingAccountId);
  } else if (match.accountName) {
    params.set("entry_wallet", match.accountName);
  }
  return `/entries?${params.toString()}`;
}

export function canPromoteExistingRowMatch(row, match) {
  return Boolean(
    row.commitStatus === "needs_review"
    && match?.existingTransactionId
    && match?.existingSourceType === "manual"
    && match?.existingBankCertificationStatus === "provisional"
    && (row.reconciliationMatchCount ?? row.reconciliationMatches?.length ?? 0) === 1
  );
}

export function isAutoMatchedExistingRowMatch(row, match) {
  return Boolean(
    row.commitStatus === "included"
    && row.reconciliationTargetTransactionId
    && match?.existingTransactionId === row.reconciliationTargetTransactionId
    && match?.existingSourceType === "manual"
    && match?.existingBankCertificationStatus === "provisional"
    && (row.reconciliationMatchCount ?? row.reconciliationMatches?.length ?? 0) === 1
  );
}

function renderHighlightedDescription(description, otherDescription) {
  const text = description || messages.common.emptyValue;
  const otherTokenSet = buildNormalizedHighlightTokenSet(otherDescription ?? "");
  if (!otherTokenSet.size) {
    return text;
  }

  const parts = text.split(/([A-Za-z0-9]+)/g);
  return parts.map((part, index) => {
    if (!part) {
      return null;
    }

    const normalizedTokens = normalizeTextForHighlight(part);
    const isShared = normalizedTokens.some((token) => otherTokenSet.has(token));
    return isShared
      ? <mark key={`${part}-${index}`} className="duplicate-match-highlight">{part}</mark>
      : <Fragment key={`${part}-${index}`}>{part}</Fragment>;
  });
}

function buildNormalizedHighlightTokenSet(value) {
  return new Set(normalizeTextForHighlight(value));
}

function normalizeTextForHighlight(value) {
  return value
    .toLowerCase()
    .replace(/\bcs\s+fresh\b/g, "cold storage")
    .replace(/\bcoldstorage\b/g, "cold storage")
    .replace(/\bcs\b/g, "cold storage")
    .replace(/\b(singapore|sg|applepay|apple\s+pay)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function formatDuplicateMatchKind(matchKind) {
  if (matchKind === "exact") {
    return importMessages.duplicateMatchKindExact;
  }

  if (matchKind === "probable") {
    return importMessages.duplicateMatchKindProbable;
  }

  return importMessages.duplicateMatchKindNear;
}

